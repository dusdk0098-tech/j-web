import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const reportInput=siteId=>({siteId,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1500',progress:'50'});
test('관리비 월간 문서는 세션 확인이 실패하면 만들지 않는다',()=>{const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'});store.createSafetyCost({siteId:site.id,category:'2',date:'2026-10-29',description:'가상 내역',note:'',unitPrice:'1200',quantity:'1',unit:'개'});assert.throws(()=>store.createSafetyCostReport(reportInput(site.id),()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.documents(site.id,'cost').length,0);}finally{store.close();}});

test('관리비 월간 문서 생성 대기 중 추가된 내역과 사진을 같은 시점에 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-report-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.createSafetyCostReport;Store.prototype.createSafetyCostReport=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('COST_REPORT_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();assert.equal((await send('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'기존 내역',note:'',unitPrice:'1200',quantity:'1',unit:'개'},admin)).status,201);db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send('/api/safety-cost-reports','POST',reportInput(site.id),admin);pending.catch(()=>{});assert.match(String((await started)[0]),/COST_REPORT_LOCK/);const id=db.prepare('INSERT INTO safety_costs(site_id,category,date,description,note,unit_price,quantity,unit,amount) VALUES(?,?,?,?,?,?,?,?,?)').run(site.id,3,'2026-10-30','새 내역','','300','1','개','300').lastInsertRowid,png=new PNG({width:1,height:1});png.data[3]=255;db.prepare('INSERT INTO safety_cost_photos(cost_id,name,data) VALUES(?,?,?)').run(id,'가상.png',PNG.sync.write(png));db.exec('COMMIT');locked=false;const response=await pending;assert.equal(response.status,201);const report=await response.json(),details=JSON.parse(report.details),photos=await (await send(`/api/safety-cost-reports/${report.id}/photos`,'GET',undefined,admin)).json();assert.equal(details.total,'1500');assert.equal(details.rows.length,2);assert.equal(details.rows[1].description,'새 내역');assert.equal(photos.length,1);assert.equal(photos[0].cost_id,id);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
