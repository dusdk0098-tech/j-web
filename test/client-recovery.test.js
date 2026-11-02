import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { ClientAccounts } from '../client-accounts.js';
import { ClientRecovery,ReviewerRecovery } from '../reviewer-recovery.js';
import { ReviewerProfile } from '../reviewer-profile.js';

const account={kind:'individual',businessNumber:'',businessName:'',loginId:'virtual_client',password:'virtual-password-123',confirmPassword:'virtual-password-123',name:'가상 발주처',position:'',email:'client@example.test',phone:'010-0000-0000',acknowledged:true};
const nextPassword='virtual-new-password-456',linkToken=message=>new URLSearchParams(new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).values().next().value;

test('발주처는 확인한 이메일과 휴대전화로 아이디·암호를 찾는다',async()=>{
  const store=new Store(':memory:');let now=1000000;const messages=[];
  try{
    const clients=new ClientAccounts(store.db,()=>now),recovery=new ClientRecovery(store.db,{send:async message=>messages.push(message)},()=>now),created=clients.register(account),status=recovery.status(created.id);
    assert.equal(status.verified,false);assert.equal(status.clientId,created.id);assert.equal(recovery.prepareRequest({mode:'id',identity:account.name,phone:account.phone,email:account.email},'127.0.0.1','https://example.test'),null);
    await recovery.startVerification(created.id,status.version,'127.0.0.2','https://example.test');const verification=linkToken(messages[0]);assert.match(messages[0].text,/\/client-recovery#verify=/);
    assert.deepEqual(recovery.verify(verification,'127.0.0.3'),{ok:true});assert.equal(recovery.status(created.id).verified,true);assert.throws(()=>recovery.verify(verification,'127.0.0.4'),/링크/);
    for(const input of [{mode:'id',identity:'다른 이름',phone:account.phone,email:account.email},{mode:'id',identity:account.name,phone:'010-1111-1111',email:account.email},{mode:'password',identity:'different_id',phone:account.phone,email:account.email}])assert.equal(recovery.prepareRequest(input,'127.0.0.5','https://example.test'),null);
    const first=recovery.prepareRequest({mode:'id',identity:account.name,phone:'010 0000 0000',email:account.email},'127.0.0.6','https://example.test');assert.match(first.text,/virtual_client/);const old=linkToken(first);
    now+=60001;const second=recovery.prepareRequest({mode:'password',identity:'VIRTUAL_CLIENT',phone:account.phone,email:account.email},'127.0.0.7','https://example.test'),current=linkToken(second);assert.notEqual(current,old);
    const snapshot=store.db.prepare('SELECT * FROM client_recovery WHERE client_id=?').get(created.id);assert.equal(JSON.stringify(snapshot).includes(current),false);
    const oldSession=clients.login(account.loginId,account.password),version=clients.list()[0].version;await assert.rejects(recovery.reset({token:old,password:nextPassword,confirmPassword:nextPassword},'127.0.0.8'),/링크/);
    assert.deepEqual(await recovery.reset({token:current,password:nextPassword,confirmPassword:nextPassword},'127.0.0.9'),{email:account.email,loginId:account.loginId});assert.equal(clients.session(oldSession),null);assert.ok(clients.session(clients.login(account.loginId,nextPassword)));assert.notEqual(clients.list()[0].version,version);assert.equal(recovery.status(created.id).verified,false);
    await assert.rejects(recovery.reset({token:current,password:nextPassword,confirmPassword:nextPassword},'127.0.0.10'),/링크/);
  }finally{store.close();}
});

test('발주처 링크는 계정 변경·만료와 직원 복구 경로에서 사용할 수 없다',async()=>{
  const store=new Store(':memory:');let now=1000000;const messages=[];
  try{
    const clients=new ClientAccounts(store.db,()=>now),recovery=new ClientRecovery(store.db,{send:async message=>messages.push(message)},()=>now),profiles=new ReviewerProfile(store.db,()=>now),staff=new ReviewerRecovery(store.db,profiles,{send:async()=>{}},()=>now),created=clients.register(account);
    await recovery.startVerification(created.id,recovery.status(created.id).version,'127.0.0.1','https://example.test');const verification=linkToken(messages.at(-1));assert.throws(()=>staff.verify(verification,'127.0.0.2'),/링크/);recovery.verify(verification,'127.0.0.3');
    let reset=linkToken(recovery.prepareRequest({mode:'password',identity:account.loginId,phone:account.phone,email:account.email},'127.0.0.4','https://example.test'));now+=15*60*1000;await assert.rejects(recovery.reset({token:reset,password:nextPassword,confirmPassword:nextPassword},'127.0.0.5'),/링크/);
    now+=1;reset=linkToken(recovery.prepareRequest({mode:'id',identity:account.name,phone:account.phone,email:account.email},'127.0.0.6','https://example.test'));const version=clients.list()[0].version;clients.update(created.id,{version,active:false});await assert.rejects(recovery.reset({token:reset,password:nextPassword,confirmPassword:nextPassword},'127.0.0.7'),/링크/);
  }finally{store.close();}
});

test('발주처 이메일을 중복 확인하거나 변경 전 링크를 재사용할 수 없다',async()=>{
  const store=new Store(':memory:'),messages=[];
  try{
    const clients=new ClientAccounts(store.db),recovery=new ClientRecovery(store.db,{send:async message=>messages.push(message)}),first=clients.register(account),second=clients.register({...account,loginId:'other_client',name:'다른 가상 발주처'});
    await recovery.startVerification(first.id,recovery.status(first.id).version,'127.0.0.1','https://example.test');recovery.verify(linkToken(messages.at(-1)),'127.0.0.2');
    await recovery.startVerification(second.id,recovery.status(second.id).version,'127.0.0.3','https://example.test');assert.throws(()=>recovery.verify(linkToken(messages.at(-1)),'127.0.0.4'),error=>error.sessionStatus===409);
    const reset=linkToken(recovery.prepareRequest({mode:'id',identity:account.name,phone:account.phone,email:account.email},'127.0.0.5','https://example.test'));
    store.db.prepare('UPDATE client_accounts SET email=? WHERE id=?').run('changed@example.test',first.id);assert.equal(recovery.status(first.id).verified,false);await assert.rejects(recovery.reset({token:reset,password:nextPassword,confirmPassword:nextPassword},'127.0.0.6'),/링크/);
  }finally{store.close();}
});

test('백업에는 발주처의 이메일 확인과 복구 링크가 포함되지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-client-recovery-backup-')),store=new Store(join(dir,'jweb.sqlite')),archive=join(dir,'copy.sqlite');
  try{
    const clients=new ClientAccounts(store.db),recovery=new ClientRecovery(store.db,{send:async()=>{}}),created=clients.register(account);await recovery.startVerification(created.id,recovery.status(created.id).version,'127.0.0.1','https://example.test');
    const result=spawnSync(process.execPath,['db-copy.js','backup',archive],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);
    const backup=new DatabaseSync(archive,{readOnly:true});try{assert.equal(backup.prepare('SELECT count(*) AS n FROM client_recovery').get().n,0);}finally{backup.close();}assert.equal(store.db.prepare('SELECT count(*) AS n FROM client_recovery').get().n,1);
  }finally{store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('가상 메일 수신기와 HTTP로 발주처 계정을 복구한다',{timeout:45000},async()=>{
  const messages=[],receiver=createHttpServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;messages.push(JSON.parse(body));res.writeHead(202);res.end();});await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const dir=mkdtempSync(join(tmpdir(),'jweb-client-recovery-http-')),child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password',JWEB_RECOVERY_DELIVERY_URL:`http://127.0.0.1:${receiver.address().port}/send`,JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-delivery-token-123'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/client-recovery')).status,200);assert.equal((await send('/api/client/recovery/status')).status,401);assert.equal((await send('/api/client/register','POST',account)).status,201);
    const login=await send('/api/client/login','POST',{loginId:account.loginId,password:account.password}),cookie=login.headers.get('set-cookie').split(';')[0],status=await (await send('/api/client/recovery/status','GET',undefined,cookie)).json();
    assert.equal((await send('/api/client/recovery/verification','POST',{clientId:status.clientId+1,version:status.version},cookie)).status,409);assert.equal((await send('/api/client/recovery/verification','POST',{clientId:status.clientId,version:'old'},cookie)).status,409);
    assert.equal((await send('/api/client/recovery/verification','POST',{clientId:status.clientId,version:status.version},cookie)).status,200);assert.equal(messages.length,1);assert.equal(messages[0].to,account.email);
    const verification=linkToken(messages[0]);assert.equal((await send('/api/reviewer/recovery/verify','POST',{token:verification})).status,400);assert.equal((await send('/api/client/recovery/verify','POST',{token:verification})).status,200);
    const absent=await send('/api/client/recovery/request','POST',{mode:'id',identity:account.name,phone:'010-1111-1111',email:account.email}),found=await send('/api/client/recovery/request','POST',{mode:'id',identity:account.name,phone:account.phone,email:account.email});assert.equal(absent.status,202);assert.equal(found.status,202);assert.deepEqual(await absent.json(),await found.json());
    for(let i=0;i<100&&messages.length<2;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(messages.length,2);const reset=linkToken(messages[1]);
    for(let i=0;i<10;i++)assert.equal((await send('/api/client/login','POST',{loginId:account.loginId,password:'wrong-password'})).status,401);assert.equal((await send('/api/client/login','POST',{loginId:account.loginId,password:account.password})).status,429);
    assert.equal((await send('/api/client/recovery/reset','POST',{token:reset,password:nextPassword,confirmPassword:nextPassword})).status,200);assert.equal((await send('/api/client/recovery/reset','POST',{token:reset,password:nextPassword,confirmPassword:nextPassword})).status,400);assert.equal((await send('/api/client/session','GET',undefined,cookie)).status,401);assert.equal((await send('/api/client/login','POST',{loginId:account.loginId,password:nextPassword})).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await new Promise(resolve=>receiver.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
