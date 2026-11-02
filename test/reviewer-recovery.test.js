import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { ReviewerProfile } from '../reviewer-profile.js';
import { ReviewerRecovery,recoveryDelivery } from '../reviewer-recovery.js';
import { ReviewerSessions } from '../auth.js';

const password='virtual-password-123',nextPassword='virtual-new-password-456',email='worker@example.test';
const linkToken=message=>{const url=new URL(message.text.match(/https?:\/\/[^\s]+/)[0]);return new URLSearchParams(url.hash.slice(1)).values().next().value;};
const profile=(profiles,id,overrides={})=>profiles.update(id,{...profiles.get(id).profile,...overrides,version:profiles.get(id).version,currentPassword:password});

test('확인된 이메일에서만 계정을 찾고 일회용 링크로 암호를 변경한다',async()=>{
  const store=new Store(':memory:');let now=1000000;const sent=[];
  try{
    const profiles=new ReviewerProfile(store.db,()=>now),recovery=new ReviewerRecovery(store.db,profiles,{send:async message=>sent.push(message)},()=>now),site=store.createSite({name:'가상 현장'}),person=store.createReviewer({siteId:site.id,loginId:'virtual_reviewer',name:'가상 직원',password});
    profile(profiles,person.id,{email});assert.deepEqual(recovery.status(person.id),{enabled:true,verified:false});
    assert.equal(recovery.prepareRequest({name:person.name,email},'127.0.0.1','https://example.test'),null);
    await recovery.startVerification(person.id,profiles.get(person.id).version,'127.0.0.2','https://example.test');const verification=linkToken(sent[0]);
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM reviewer_recovery').get()).includes(verification),false);
    assert.deepEqual(recovery.verify(verification,'127.0.0.3'),{ok:true});assert.equal(recovery.status(person.id).verified,true);assert.throws(()=>recovery.verify(verification,'127.0.0.4'),/링크/);
    assert.equal(recovery.prepareRequest({name:'다른 이름',email},'127.0.0.5','https://example.test'),null);
    const message=recovery.prepareRequest({name:person.name,email},'127.0.0.6','https://example.test'),reset=linkToken(message);assert.match(message.text,/virtual_reviewer/);
    assert.equal(recovery.prepareRequest({name:person.name,email},'127.0.0.7','https://example.test'),null);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM reviewer_recovery').get()).includes(reset),false);
    const sessions=new ReviewerSessions(store.db),auth=store.authenticateReviewer(person.login_id,password,true),sessionHash=createHash('sha256').update('session').digest('hex');assert.equal(sessions.issue(sessionHash,{id:person.id,expires:now+600000},auth.credentialHash,auth.authVersion,''),true);
    await assert.rejects(recovery.reset({token:reset,password:nextPassword,confirmPassword:'다른 암호'},'127.0.0.8'),/새 암호/);
    assert.deepEqual(await recovery.reset({token:reset,password:nextPassword,confirmPassword:nextPassword},'127.0.0.9'),{email,loginId:person.login_id});assert.equal(store.authenticateReviewer(person.login_id,password),null);assert.equal(store.authenticateReviewer(person.login_id,nextPassword).id,person.id);assert.equal(sessions.get(sessionHash),undefined);assert.equal(recovery.status(person.id).verified,false);
    await assert.rejects(recovery.reset({token:reset,password:nextPassword,confirmPassword:nextPassword},'127.0.0.10'),/링크/);
  }finally{store.close();}
});

