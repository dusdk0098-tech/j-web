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

test('배정 현장의 개인 QR 발급부터 기존 출입자 연결과 로그인까지 실제 HTTP로 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-personal-qr-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let second;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료되었습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie,context)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(context?{origin:base,'x-admin-context':context}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async loginId=>{const result=await send('/api/login','POST',{loginId,password:'virtual-admin-password'});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];};
    const admin=await login('admin'),site=await(await send('/api/sites','POST',{name:'가상 배정 현장'},admin)).json(),other=await(await send('/api/sites','POST',{name:'가상 다른 현장'},admin)).json();
    const person=siteId=>({siteId,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'가상 직종'}),w=await(await send('/api/workers','POST',person(site.id),admin)).json(),foreign=await(await send('/api/workers','POST',person(other.id),admin)).json();
    assert.equal((await send('/api/admin-accounts','POST',{loginId:'scope_invite',name:'가상 관리자',password:'virtual-admin-password',scope:'restricted',siteIds:[site.id]},admin)).status,201);
    const limited=await login('scope_invite'),context=(await(await send('/api/session','GET',null,limited)).json()).context,path=`/api/workers/${w.id}/invitation`,body={siteId:site.id,version:w.version};
    assert.equal((await send(path,'POST',body)).status,401);assert.equal((await send(`/api/workers/${foreign.id}/invitation`,'POST',{siteId:other.id,version:foreign.version},limited,context)).status,403);
    assert.equal((await send(path,'POST',{...body,extra:true},limited,context)).status,403);
    const issued=await send(path,'POST',body,limited,context);assert.equal(issued.status,201);assert.equal(issued.headers.get('cache-control'),'no-store');const qr=await issued.json(),png=PNG.sync.read(Buffer.from(qr.image.split(',')[1],'base64'));
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,qr.link);const token=new URL(qr.link).searchParams.get('token');
    const infoResponse=await send(`/api/join?token=${token}`),info=await infoResponse.json();assert.equal(infoResponse.status,200);assert.equal(info.existingWorker,true);assert.equal(info.id,site.id);assert.equal(Object.hasOwn(info,'worker_id'),false);
    const signup={token,name:'다른 가상 이름',loginId:'virtual_claim',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',signup)).status,409);signup.name=w.name;
    const secondReservation=createServer();await new Promise(resolve=>secondReservation.listen(0,'127.0.0.1',resolve));const secondPort=secondReservation.address().port;await new Promise(resolve=>secondReservation.close(resolve));
    second=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(secondPort),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(second.stdout,'data'),once(second,'exit').then(()=>{throw Error('두 번째 시험 서버가 종료되었습니다.');})]);
    const replies=await Promise.all([send('/api/join','POST',signup),fetch(`http://127.0.0.1:${secondPort}/api/join`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...signup,loginId:'virtual_claim2'})})]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,400]);
    assert.equal((await send(`/api/join?token=${token}`)).status,404);const records=await(await send(`/api/workers?siteId=${site.id}`,'GET',null,admin)).json();assert.equal(records.length,1);assert.equal(records[0].id,w.id);assert.equal(records[0].has_account,1);assert.equal(records[0].company,w.company);
    const winner=replies[0].status===201?'virtual_claim':'virtual_claim2',workerLogin=await send('/api/worker/login','POST',{siteKey:info.siteKey,loginId:winner,password:signup.password});assert.equal(workerLogin.status,200);
    assert.equal((await send(path,'POST',body,limited,context)).status,409);
  }finally{for(const process of [second,child])if(process&&process.exitCode===null){const exited=once(process,'exit');process.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
