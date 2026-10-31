import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';

test('차단 설정은 현장·버전·잠금 후 권한을 검사한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),invite=s.createInvitation(a.id),worker=s.join(invite.token,{name:'가상',category:'직영',company:'',occupation:'목공',loginId:'test_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),initial=s.workerAccountBlock(a.id,worker.id);
    assert.deepEqual(initial,{blocked:false,version:null});assert.throws(()=>s.setWorkerAccountBlock(a.id,worker.id,{blocked:true,expectedVersion:null},()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(s.workerAccountBlock(a.id,worker.id),initial);
    assert.throws(()=>s.setWorkerAccountBlock(b.id,worker.id,{blocked:true,expectedVersion:null}),/계정/);const blocked=s.setWorkerAccountBlock(a.id,worker.id,{blocked:true,expectedVersion:null});assert.throws(()=>s.setWorkerAccountBlock(a.id,worker.id,{blocked:false,expectedVersion:null}),/변경/);assert.throws(()=>s.recordWorkerLogin(worker.id,'2026-11-01'),/차단/);assert.deepEqual(s.workerAttendance(worker.id,'2026-11'),[]);
    s.setWorkerAccountBlock(a.id,worker.id,{blocked:false,expectedVersion:blocked.version});s.recordWorkerLogin(worker.id,'2026-11-01');assert.deepEqual(s.workerAttendance(worker.id,'2026-11'),['2026-11-01']);
  }finally{s.close();}
});

test('로그인 대기 중 계정이 차단되면 출역과 세션을 만들지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-block-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.recordWorkerLogin;Store.prototype.recordWorkerLogin=function(...args){const exec=this.db.exec;this.db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('LOGIN_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{this.db.exec=exec}};`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상',category:'직영',company:'',occupation:'목공',loginId:'race_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',person)).status,201);db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const worker=db.prepare('SELECT worker_id FROM worker_accounts WHERE login_id=?').get(person.loginId).worker_id;db.exec('BEGIN IMMEDIATE');locked=true;
    const started=once(child.stdout,'data'),pending=call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password});pending.catch(()=>{});assert.match(String((await started)[0]),/LOGIN_LOCK/);db.prepare('INSERT INTO worker_account_blocks(worker_id,site_id,blocked,version) VALUES(?,?,1,?)').run(worker,site.id,'a'.repeat(32));db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,403);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE worker_id=?').get(worker).n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_sessions WHERE worker_id=?').get(worker).n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('개별 차단은 기존 세션을 종료하고 해제 후에도 재로그인이 필요하다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-block-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const user={token,name:'가상 근로자',category:'직영',company:'',occupation:'목공',loginId:'test_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await call('/api/join','POST',user)).status,201);const login=()=>call('/api/worker/login','POST',{token,loginId:user.loginId,password:user.password}),logged=await login(),session=logged.headers.get('set-cookie').split(';')[0],worker=(await logged.json()).worker,path=`/api/workers/${worker.id}/access-block`;
    assert.equal((await call(path+'?siteId='+site.id)).status,401);const initial=await (await call(path+'?siteId='+site.id,'GET',null,admin)).json();assert.deepEqual(initial,{blocked:false,version:null});
    const blocked=await call(path,'PUT',{siteId:site.id,blocked:true,expectedVersion:null},admin);assert.equal(blocked.status,200);const state=await blocked.json();assert.equal((await call('/api/worker/session','GET',null,session)).status,401);assert.equal((await login()).status,403);
    assert.equal((await call(path,'PUT',{siteId:site.id,blocked:false,expectedVersion:null},admin)).status,409);assert.equal((await call(path,'PUT',{siteId:site.id,blocked:false,expectedVersion:state.version},admin)).status,200);assert.equal((await call('/api/worker/session','GET',null,session)).status,401);assert.equal((await login()).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