test('만료·프로필 변경·관리자 암호 변경 후에는 기존 링크를 사용할 수 없다',async()=>{
  const store=new Store(':memory:');let now=1000000;const sent=[];
  try{
    const profiles=new ReviewerProfile(store.db,()=>now),recovery=new ReviewerRecovery(store.db,profiles,{send:async message=>sent.push(message)},()=>now),site=store.createSite({name:'가상 현장'}),person=store.createReviewer({siteId:site.id,loginId:'virtual_expiry',name:'가상 직원',password});
    profile(profiles,person.id,{email});await recovery.startVerification(person.id,profiles.get(person.id).version,'127.0.0.1','https://example.test');const expired=linkToken(sent.at(-1));now+=15*60*1000;assert.throws(()=>recovery.verify(expired,'127.0.0.2'),/링크/);
    await recovery.startVerification(person.id,profiles.get(person.id).version,'127.0.0.3','https://example.test');const changed=linkToken(sent.at(-1));profile(profiles,person.id,{email:'other@example.test'});assert.throws(()=>recovery.verify(changed,'127.0.0.4'),/링크/);
    await recovery.startVerification(person.id,profiles.get(person.id).version,'127.0.0.5','https://example.test');recovery.verify(linkToken(sent.at(-1)),'127.0.0.6');const reset=linkToken(recovery.prepareRequest({name:person.name,email:'other@example.test'},'127.0.0.7','https://example.test'));
    store.updateReviewer(site.id,person.id,{password:nextPassword});await assert.rejects(recovery.reset({token:reset,password,confirmPassword:password},'127.0.0.8'),/링크/);assert.equal(recovery.status(person.id).verified,false);
  }finally{store.close();}
});

test('이메일 중복 확인과 전송 중 변경된 주소는 복구 권한을 얻지 못한다',async()=>{
  const store=new Store(':memory:');let sent=[],release,hold=false;
  try{
    const profiles=new ReviewerProfile(store.db),recovery=new ReviewerRecovery(store.db,profiles,{send:message=>{sent.push(message);return hold?new Promise(resolve=>{release=resolve;}):Promise.resolve();}}),site=store.createSite({name:'가상 현장'}),first=store.createReviewer({siteId:site.id,loginId:'virtual_first',name:'직원 하나',password}),second=store.createReviewer({siteId:site.id,loginId:'virtual_second',name:'직원 둘',password});
    profile(profiles,first.id,{email});profile(profiles,second.id,{email});
    await recovery.startVerification(first.id,profiles.get(first.id).version,'127.0.0.1','https://example.test');recovery.verify(linkToken(sent.at(-1)),'127.0.0.2');
    await recovery.startVerification(second.id,profiles.get(second.id).version,'127.0.0.3','https://example.test');assert.throws(()=>recovery.verify(linkToken(sent.at(-1)),'127.0.0.4'),error=>error.sessionStatus===409);assert.equal(recovery.status(second.id).verified,false);
    hold=true;const pending=recovery.startVerification(first.id,profiles.get(first.id).version,'127.0.0.5','https://example.test'),old=linkToken(sent.at(-1));profile(profiles,first.id,{email:'changed@example.test'});release();await pending;
    assert.throws(()=>recovery.verify(old,'127.0.0.6'),/링크/);assert.equal(recovery.status(first.id).verified,false);assert.equal(recovery.prepareRequest({name:first.name,email},'127.0.0.7','https://example.test'),null);
  }finally{store.close();}
});

