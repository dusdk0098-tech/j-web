import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

test('이전 신고 데이터는 답변 테이블 추가 후에도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-legacy-')),file=join(dir,'test.sqlite');let store;
  try{store=new Store(file);const site=store.createSite({name:'가상 현장'}),id=store.createHazardReport(site.id,{title:'가상 신고',body:'가상 내용',reporter:'가상 신고자'});store.close();store=null;const legacy=new DatabaseSync(file);legacy.exec('DROP TABLE hazard_report_replies');legacy.close();store=new Store(file);const row=store.hazardReports(site.id)[0];assert.equal(row.id,id);assert.equal(row.body,'가상 내용');assert.deepEqual(row.replies,[]);store.addHazardReply(site.id,id,{body:'가상 답변'});assert.equal(store.hazardReports(site.id)[0].replies[0].body,'가상 답변');}finally{if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});

test('신고 답변은 현장과 신고자에게만 보이며 재시작과 삭제가 반영된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-replies-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);},stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),adminLogin=async()=>(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    let admin=await adminLogin();const a=await (await call('/api/sites','POST',{name:'가상 A'},admin)).json(),b=await (await call('/api/sites','POST',{name:'가상 B'},admin)).json(),invite=async site=>new URL((await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json()).link).searchParams.get('token'),ta=await invite(a),tb=await invite(b);
    const worker=async(token,id)=>{const password='virtual-password-123',input={token,name:id,category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:id,password,acknowledged:true};assert.equal((await call('/api/join','POST',input)).status,201);const login=await call('/api/worker/login','POST',{token,loginId:id,password});return login.headers.get('set-cookie').split(';')[0];},one=await worker(ta,'hazard_one'),two=await worker(ta,'hazard_two'),other=await worker(tb,'hazard_other');
    const report=async cookie=>{const res=await call('/api/worker/hazard-reports','POST',{title:'가상 신고',body:'가상 내용'},cookie);assert.equal(res.status,201);return (await res.json()).id;},id=await report(one),otherId=await report(two),path=`/api/sites/${a.id}/hazard-reports/${id}/replies`;
    assert.equal((await call(path,'POST',{body:'가상 답변'})).status,401);assert.equal((await call(path,'POST',{body:'가상 답변'},one)).status,401);assert.equal((await call(`/api/sites/${b.id}/hazard-reports/${id}/replies`,'POST',{body:'가상 답변'},admin)).status,400);for(const body of ['', '가'.repeat(2001)])assert.equal((await call(path,'POST',{body},admin)).status,400);
    const first=await (await call(path,'POST',{body:'첫 답변'},admin)).json(),second=await (await call(path,'POST',{body:'<script>가상 답변</script>'},admin)).json(),mine=await (await call('/api/worker/hazard-reports','GET',undefined,one)).json();assert.deepEqual(mine[0].replies.map(r=>r.body),['첫 답변','<script>가상 답변</script>']);assert.deepEqual((await (await call('/api/worker/hazard-reports','GET',undefined,two)).json())[0].replies,[]);assert.deepEqual(await (await call('/api/worker/hazard-reports','GET',undefined,other)).json(),[]);
    assert.equal((await call(`/api/sites/${a.id}/hazard-reports/${otherId}/replies/${first.id}`,'DELETE',undefined,admin)).status,400);assert.equal((await call(`${path}/${first.id}`,'DELETE',undefined,one)).status,401);assert.equal((await call(`${path}/${first.id}`,'DELETE',undefined,admin)).status,200);
    await stop();await start();admin=await adminLogin();const rows=await (await call(`/api/sites/${a.id}/hazard-reports`,'GET',undefined,admin)).json(),kept=rows.find(row=>row.id===id);assert.deepEqual(kept.replies.map(r=>r.id),[second.id]);assert.equal(kept.replies[0].body,'<script>가상 답변</script>');assert.deepEqual(rows.find(row=>row.id===otherId).replies,[]);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
