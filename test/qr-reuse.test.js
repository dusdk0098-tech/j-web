import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { workerJoinCredentials,switchWorkerJoinToSite } from '../public/worker-link.js';

test('가입 QR은 주소가 바뀐 같은 화면에서 유효 기간에 여러 명을 등록한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-reuse-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),params=new URL(invite.link).searchParams,token=params.get('token');
    const person=loginId=>({name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    const first=await send('/api/join','POST',{...person('qr_first'),...workerJoinCredentials(params,null)});assert.equal(first.status,201);const key=(await first.json()).siteKey;
    assert.equal((await send('/api/join','POST',{...person('qr_old'),token,siteKey:key})).status,400);
    assert.equal((await send('/api/join','POST',{...person('qr_second'),...workerJoinCredentials(params,key)})).status,201);
    const rotated=await (await send(`/api/sites/${site.id}/access/rotate`,'POST',{},admin)).json(),newKey=new URL(rotated.link).searchParams.get('site');assert.notEqual(newKey,key);
    const third=await send('/api/join','POST',{...person('qr_third'),...workerJoinCredentials(params,key)});assert.equal(third.status,201);assert.equal((await third.json()).siteKey,newKey);
    const siteParams=new URLSearchParams({site:newKey,token});assert.equal((await send('/api/join','POST',{...person('qr_site'),...workerJoinCredentials(siteParams,newKey)})).status,400);
    const login=await send('/api/worker/login','POST',{token,loginId:'qr_first',password:'virtual-password-123'});assert.equal(login.status,200);const workerCookie=login.headers.get('set-cookie').split(';')[0],worker=(await login.json()).worker;
    assert.equal((await send(`/api/sites/${site.id}/invitation`,'DELETE',undefined,admin)).status,200);
    assert.equal((await send('/api/join','POST',{...person('qr_revoked'),...workerJoinCredentials(params,newKey)})).status,400);
    assert.equal((await send(`/api/sites/${site.id}/access/registration`,'POST',{},admin)).status,200);
    assert.equal((await send('/api/worker/logout','POST',{},workerCookie)).status,200);
    const infoResponse=await send(`/api/worker/site?key=${encodeURIComponent(newKey)}`),info=await infoResponse.json();assert.equal(infoResponse.status,200);assert.equal(info.canSignup,true);
    assert.equal((await send('/api/join','POST',{...person('qr_stale'),...workerJoinCredentials(params,newKey)})).status,400);
    switchWorkerJoinToSite(params,newKey,worker.site_id,info);
    assert.equal((await send('/api/join','POST',{...person('qr_after_logout'),...workerJoinCredentials(params,newKey)})).status,201);
    assert.equal((await send(`/api/sites/${site.id}/invitation`,'DELETE',undefined,admin)).status,200);
    assert.equal((await send('/api/join','POST',{...person('qr_closed_again'),...workerJoinCredentials(params,newKey)})).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