test('전달 설정은 비활성 기본값과 HTTPS 또는 로컬 시험 주소만 허용한다',async()=>{
  assert.equal(recoveryDelivery({}),null);assert.throws(()=>recoveryDelivery({JWEB_RECOVERY_DELIVERY_URL:'http://example.test/send',JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-token-123456'}),/설정/);
  assert.throws(()=>recoveryDelivery({JWEB_RECOVERY_DELIVERY_URL:'https://example.test/send?key=bad',JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-token-123456'}),/설정/);
  let options;const delivery=recoveryDelivery({JWEB_RECOVERY_DELIVERY_URL:'http://127.0.0.1:1234/send',JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-token-123456'},async(url,input)=>{options=input;return {ok:true};});
  await delivery.send({to:email,subject:'가상 제목',text:'가상 내용'});assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer virtual-token-123456');assert.deepEqual(JSON.parse(options.body),{to:email,subject:'가상 제목',text:'가상 내용'});
});

test('백업은 확인 이메일과 대기 중인 복구 링크를 복사하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-recovery-backup-')),path=join(dir,'jweb.sqlite'),archive=join(dir,'copy.sqlite'),store=new Store(path);
  try{
    const profiles=new ReviewerProfile(store.db),recovery=new ReviewerRecovery(store.db,profiles,{send:async()=>{}}),site=store.createSite({name:'가상 현장'}),person=store.createReviewer({siteId:site.id,loginId:'virtual_backup',name:'가상 직원',password});
    profile(profiles,person.id,{email});await recovery.startVerification(person.id,profiles.get(person.id).version,'127.0.0.1','https://example.test');
    const result=spawnSync(process.execPath,['db-copy.js','backup',archive],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);
    const backup=new DatabaseSync(archive,{readOnly:true});try{assert.equal(backup.prepare('SELECT count(*) AS n FROM reviewer_recovery').get().n,0);}finally{backup.close();}assert.equal(store.db.prepare('SELECT count(*) AS n FROM reviewer_recovery').get().n,1);
  }finally{store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('가상 이메일 전달 서버와 실제 HTTP로 직원 계정 복구를 수행한다',{timeout:45000},async()=>{
  const mails=[],receiver=createHttpServer(async(req,res)=>{let text='';for await(const part of req)text+=part;mails.push({headers:req.headers,...JSON.parse(text)});res.writeHead(202);res.end();});
  await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));const receiverPort=receiver.address().port,reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const dir=mkdtempSync(join(tmpdir(),'jweb-recovery-http-')),child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password',JWEB_RECOVERY_DELIVERY_URL:`http://127.0.0.1:${receiverPort}/send`,JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-delivery-token-123'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/review-recovery')).status,200);assert.equal((await send('/review-recovery.js')).status,200);assert.equal((await send('/api/reviewer/profile/recovery')).status,401);
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),person=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'virtual_http',name:'가상 직원',password},admin)).json(),oldCookie=(await send('/api/reviewer/login','POST',{loginId:person.login_id,password})).headers.get('set-cookie').split(';')[0];
    let info=await (await send('/api/reviewer/profile','GET',undefined,oldCookie)).json();assert.equal((await send('/api/reviewer/profile','PUT',{...info.profile,email,version:info.version,currentPassword:password},oldCookie)).status,200);
    info=await (await send('/api/reviewer/profile','GET',undefined,oldCookie)).json();assert.equal((await send('/api/reviewer/profile/recovery','POST',{version:info.version},oldCookie)).status,200);assert.equal(mails.length,1);assert.equal(mails[0].to,email);assert.equal(mails[0].headers.authorization,'Bearer virtual-delivery-token-123');
    const verification=linkToken(mails[0]);assert.equal((await send('/api/reviewer/recovery/verify','POST',{token:verification})).status,200);assert.equal((await send('/api/reviewer/recovery/verify','POST',{token:verification})).status,400);
    const absent=await send('/api/reviewer/recovery/request','POST',{name:'다른 이름',email}),found=await send('/api/reviewer/recovery/request','POST',{name:person.name,email});assert.equal(absent.status,202);assert.equal(found.status,202);assert.deepEqual(await absent.json(),await found.json());
    for(let i=0;i<100&&mails.length<2;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(mails.length,2);const reset=linkToken(mails[1]);assert.match(mails[1].text,/virtual_http/);
    for(let i=0;i<10;i++)assert.equal((await send('/api/reviewer/login','POST',{loginId:person.login_id,password:'wrong-password'})).status,401);
    assert.equal((await send('/api/reviewer/login','POST',{loginId:person.login_id,password})).status,429);
    assert.equal((await send('/api/reviewer/recovery/reset','POST',{token:reset,password:nextPassword,confirmPassword:nextPassword})).status,200);assert.equal((await send('/api/reviewer/recovery/reset','POST',{token:reset,password,confirmPassword:password})).status,400);
    assert.equal((await send('/api/reviewer/session','GET',undefined,oldCookie)).status,401);assert.equal((await send('/api/reviewer/login','POST',{loginId:person.login_id,password})).status,401);assert.equal((await send('/api/reviewer/login','POST',{loginId:person.login_id,password:nextPassword})).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await new Promise(resolve=>receiver.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
