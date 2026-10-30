import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readSheet } from 'read-excel-file/node';
import { Store } from '../store.js';

const deductions={income:'10',local:'0',health:'0',care:'0',pension:'0',employment:'0'};
const person=siteId=>({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};

test('출역 기준 노임은 완전한 일당·공수만 적용하고 변경 시 재확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker(person(site.id)),foreign=s.createWorker(person(other.id)),base={siteId:site.id,workerId:worker.id,month:'2026-10'},day=date=>({siteId:site.id,workerId:worker.id,date});
    assert.throws(()=>s.wageEstimate(site.id,foreign.id,base.month),/현장/);assert.equal(s.wageEstimate(site.id,worker.id,base.month).gross,null);
    for(const date of ['2026-10-01','2026-10-02'])s.setAttendance({...day(date),present:true});
    s.setAttendanceUnits({...day('2026-10-01'),units:'0.5'});s.setAttendanceDailyRate({...day('2026-10-01'),dailyRate:'101'});
    let estimate=s.wageEstimate(site.id,worker.id,base.month);assert.equal(estimate.gross,null);assert.equal(estimate.incomplete,1);
    s.setAttendanceUnits({...day('2026-10-02'),units:'1.25'});s.setAttendanceDailyRate({...day('2026-10-02'),dailyRate:'101'});
    estimate=s.wageEstimate(site.id,worker.id,base.month);assert.equal(estimate.gross,177);assert.equal(estimate.days,2);assert.match(estimate.version,/^[0-9a-f]{64}$/);
    const input={...base,gross:'177',grossMode:'attendance',attendanceVersion:estimate.version,deductions,manualTotal:'20'};
    assert.throws(()=>s.saveWageRecord({...input,gross:'176'}),/계산액/);assert.throws(()=>s.saveWageRecord({...input,attendanceVersion:''}),/계산/);
    assert.throws(()=>s.saveWageRecord(input,false,()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(s.wageRecords(site.id,base.month),[]);
    s.saveWageRecord(input);let row=s.wageRecords(site.id,base.month)[0];assert.equal(row.gross,177);assert.equal(row.gross_mode,'attendance');assert.equal(row.gross_status,'current');assert.equal(row.total,20);assert.equal(row.net,157);
    s.setAttendanceUnits({...day('2026-10-01'),units:'0.75'});const changed=s.wageRecords(site.id,base.month)[0];assert.equal(changed.gross,177);assert.equal(changed.gross_status,'changed');assert.equal(changed.total,20);
    assert.throws(()=>s.saveWageRecord({...input,expectedVersion:row.version},true),/출역 정보가 변경/);
    estimate=s.wageEstimate(site.id,worker.id,base.month);assert.equal(estimate.gross,202);
    s.saveWageRecord({...input,gross:'202',attendanceVersion:estimate.version,expectedVersion:row.version},true);row=s.wageRecords(site.id,base.month)[0];assert.equal(row.gross,202);assert.equal(row.gross_status,'current');assert.equal(row.total,20);
    s.saveWageRecord({...input,gross:'150',grossMode:'manual',expectedVersion:row.version},true);row=s.wageRecords(site.id,base.month)[0];assert.equal(row.gross_mode,'manual');assert.equal(row.gross_status,'manual');assert.equal(row.attendance_version,null);assert.equal(row.total,20);
    s.setAttendanceSalary({...day('2026-10-01'),kind:'monthly',amount:'3000'});assert.equal(s.wageEstimate(site.id,worker.id,base.month).gross,null);
    s.setAttendanceDailyRate({...day('2026-10-01'),dailyRate:'999999999'});s.setAttendanceUnits({...day('2026-10-01'),units:'9.99'});assert.match(s.wageEstimate(site.id,worker.id,base.month).reason,/한도/);
    s.setAttendanceDailyRate({...day('2026-10-01'),dailyRate:'0'});s.setAttendanceUnits({...day('2026-10-01'),units:'0'});s.setAttendance({...day('2026-10-02'),present:false});assert.equal(s.wageEstimate(site.id,worker.id,base.month).gross,0);
  }finally{s.close();}
});

test('이전 노임 데이터베이스는 입력 방식 추가 후에도 금액과 공제를 유지한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-old-wage-mode-')),file=join(dir,'old.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker(person(site.id));s.saveWageRecord({siteId:site.id,workerId:worker.id,month:'2026-10',gross:'100',deductions,manualTotal:'20'});s.close();s=null;
    const old=new DatabaseSync(file);old.exec('ALTER TABLE wage_records DROP COLUMN gross_mode; ALTER TABLE wage_records DROP COLUMN attendance_version');old.close();
    s=new Store(file);const row=s.wageRecords(site.id,'2026-10')[0];assert.equal(row.gross,100);assert.equal(row.total,20);assert.equal(row.gross_mode,'manual');assert.equal(row.gross_status,'manual');assert.equal(row.attendance_version,null);
  }finally{if(s)s.close();cleanup(dir);}
});

