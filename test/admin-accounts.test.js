import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AdminAccounts } from '../admin-accounts.js';
import { adminWriteGuard } from '../admin-write-guard.js';
import { readCommunityHash } from '../public/community-navigation.js';
import { Store } from '../store.js';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const password='virtual-admin-password';
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
function output(child,text){return new Promise((resolve,reject)=>{let seen='';const timer=setTimeout(()=>{child.stdout.off('data',read);reject(Error('시험 신호 대기 실패: '+text));},30000);function read(chunk){seen+=chunk;if(seen.includes(text)){clearTimeout(timer);child.stdout.off('data',read);resolve();}}child.stdout.on('data',read);});}

test('관리자 검증·이관·마지막 활성 관리자·버전 충돌·세션 폐기·제한',()=>{
  const db=new DatabaseSync(':memory:');let now=1000;const auth=new AdminAccounts(db,()=>now);
  try{
    assert.throws(()=>auth.bootstrap(undefined));assert.throws(()=>auth.bootstrap('short'));auth.bootstrap(password);
    const first=auth.list()[0];assert.equal(first.login_id,'admin');const token=auth.login(undefined,password);assert.ok(auth.valid(token));
    auth.bootstrap('changed-environment-password');assert.equal(auth.login('admin','changed-environment-password'),null);
    assert.throws(()=>auth.update(first.id,{version:first.version,active:false}),/마지막/);
    for(const input of [{loginId:'bad id',name:'가상',password},{loginId:'new',name:'',password},{loginId:'new',name:'가상',password:'short'}])assert.throws(()=>auth.create(input));
    const second=auth.create({loginId:'other_admin',name:'다른 가상 관리자',password});assert.throws(()=>auth.create({loginId:'OTHER_ADMIN',name:'가상',password}));
    assert.throws(()=>auth.update(second.id,{version:second.version,name:'바뀐 이름'},()=>{throw Error('권한 만료');}));
    const renamed=auth.update(second.id,{version:second.version,name:'바뀐 이름'});assert.equal(renamed.name,'바뀐 이름');
    assert.throws(()=>auth.update(second.id,{version:second.version,revoke:true}),e=>e.sessionStatus===409);
    const otherToken=auth.login('other_admin',password),stopped=auth.update(second.id,{version:renamed.version,active:false});assert.equal(auth.valid(otherToken),false);assert.equal(auth.login('other_admin',password),null);assert.ok(auth.valid(token));
    const resumed=auth.update(second.id,{version:stopped.version,active:true}),fresh=auth.login('other_admin',password);assert.ok(fresh);auth.update(second.id,{version:resumed.version,revoke:true});assert.equal(auth.valid(fresh),false);
    const reset=auth.update(first.id,{version:first.version,password:'replacement-password-123'});assert.equal(auth.valid(token),false);assert.equal(auth.login(undefined,password),null);
    const next=auth.login('admin','replacement-password-123');assert.ok(next);const switched=auth.login('other_admin',password,next);assert.equal(auth.valid(next),false);assert.ok(auth.valid(switched));
    const hashes=db.prepare('SELECT salt,password_hash FROM admin_accounts').all();assert.ok(hashes.every(row=>row.salt.length===16&&row.password_hash.length===32));assert.notDeepEqual(hashes[0].salt,hashes[1].salt);assert.equal(reset.password_hash,undefined);
    for(let i=0;i<10;i++)assert.equal(auth.login('unknown_admin','wrong'),null);assert.throws(()=>auth.login('unknown_admin','wrong'),e=>e.sessionStatus===429);now+=300001;assert.equal(auth.login('unknown_admin','wrong'),null);
    now+=28800001;assert.equal(auth.valid(switched),false);
  }finally{db.close();}
});

test('공통 쓰기 가드는 INSERT·UPDATE·DELETE와 트랜잭션을 거절하고 타 역할은 유지한다',()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO items VALUES(1,\'before\')');const scope=adminWriteGuard(db),req={adminProtected:true,checkSession:()=>({status:401,error:'만료'})};
  try{
    for(const sql of ["INSERT INTO items VALUES(2,'new')","UPDATE items SET value='after'","DELETE FROM items"]){scope.run(req,()=>assert.throws(()=>db.exec(sql),/관리자 세션/));assert.deepEqual({...db.prepare('SELECT * FROM items').get()},{id:1,value:'before'});}
    scope.run({adminProtected:false},()=>db.exec("UPDATE items SET value='other-role'"));assert.equal(db.prepare('SELECT value FROM items').get().value,'other-role');
  }finally{db.close();}
});

