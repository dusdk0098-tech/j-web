import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('새 가입은 가상 생년월일과 전화번호를 검사하고 이전 계정은 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-profile-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);},stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),adminLogin=async()=>(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    let admin=await adminLogin();const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),input={token,name:'가상 근로자',category:'직영',company:'',occupation:'가상 직종',loginId:'profile_virtual',password:'virtual-password-123',acknowledged:true},valid={birthDate:'2000-02-29',phone:'010-0000-0000'};
    for(const profile of [undefined,null,{}, {...valid,birthDate:''},{...valid,birthDate:'2001-02-29'},{...valid,phone:''},{...valid,phone:'---'},{...valid,phone:'010-가상-1234'},{...valid,phone:'12+34567'},{...valid,phone:'1234567890123456'}])assert.equal((await call('/api/join','POST',{...input,profile})).status,400);
    assert.deepEqual(await (await call(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json(),[]);assert.equal((await call('/api/join','POST',{...input,profile:valid})).status,201);
    const workers=await (await call(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json(),id=workers[0].id;await stop();const db=new DatabaseSync(join(dir,'jweb.sqlite'));db.prepare('UPDATE join_acknowledgements SET profile=NULL WHERE worker_id=?').run(id);db.close();await start();admin=await adminLogin();
    assert.equal((await call('/api/worker/login','POST',{token,loginId:input.loginId,password:input.password})).status,200);const prior=await (await call(`/api/workers/${id}/join-record?siteId=${site.id}`,'GET',undefined,admin)).json();assert.equal(prior.profile,null);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
