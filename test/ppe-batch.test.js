import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('여러 보호구 지급은 입력과 현장을 검증하고 실패 시 전부 되돌린다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),input={siteId:site.id,workerId:worker.id,date:'2026-10-30',quantity:'2',items:['안전모','각반','가상 기타']};
    for(const change of [{items:[]},{items:['안전모',' 안전모 ']},{items:['안전모','']},{items:Array(21).fill('안전모')},{quantity:'0'},{siteId:other.id}])assert.throws(()=>s.addPpeIssues({...input,...change}));
    assert.throws(()=>s.addPpeIssues(input,()=>{throw Error('권한 만료');}),/권한 만료/);assert.deepEqual(s.ppeIssues(site.id,'2026-10').rows,[]);
    s.db.exec("CREATE TRIGGER fail_batch_ppe BEFORE INSERT ON ppe_issues WHEN NEW.item='각반' BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");assert.throws(()=>s.addPpeIssues(input),/가상 저장 실패/);assert.deepEqual(s.ppeIssues(site.id,'2026-10').rows,[]);s.db.exec('DROP TRIGGER fail_batch_ppe');
    const ids=s.addPpeIssues(input);assert.equal(ids.length,3);assert.deepEqual(s.ppeIssues(site.id,'2026-10').totals.map(row=>[row.item,row.quantity]),[['가상 기타',2],['각반',2],['안전모',2]]);assert.deepEqual(s.workerPpeIssues(site.id,worker.id).map(row=>row.item),['가상 기타','각반','안전모']);assert.equal(s.weeklyActivity(site.id,'2026-10-25')[5].ppeIssues.length,3);
  }finally{s.close();}
});

test('보호구 묶음 API는 관리자만 같은 현장에 저장한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-ppe-batch-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),worker=await (await call('/api/workers','POST',{siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'},admin)).json(),input={siteId:site.id,workerId:worker.id,date:'2026-10-30',quantity:'1',items:['안전벨트','방진마스크']};
    assert.equal((await call('/api/ppe-issues/batch','POST',input)).status,401);assert.equal((await call('/api/ppe-issues/batch','POST',{...input,siteId:other.id},admin)).status,400);const saved=await call('/api/ppe-issues/batch','POST',input,admin);assert.equal(saved.status,201);assert.equal((await saved.json()).ids.length,2);const report=await (await call(`/api/ppe-issues?siteId=${site.id}&month=2026-10`,'GET',null,admin)).json();assert.deepEqual(report.totals.map(row=>row.item),['방진마스크','안전벨트']);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