test('관리자 HTTP·본문 변경·쓰기 잠금 뒤 폐기·재시작·백업 복원',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-admin-accounts-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const preload=`import http from 'node:http';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-slow'])req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('READY'));return server};const original=Store.prototype.createSite;Store.prototype.createSite=function(...args){process.stdout.write('SITE_WRITE');return original.apply(this,args)};`;
  let child,db;const start=async(envPassword=password,dataDir=dir)=>{child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dataDir,JWEB_ADMIN_PASSWORD:envPassword},stdio:['ignore','pipe','pipe']});await output(child,'READY');};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base='http://127.0.0.1:'+port,send=(path,method='GET',data,cookie,headers={})=>fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const login=async(loginId='admin',pass=password,old)=>{const r=await send('/api/login','POST',{loginId,password:pass},old);assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
    let cookie=await login();let session=await(await send('/api/session','GET',undefined,cookie)).json();assert.equal(session.admin.loginId,'admin');assert.match(session.context,/^[a-f0-9]{64}$/);
    assert.equal((await send('/api/admin-accounts')).status,401);assert.equal((await send('/admin-session.js')).status,200);
    const initial=(await(await send('/api/admin-accounts','GET',undefined,cookie)).json())[0];
    assert.equal((await send('/api/admin-accounts/'+initial.id,'PUT',{version:initial.version,active:false},cookie)).status,400);
    const created=await send('/api/admin-accounts','POST',{loginId:'other_admin',name:'가상 관리자',password},cookie);assert.equal(created.status,201);const other=await created.json();
    const context={'origin':base,'x-admin-context':session.context};assert.equal((await send('/api/sites','POST',{name:'가상 허용 현장'},cookie,context)).status,201);
    assert.equal((await send('/api/sites','POST',{name:'누락 현장'},cookie,{origin:base})).status,409);
    const next=await login('other_admin',password,cookie);assert.equal((await(await send('/api/session','GET',undefined,cookie)).json()).authenticated,false);
    assert.equal((await send('/api/sites','POST',{name:'오래된 화면 현장'},next,context)).status,409);assert.equal((await send('/api/logout','POST',{},next,context)).status,409);
    cookie=await login();db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    const raw=JSON.stringify({name:'본문 중지 현장'}),started=output(child,'BODY_STARTED');let finish;
    const pending=new Promise((resolve,reject)=>{const req=request(base+'/api/sites',{method:'POST',headers:{cookie,'x-slow':'1','content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(raw.slice(0,-1));finish=()=>req.end(raw.slice(-1));});
    await started;const accounts=new AdminAccounts(db),row=accounts.list().find(r=>r.id===initial.id);accounts.update(row.id,{version:row.version,password:'replacement-password-123'});finish();assert.equal(await pending,401);
    for(const revoke of ['sessions','active','credentials']){
      cookie=await login('admin','replacement-password-123');db.exec('BEGIN IMMEDIATE');const writing=output(child,'SITE_WRITE'),blocked=send('/api/sites','POST',{name:'잠금 중지 현장'},cookie);await writing;
      if(revoke==='sessions')db.exec('DELETE FROM admin_sessions');else if(revoke==='active')db.prepare('UPDATE admin_accounts SET active=0 WHERE id=?').run(initial.id);else db.prepare("UPDATE admin_accounts SET auth_version=lower(hex(randomblob(16))) WHERE id=?").run(initial.id);
      db.exec('COMMIT');assert.equal((await blocked).status,401);db.prepare('UPDATE admin_accounts SET active=1 WHERE id=?').run(initial.id);
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM sites').get().n,1);
    cookie=await login('admin','replacement-password-123');const current=accounts.list().find(r=>r.id===initial.id);
    assert.equal((await send('/api/admin-accounts/'+current.id,'PUT',{version:current.version,revoke:true},cookie)).status,200);assert.equal((await(await send('/api/session','GET',undefined,cookie)).json()).authenticated,false);
    cookie=await login('admin','replacement-password-123');const fresh=accounts.list().find(r=>r.id===initial.id);assert.equal((await send('/api/admin-accounts/'+fresh.id,'PUT',{version:fresh.version,password:'final-password-123'},cookie)).status,200);assert.equal((await(await send('/api/session','GET',undefined,cookie)).json()).authenticated,false);
    cookie=await login('admin','final-password-123');await stop();await start('ignored-environment-password');assert.equal((await(await send('/api/session','GET',undefined,cookie)).json()).authenticated,true);assert.equal((await send('/api/login','POST',{password:'ignored-environment-password'})).status,401);
    const archive=join(dir,'backup.sqlite'),restored=join(dir,'restored');mkdirSync(restored);
    for(const args of [['backup',archive],['restore',archive,restored]]){const result=spawnSync(process.execPath,['db-copy.js',...args],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    for(const path of [archive,join(restored,'jweb.sqlite')]){const copy=new DatabaseSync(path);try{assert.equal(copy.prepare('SELECT count(*) AS n FROM admin_accounts').get().n,2);assert.equal(copy.prepare('SELECT count(*) AS n FROM admin_sessions').get().n,0);assert.ok(new AdminAccounts(copy).login('admin','final-password-123'));}finally{copy.close();}}
    await stop();await start('',restored);assert.equal((await(await send('/api/session','GET',undefined,cookie)).json()).authenticated,false);await login('admin','final-password-123');
    assert.equal(other.login_id,'other_admin');
  }finally{db?.close();await stop();cleanup(dir);}
});

test('브라우저 공통 fetch는 JSON·바이너리·모듈 요청 모두 최초 문맥을 고정한다',async()=>{
  const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];let current='initial-context';globalThis.location={href:'http://localhost/',origin:'http://localhost'};
  globalThis.fetch=async(input,options)=>{calls.push({input,options});return {ok:true,json:async()=>({authenticated:true,context:current,admin:{name:'가상 관리자'}})};};
  try{
    const source=readFileSync(new URL('../public/admin-session.js',import.meta.url),'utf8');const module=await import('data:text/javascript,'+encodeURIComponent(source));await module.adminSession;current='changed-context';
    for(const body of ['{}',new Uint8Array([1,2])])await fetch('/api/sites',{method:'POST',body});await fetch(new Request('http://localhost/api/photos',{method:'POST',body:'file'}));await fetch('/api/session');await fetch('/api/sites',{method:'DELETE'});
    assert.equal(calls.length,6);for(const call of calls.slice(1))assert.equal(call.options.headers.get('x-admin-context'),'initial-context');
    await fetch('https://example.test/',{method:'POST'});assert.equal(calls.at(-1).options.headers,undefined);
  }finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
});

test('최초 미인증 화면은 다른 탭 로그인 후에도 요청을 보내지 않고 로그인으로 이동한다',async()=>{
  const oldFetch=globalThis.fetch,oldLocation=globalThis.location,calls=[];let current={authenticated:false,context:null};globalThis.location={href:'http://localhost/',origin:'http://localhost'};
  globalThis.fetch=async(input,options)=>{calls.push({input,options});return {ok:true,json:async()=>current};};
  try{
    const source=readFileSync(new URL('../public/admin-session.js',import.meta.url),'utf8'),module=await import('data:text/javascript,'+encodeURIComponent(source+'\n// initial-unauthenticated'));
    await module.adminSession;current={authenticated:true,context:'different-session'};
    for(const options of [{method:'POST',body:'{}'},{method:'POST',body:new Uint8Array([1])},{method:'DELETE'},{}])await assert.rejects(fetch('/api/sites',options),/다시 로그인하고 새로고침/);
    assert.equal(calls.length,1);
    const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),bootstrap=app.slice(app.lastIndexOf('try {const session=await adminSession;')),redirects=[],errors=[];
    await runInNewContext('(async()=>{'+bootstrap+'})()',{adminSession:module.adminSession,readCommunityHash,location:{hash:'',assign:path=>redirects.push(path)},showError:error=>errors.push(error.message)});
    assert.deepEqual(redirects,['/login']);assert.equal(errors.length,1);
  }finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
});
