import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readSheet } from 'read-excel-file/node';
import { Store } from '../store.js';

test('공제 총액의 직접 입력은 항목과 구분되고 출역 변경 및 재시작 후에도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-wage-total-')),path=join(dir,'wages.sqlite');let s=new Store(path);
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'},input={siteId:site.id,workerId:worker.id,month:'2026-10',gross:'1000',deductions,manualTotal:'250'};
    s.saveWageRecord(input);let record=s.wageRecords(site.id,input.month)[0];assert.equal(record.detail_total,188);assert.equal(record.manual_total,250);assert.equal(record.total,250);assert.equal(record.net,750);assert.equal(s.wageSummary(site.id,input.month)[0].deductions,250);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-01',present:true});s.setAttendanceUnits({siteId:site.id,workerId:worker.id,date:'2026-10-01',units:'1'});s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-01',present:false});assert.equal(s.wageRecords(site.id,input.month)[0].total,250);
    s.close();s=new Store(path);record=s.wageRecords(site.id,input.month)[0];assert.equal(record.manual_total,250);assert.equal(record.detail_total,188);
    const version=record.version,{manualTotal,...oldClient}=input;s.saveWageRecord({...oldClient,gross:'1100'},true);assert.equal(s.wageRecords(site.id,input.month)[0].total,250);assert.throws(()=>s.saveWageRecord({...input,manualTotal:'300',expectedVersion:version},true),/변경/);assert.equal(s.wageRecords(site.id,input.month)[0].total,250);
    assert.throws(()=>s.saveWageRecord({...input,manualTotal:'1101'},true),/공제액/);assert.throws(()=>s.saveWageRecord({...input,manualTotal:'-1'},true),/금액/);assert.throws(()=>s.saveWageRecord({...input,manualTotal:'1.5'},true),/금액/);assert.throws(()=>s.saveWageRecord({...input,siteId:other.id},true),/현장/);assert.throws(()=>s.saveWageRecord({...input,manualTotal:'300'},true,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.wageRecords(site.id,input.month)[0].total,250);
    s.saveWageRecord({...input,manualTotal:'0'},true);assert.equal(s.wageRecords(site.id,input.month)[0].total,0);s.saveWageRecord({...input,manualTotal:''},true);record=s.wageRecords(site.id,input.month)[0];assert.equal(record.manual_total,null);assert.equal(record.total,188);assert.equal(record.net,812);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('공제 총액 API와 엑셀은 직접 입력과 항목 합계를 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-wage-total-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),worker=await (await send('/api/workers','POST',{siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'},admin)).json(),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'},input={siteId:site.id,workerId:worker.id,month:'2026-10',gross:'1000',deductions,manualTotal:'250'},query=`siteId=${site.id}&month=2026-10`;
    assert.equal((await send('/api/wages','POST',input)).status,401);assert.equal((await send('/api/wages','POST',input,admin)).status,200);let record=(await (await send(`/api/wages?${query}`,'GET',undefined,admin)).json())[0];assert.equal(record.total,250);assert.equal(record.detail_total,188);assert.equal(record.net,750);
    const response=await send(`/api/wages/export?${query}`,'GET',undefined,admin);assert.equal(response.status,200);const rows=await readSheet(Buffer.from(await response.arrayBuffer()));assert.equal(rows[1][10],250);assert.equal(rows[1][11],750);assert.deepEqual(rows[1].slice(-2),[188,'직접 입력']);
    assert.equal((await send('/api/wages','PUT',{...input,manualTotal:'1001'},admin)).status,400);record=(await (await send(`/api/wages?${query}`,'GET',undefined,admin)).json())[0];assert.equal(record.total,250);const version=record.version;
    assert.equal((await send('/api/wages','PUT',{...input,manualTotal:null,expectedVersion:version},admin)).status,200);assert.equal((await send('/api/wages','PUT',{...input,manualTotal:'300',expectedVersion:version},admin)).status,409);record=(await (await send(`/api/wages?${query}`,'GET',undefined,admin)).json())[0];assert.equal(record.manual_total,null);assert.equal(record.total,188);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
