import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('근로자 암호 변경은 세션과 계정을 확인하고 다른 계정의 로그인을 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-password-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료되었습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),qr=await(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(qr.link).searchParams.get('token'),info=await(await send(`/api/join?token=${token}`)).json();
    for(const [loginId,name] of [['worker_one','가상 첫 근로자'],['worker_two','가상 둘째 근로자']])assert.equal((await send('/api/join','POST',{token,name,loginId,password:'virtual-old-password',category:'직영',company:'가상 회사',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
    const login=async(loginId,password='virtual-old-password')=>{const response=await send('/api/worker/login','POST',{siteKey:info.siteKey,loginId,password});assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie').split(';')[0],data:await response.json()};};
    const first=await login('worker_one'),second=await login('worker_one'),other=await login('worker_two'),path='/api/worker/password',input={currentPassword:'virtual-old-password',newPassword:'virtual-new-password',confirmPassword:'virtual-new-password',reportContext:first.data.reportContext};
    assert.equal((await send(path,'PUT',input)).status,401);assert.equal((await send(path,'PUT',input,admin)).status,401);
    assert.equal((await send(path,'PUT',input,other.cookie)).status,409);assert.equal((await send(path,'PUT',input,second.cookie)).status,409);
    assert.equal((await send(path,'PUT',{...input,reportContext:null},first.cookie)).status,409);assert.equal((await send(path,'PUT',{...input,currentPassword:'틀린 암호'},first.cookie)).status,403);
    const changed=await send(path,'PUT',input,first.cookie);assert.equal(changed.status,200);assert.equal(changed.headers.get('set-cookie'),null);
    assert.equal((await send('/api/worker/session','GET',null,first.cookie)).status,401);assert.equal((await send('/api/worker/session','GET',null,second.cookie)).status,401);assert.equal((await send('/api/worker/session','GET',null,other.cookie)).status,200);
    assert.equal((await send('/api/worker/login','POST',{siteKey:info.siteKey,loginId:'worker_one',password:'virtual-old-password'})).status,401);
    const fresh=await login('worker_one','virtual-new-password');assert.equal(fresh.data.worker.id,first.data.worker.id);assert.equal((await send('/api/worker/session','GET',null,other.cookie)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
