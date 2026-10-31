import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { ClientAccounts } from '../client-accounts.js';

const company={kind:'company',businessNumber:'1234567890',businessName:'가상 업체',loginId:'virtual_client',password:'virtual-password-123',confirmPassword:'virtual-password-123',name:'가상 이름',position:'가상 직위',email:'client@example.test',phone:'010-0000-0000',acknowledged:true};

test('시험 계정은 입력을 검증하고 중지·암호 변경 시 세션을 폐기한다',()=>{
  const store=new Store(':memory:');let now=1000000;const clients=new ClientAccounts(store.db,()=>now);
  try{
    for(const change of [{acknowledged:false},{businessNumber:'123'},{businessName:''},{loginId:'bad id'},{password:'short'},{confirmPassword:'different'},{email:'invalid'},{phone:'letters'}])assert.throws(()=>clients.register({...company,...change}));
    assert.equal(clients.available(company.loginId),true);const created=clients.register(company);assert.equal(created.loginId,company.loginId);
    assert.equal(clients.available('VIRTUAL_CLIENT'),false);assert.throws(()=>clients.register({...company,loginId:'VIRTUAL_CLIENT'}));
    const other=clients.register({...company,kind:'individual',businessNumber:'',businessName:'',loginId:'other_client',name:'다른 가상 이름'});assert.notEqual(other.id,created.id);
    assert.equal(clients.login(company.loginId,'wrong-password'),null);const token=clients.login(company.loginId,company.password),otherToken=clients.login('other_client',company.password);
    assert.equal(clients.session(token).name,'가상 이름');assert.equal(clients.session(otherToken).name,'다른 가상 이름');assert.equal(clients.session('invalid'),null);
    const row=store.db.prepare('SELECT token_hash FROM client_sessions WHERE client_id=?').get(created.id);assert.equal(row.token_hash,createHash('sha256').update(token).digest('hex'));assert.notEqual(row.token_hash,token);
    const account=clients.list().find(item=>item.id===created.id);assert.throws(()=>clients.update(created.id,{version:account.version,active:false},()=>{throw Error('권한 만료');}));assert.ok(clients.session(token));
    const disabled=clients.update(created.id,{version:account.version,active:false});assert.equal(clients.session(token),null);assert.ok(clients.session(otherToken));assert.equal(clients.login(company.loginId,company.password),null);
    assert.throws(()=>clients.update(created.id,{version:account.version,active:true}),error=>error.sessionStatus===409);
    const enabled=clients.update(created.id,{version:disabled.version,active:true}),next=clients.login(company.loginId,company.password);assert.ok(next);
    clients.update(created.id,{version:enabled.version,password:'virtual-new-password-456'});assert.equal(clients.session(next),null);assert.equal(clients.login(company.loginId,company.password),null);
    const fresh=clients.login(company.loginId,'virtual-new-password-456');assert.ok(clients.session(fresh));now+=28800001;assert.equal(clients.session(fresh),null);
  }finally{store.close();}
});

test('시험 서버는 가입·로그인·계정 관리와 재시작 후 세션을 연결한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-client-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  let child;const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base='http://127.0.0.1:'+port,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/client')).status,200);assert.equal((await send('/client.js')).status,200);assert.equal((await send('/api/client/session')).status,401);
    assert.equal((await send('/api/client/id-check','POST',{loginId:company.loginId})).status,200);
    assert.equal((await send('/api/client/register','POST',company)).status,201);assert.equal((await send('/api/client/register','POST',company)).status,400);
    assert.equal((await (await send('/api/client/id-check','POST',{loginId:'VIRTUAL_CLIENT'})).json()).available,false);
    const response=await send('/api/client/login','POST',{loginId:company.loginId,password:company.password});assert.equal(response.status,200);const header=response.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);const cookie=header.split(';')[0];
    const own=await (await send('/api/client/session','GET',undefined,cookie)).json();assert.equal(own.client.name,company.name);assert.equal(own.client.email,company.email);assert.equal(own.client.password,undefined);
    assert.equal((await send('/api/sites','GET',undefined,cookie)).status,401);assert.equal((await send('/api/client-accounts','GET',undefined,cookie)).status,401);
    await stop();await start();assert.equal((await send('/api/client/session','GET',undefined,cookie)).status,200);
    const db=new DatabaseSync(join(dir,'jweb.sqlite'));try{assert.equal(db.prepare('SELECT token_hash FROM client_sessions').get().token_hash,createHash('sha256').update(cookie.split('=')[1]).digest('hex'));}finally{db.close();}
    const adminResponse=await send('/api/login','POST',{password:'virtual-admin-password'}),admin=adminResponse.headers.get('set-cookie').split(';')[0],account=(await (await send('/api/client-accounts','GET',undefined,admin)).json())[0];
    assert.equal((await send('/api/client-accounts/'+account.id,'PUT',{version:account.version,active:false},cookie)).status,401);
    const disabledResponse=await send('/api/client-accounts/'+account.id,'PUT',{version:account.version,active:false},admin);assert.equal(disabledResponse.status,200);const disabled=await disabledResponse.json();assert.equal((await send('/api/client/session','GET',undefined,cookie)).status,401);
    assert.equal((await send('/api/client-accounts/'+account.id,'PUT',{version:account.version,active:true},admin)).status,409);
    const enabled=await (await send('/api/client-accounts/'+account.id,'PUT',{version:disabled.version,active:true},admin)).json();
    assert.equal((await send('/api/client-accounts/'+account.id,'PUT',{version:enabled.version,password:'virtual-new-password-456'},admin)).status,200);
    assert.equal((await send('/api/client/login','POST',{loginId:company.loginId,password:company.password})).status,401);
    const newLogin=await send('/api/client/login','POST',{loginId:company.loginId,password:'virtual-new-password-456'});assert.equal(newLogin.status,200);const newCookie=newLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/api/client/logout','POST',{},newCookie)).status,200);assert.equal((await send('/api/client/session','GET',undefined,newCookie)).status,401);
    for(let i=0;i<10;i++)assert.equal((await send('/api/client/login','POST',{loginId:'unknown_account',password:'wrong'})).status,401);
    assert.equal((await send('/api/client/login','POST',{loginId:'unknown_account',password:'wrong'})).status,429);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