test('노임 계산 API와 엑셀은 직접 입력·출역 계산·변경 상태를 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-wage-estimate-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json(),worker=await (await send('/api/workers','POST',person(site.id),admin)).json(),base={siteId:site.id,workerId:worker.id,date:'2026-10-01'};
    const estimatePath=`/api/wages/estimate?siteId=${site.id}&workerId=${worker.id}&month=2026-10`;assert.equal((await send(estimatePath)).status,401);assert.equal((await send(`/api/wages/estimate?siteId=${other.id}&workerId=${worker.id}&month=2026-10`,'GET',null,admin)).status,400);
    assert.equal((await send('/api/attendance','POST',{...base,present:true},admin)).status,200);assert.equal((await send('/api/attendance/units','PUT',{...base,units:'0.5'},admin)).status,200);assert.equal((await send('/api/attendance/daily-rate','PUT',{...base,dailyRate:'101'},admin)).status,200);
    const estimate=await (await send(estimatePath,'GET',null,admin)).json();assert.equal(estimate.gross,51);
    const input={siteId:site.id,workerId:worker.id,month:'2026-10',gross:'51',grossMode:'attendance',attendanceVersion:estimate.version,deductions,manualTotal:'20'},query=`siteId=${site.id}&month=2026-10`;
    assert.equal((await send('/api/wages','POST',input,admin)).status,200);let row=(await (await send(`/api/wages?${query}`,'GET',null,admin)).json())[0];assert.equal(row.gross_status,'current');assert.equal(row.net,31);
    let sheet=await readSheet(Buffer.from(await (await send(`/api/wages/export?${query}`,'GET',null,admin)).arrayBuffer()));assert.equal(sheet[1][sheet[0].indexOf('노임 입력 방식')],'출역 기준');assert.equal(sheet[1][sheet[0].indexOf('출역 기준 상태')],'확인됨');
    assert.equal((await send('/api/attendance/units','PUT',{...base,units:'1'},admin)).status,200);row=(await (await send(`/api/wages?${query}`,'GET',null,admin)).json())[0];assert.equal(row.gross,51);assert.equal(row.gross_status,'changed');
    sheet=await readSheet(Buffer.from(await (await send(`/api/wages/export?${query}`,'GET',null,admin)).arrayBuffer()));assert.equal(sheet[1][sheet[0].indexOf('출역 기준 상태')],'재확인 필요');
    assert.equal((await send('/api/wages','PUT',{...input,expectedVersion:row.version},admin)).status,409);
    const latest=await (await send(estimatePath,'GET',null,admin)).json();assert.equal(latest.gross,101);assert.equal((await send('/api/wages','PUT',{...input,gross:'101',attendanceVersion:latest.version,expectedVersion:row.version},admin)).status,200);
    row=(await (await send(`/api/wages?${query}`,'GET',null,admin)).json())[0];assert.equal(row.gross_status,'current');assert.equal(row.total,20);assert.equal(row.net,81);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});

test('시험 노임 저장이 잠금을 기다리는 동안 출역이 바뀌면 저장하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-wage-estimate-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.saveWageRecord;Store.prototype.saveWageRecord=function(...args){process.stdout.write('WAGE_LOCK\\n');return original.apply(this,args)};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),worker=await (await send('/api/workers','POST',person(site.id),admin)).json(),day={siteId:site.id,workerId:worker.id,date:'2026-10-01'};
    await send('/api/attendance','POST',{...day,present:true},admin);await send('/api/attendance/units','PUT',{...day,units:'0.5'},admin);await send('/api/attendance/daily-rate','PUT',{...day,dailyRate:'101'},admin);
    const estimate=await (await send(`/api/wages/estimate?siteId=${site.id}&workerId=${worker.id}&month=2026-10`,'GET',null,admin)).json(),input={siteId:site.id,workerId:worker.id,month:'2026-10',gross:String(estimate.gross),grossMode:'attendance',attendanceVersion:estimate.version,deductions};
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;
    const started=once(child.stdout,'data'),pending=send('/api/wages','POST',input,admin);pending.catch(()=>{});assert.match(String((await started)[0]),/WAGE_LOCK/);db.prepare('UPDATE attendance SET units_hundredths=100 WHERE worker_id=? AND date=?').run(worker.id,day.date);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,409);assert.equal(db.prepare('SELECT count(*) AS n FROM wage_records').get().n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});
