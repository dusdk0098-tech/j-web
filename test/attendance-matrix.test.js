import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {attendanceMatrix,attendanceMatrixMarkup} from '../public/attendance-matrix.js';

test('직종·소속 표는 출역 당시 기록을 날짜별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(site,name)=>s.createWorker({siteId:site.id,name,category:'직영',company:'가상 소속',occupation:'가상 직종'}),one=make(a,'가상 1'),two=make(a,'가상 2'),other=make(b,'다른 현장'),dates=['2024-02-28','2024-02-29'];
    for(const [worker,date] of [[one,dates[0]],[one,dates[1]],[two,dates[1]],[other,dates[1]]])s.setAttendance({siteId:worker.site_id,workerId:worker.id,date,present:true});s.db.prepare('UPDATE attendance SET company_snapshot=?,occupation_snapshot=? WHERE worker_id=? AND date=?').run('이전 소속','이전 직종',one.id,dates[0]);s.db.prepare('UPDATE attendance SET company_snapshot=NULL,occupation_snapshot=? WHERE worker_id=? AND date=?').run('<가상 직종>',two.id,dates[1]);
    const monthly=s.monthlyAttendance(a.id,'2024-02'),companies=attendanceMatrix(monthly,dates,'company'),occupations=attendanceMatrix(monthly,dates,'occupation');assert.deepEqual(companies.find(row=>row.label==='이전 소속').days,[1,0]);assert.deepEqual(companies.find(row=>row.label==='가상 소속').days,[0,1]);assert.equal(companies.find(row=>row.label==='기록 없음').total,1);assert.deepEqual(occupations.find(row=>row.label==='가상 직종').days,[0,1]);assert.equal(occupations.reduce((sum,row)=>sum+row.total,0),3);assert.throws(()=>attendanceMatrix(monthly,dates,'other'),/기준/);
    const markup=attendanceMatrixMarkup(monthly,dates);assert.match(markup,/월별 직종 출역/);assert.match(markup,/월별 소속 출역/);assert.match(markup,/&lt;가상 직종&gt;/);assert.doesNotMatch(markup,/<가상 직종>/);s.setAttendance({siteId:a.id,workerId:two.id,date:dates[1],present:false});assert.equal(attendanceMatrix(s.monthlyAttendance(a.id,'2024-02'),dates,'occupation').reduce((sum,row)=>sum+row.total,0),2);
  }finally{s.close();}
});

test('출역 조회 도중 현장이 바뀌면 이전 화면을 그리지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf('    const siteId=state.siteId,epoch=detailEpoch,date=state.attendanceDate'),to=source.indexOf('    content.innerHTML=',from);assert.ok(from>=0&&to>from);let release;const waiting=new Promise(resolve=>{release=resolve;}),state={page:'attendance',siteId:1,attendanceDate:'2026-11-01',attendanceMonth:'2026-11',reportFrom:'2026-11-01',reportTo:'2026-11-01',reportGroup:'worker'},context={state,detailEpoch:1,today:()=> '2026-11-01',encodeURIComponent,Promise,api:path=>path.startsWith('/api/attendance?')?waiting:Promise.resolve([])};
  const pending=runInNewContext(`(async()=>{${source.slice(from,to)}return true;})()`,context);state.siteId=2;release([]);assert.equal(await pending,undefined);
});

test('월별 집계 스크립트는 서버에서 제공된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-attendance-matrix-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const response=await fetch(`http://127.0.0.1:${port}/attendance-matrix.js`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/attendanceMatrixMarkup/);}finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
