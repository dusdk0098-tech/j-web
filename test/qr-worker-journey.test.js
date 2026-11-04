import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';

test('가입 QR 판독부터 근로자 점검과 서버 재시작 후 관리자 조회까지 이어진다',{timeout:45000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-journey-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);};
  const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
  try{
    await start();const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie,context)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(context?{'x-worker-report-context':JSON.stringify(context)}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),response=await send(`/api/sites/${site.id}/invitation`,'POST',{},admin);assert.equal(response.status,201);const invite=await response.json(),qr=PNG.sync.read(Buffer.from(invite.image.split(',')[1],'base64')),link=jsQR(new Uint8ClampedArray(qr.data),qr.width,qr.height)?.data;assert.equal(link,invite.link);const token=new URL(link).searchParams.get('token');
    assert.equal((await send(`/api/join?token=${encodeURIComponent(token)}`)).status,200);const password='virtual-password-123',person={token,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'가상 직종',loginId:'qr_journey',password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',person)).status,201);
    const login=await send('/api/worker/login','POST',{token,loginId:person.loginId,password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json(),signature=new PNG({width:1,height:1});signature.data[3]=255;
    const check=await send('/api/worker/self-check','POST',{answers:{equipment:true,sober:true,exercise:true,briefing:true},signature:'data:image/png;base64,'+PNG.sync.write(signature).toString('base64'),reportContext:session.reportContext},cookie);assert.equal(check.status,200);const date=(await check.json()).check.date;
    const list=await (await send(`/api/sites/${site.id}/self-checks?date=${date}`,'GET',null,admin)).json();assert.ok(list.some(row=>row.id===session.worker.id&&row.has_signature));
    const identity={token,identityOnly:true,name:'가상 이름 가입자',category:'직영',company:'가상 회사',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2001-02-03',phone:'010-0000-0000'}},registered=await send('/api/join','POST',identity);assert.equal(registered.status,201);const registration=await registered.json(),siteKey=registration.siteKey;assert.ok(siteKey);assert.equal(registration.password,undefined);
    const identityInput={siteKey,method:'identity',name:identity.name,birthDigits:'010203'};assert.equal((await send('/api/worker/login','POST',{...identityInput,birthDigits:'010204'})).status,401);const identityLogin=await send('/api/worker/login','POST',identityInput);assert.equal(identityLogin.status,200);const identityCookie=identityLogin.headers.get('set-cookie').split(';')[0],identitySession=await identityLogin.json();
    const identityCheck=await send('/api/worker/self-check','POST',{answers:{equipment:true,sober:true,exercise:true,briefing:true},signature:'data:image/png;base64,'+PNG.sync.write(signature).toString('base64'),reportContext:identitySession.reportContext},identityCookie);assert.equal(identityCheck.status,200);assert.equal((await identityCheck.json()).check.date,date);
    await stop();await start();const after=await send('/api/worker/self-check','GET',null,cookie,session.reportContext);assert.equal(after.status,200);assert.equal((await after.json()).check.date,date);const saved=await (await send(`/api/sites/${site.id}/self-checks?date=${date}`,'GET',null,admin)).json();assert.ok(saved.some(row=>row.id===session.worker.id&&row.has_signature));
    assert.ok(saved.some(row=>row.id===identitySession.worker.id&&row.has_signature));const relogin=await send('/api/worker/login','POST',identityInput);assert.equal(relogin.status,200);assert.equal((await relogin.json()).worker.id,identitySession.worker.id);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
