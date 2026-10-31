import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,unlinkSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once,EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

function waitOutput(child,marker,timeout=15000){
  return new Promise((resolve,reject)=>{
    let output='';
    const finish=error=>{clearTimeout(timer);child.stdout.off('data',read);child.stdout.off('error',failed);child.off('exit',ended);child.off('error',failed);error?reject(error):resolve();},read=chunk=>{output+=String(chunk);if(output.includes(marker))finish();else output=output.slice(-(marker.length-1));},ended=()=>finish(new Error('시험 서버가 신호 전에 종료되었습니다.')),failed=error=>finish(error),timer=setTimeout(()=>finish(new Error('시험 서버 신호 대기 시간 초과: '+marker)),timeout);
    child.stdout.on('data',read);child.stdout.once('error',failed);child.once('exit',ended);child.once('error',failed);
    if(child.exitCode!==null||child.signalCode)ended();
  });
}

test('서버 신호는 분할 청크를 합치고 다른 신호·종료·시간 초과를 구별한다',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),exitCode:null,signalCode:null});
  const pending=waitOutput(child,'ACCOUNT_STARTED');child.stdout.write('BODY_STARTEDACCO');child.stdout.write('UNT_');child.stdout.write('STARTED');await pending;
  assert.equal(child.stdout.listenerCount('data'),0);assert.equal(child.listenerCount('exit'),0);
  const ended=waitOutput(child,'BODY_STARTED');child.emit('exit',1);await assert.rejects(ended,/종료/);
  await assert.rejects(waitOutput(child,'BODY_STARTED',10),/시간 초과/);child.exitCode=1;await assert.rejects(waitOutput(child,'BODY_STARTED'),/종료/);
  assert.equal(child.stdout.listenerCount('data'),0);assert.equal(child.listenerCount('error'),0);child.stdout.destroy();
});

test('계정과 권한은 현장·중복 검사를 유지하고 실패 시 암호와 세션을 함께 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 가상 현장'}),input={siteId:site.id,loginId:'account_test',name:'가상 직원',password:'virtual-password-123'},reviewer=s.createReviewer(input),invitation=s.createInvitation(site.id),worker=s.join(invitation.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'worker_test',password:input.password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),deny=()=>{throw Error('세션 만료');};
    s.db.prepare('INSERT INTO reviewer_sessions VALUES(?,?,?,?)').run('a'.repeat(64),reviewer.id,Date.now()+60000,Buffer.alloc(32));s.db.prepare('INSERT INTO worker_sessions VALUES(?,?,?,?)').run('b'.repeat(64),worker.id,Date.now()+60000,Buffer.alloc(32));s.setWorkerPermissions(site.id,worker.id,['risk']);
    const snapshot=()=>JSON.stringify(['reviewers','reviewer_sessions','worker_accounts','worker_sessions','worker_permissions','site_worker_blocks'].map(table=>s.db.prepare(`SELECT * FROM ${table}`).all())),before=snapshot();
    for(const change of [()=>s.createReviewer({...input,loginId:'denied'},deny),()=>s.updateReviewer(site.id,reviewer.id,{password:'replacement-password-123',active:false},deny),()=>s.setWorkerPermissions(site.id,worker.id,['attendance'],deny),()=>s.resetWorkerPassword(site.id,worker.id,'replacement-password-123',deny),()=>s.setWorkerAccessBlock(site.id,'2026-10-31','holiday',true,deny)]){assert.throws(change,/세션 만료/);assert.equal(snapshot(),before);}
    assert.throws(()=>s.createReviewer(input),/이미 사용/);assert.throws(()=>s.createReviewer({...input,siteId:999999,loginId:'missing_site'}),/현장/);assert.throws(()=>s.updateReviewer(other.id,reviewer.id,{active:false}),/현장/);assert.throws(()=>s.resetWorkerPassword(other.id,worker.id,'replacement-password-123'),/현장/);assert.throws(()=>s.setWorkerPermissions(other.id,worker.id,['attendance']),/현장/);assert.equal(snapshot(),before);
    for(const [table,change] of [['reviewer_sessions',()=>s.updateReviewer(site.id,reviewer.id,{password:'replacement-password-123',active:false})],['worker_sessions',()=>s.resetWorkerPassword(site.id,worker.id,'replacement-password-123')],['worker_permissions',()=>s.setWorkerPermissions(site.id,worker.id,['attendance'])]]){s.db.exec(`CREATE TRIGGER fail_account_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'시험 삭제 실패'); END`);assert.throws(change,/시험 삭제 실패/);assert.equal(snapshot(),before);s.db.exec('DROP TRIGGER fail_account_delete');}
    s.db.exec("CREATE TRIGGER fail_account_insert BEFORE INSERT ON worker_permissions BEGIN SELECT RAISE(ABORT,'시험 추가 실패'); END");assert.throws(()=>s.setWorkerPermissions(site.id,worker.id,['attendance']),/시험 추가 실패/);assert.equal(snapshot(),before);s.db.exec('DROP TRIGGER fail_account_insert');
    s.updateReviewer(site.id,reviewer.id,{password:'replacement-password-123'});assert.equal(s.authenticateReviewer(input.loginId,input.password),null);assert.equal(s.authenticateReviewer(input.loginId,'replacement-password-123').id,reviewer.id);assert.equal(s.db.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n,0);
    s.resetWorkerPassword(site.id,worker.id,'replacement-password-123');assert.equal(s.authenticateWorker(invitation.token,'worker_test',input.password),null);assert.equal(s.authenticateWorker(invitation.token,'worker_test','replacement-password-123').id,worker.id);assert.equal(s.db.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,0);
    assert.deepEqual(s.setWorkerPermissions(site.id,worker.id,['attendance']),['attendance']);
  }finally{s.close();}
});

test('관리자 계정과 위임권한 변경은 본문 수신 중 로그아웃과 DB 잠금 대기 중 만료를 재확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-admin-account-')),flag=join(dir,'expired'),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const storeUrl=pathToFileURL(join(process.cwd(),'store.js')).href,authUrl=pathToFileURL(join(process.cwd(),'auth.js')).href;
  const trace=`import {existsSync} from 'node:fs';import http from 'node:http';import {Store} from ${JSON.stringify(storeUrl)};import {LocalAuth} from ${JSON.stringify(authUrl)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-test-slow']==='1')req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('SERVER_READY'));return server};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(flag)})?9*60*60*1000:0))};for(const name of ['createReviewer','updateReviewer','setWorkerPermissions','resetWorkerPassword','setWorkerAccessBlock']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('ACCOUNT_STARTED');return original.apply(this,args)}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await waitOutput(child,'SERVER_READY');
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async()=>{const r=await send('/api/login','POST',{password:'virtual-admin-password'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
    let admin=await login();const site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),account={siteId:site.id,loginId:'virtual_reviewer',name:'가상 직원',password:'virtual-password-123'},reviewer=await(await send('/api/reviewers','POST',account,admin)).json(),invite=await(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    assert.equal((await send('/api/join','POST',{token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const worker=db.prepare('SELECT id FROM workers WHERE site_id=?').get(site.id);
    const cases=[['/api/reviewers','POST',{...account,loginId:'late_reviewer'}],['/api/reviewers/'+reviewer.id,'PUT',{siteId:site.id,active:false}],['/api/workers/'+worker.id+'/permissions','PUT',{siteId:site.id,permissions:['attendance']}],['/api/workers/'+worker.id+'/password','PUT',{siteId:site.id,password:'replacement-password-123'}],['/api/sites/'+site.id+'/worker-access-blocks','PUT',{date:'2026-10-31',kind:'holiday',blocked:true}]],bodyResults=[],lockResults=[],originalHash=Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(worker.id).password_hash);
    for(const [path,method,data] of cases){
      const raw=JSON.stringify(data),started=waitOutput(child,'BODY_STARTED');let finish;const pending=new Promise((resolve,reject)=>{const req=request(base+path,{method,agent:false,headers:{cookie:admin,'x-test-slow':'1','content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(raw.slice(0,-1));finish=()=>req.end(raw.slice(-1));});pending.catch(()=>{});
      await started;assert.equal((await send('/api/logout','POST',{},admin)).status,200);finish();bodyResults.push(await pending);admin=await login();
    }
    assert.deepEqual(bodyResults,[401,401,401,401,401]);
    for(const [path,method,data] of cases){
      db.exec('BEGIN IMMEDIATE');locked=true;const started=waitOutput(child,'ACCOUNT_STARTED'),pending=send(path,method,data,admin);pending.catch(()=>{});await started;writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;lockResults.push((await pending).status);unlinkSync(flag);admin=await login();
    }
    assert.deepEqual(lockResults,[401,401,401,401,401]);
    assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(worker.id).password_hash),originalHash);assert.equal(db.prepare('SELECT count(*) AS n FROM site_worker_blocks').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM reviewers').get().n,1);assert.equal(db.prepare('SELECT active FROM reviewers WHERE id=?').get(reviewer.id).active,1);assert.equal(db.prepare('SELECT count(*) AS n FROM worker_permissions').get().n,0);
    const other=await(await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json();
    const changeWhileLocked=async(index,change)=>{const [path,method,data]=cases[index];db.exec('BEGIN IMMEDIATE');locked=true;const started=waitOutput(child,'ACCOUNT_STARTED'),pending=send(path,method,data,admin);pending.catch(()=>{});await started;change();db.exec('COMMIT');locked=false;return (await pending).status;};
    assert.equal(await changeWhileLocked(1,()=>db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(other.id,reviewer.id)),400);assert.equal(db.prepare('SELECT active FROM reviewers WHERE id=?').get(reviewer.id).active,1);db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(site.id,reviewer.id);
    assert.equal(await changeWhileLocked(2,()=>db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(other.id,worker.id)),400);assert.equal(db.prepare('SELECT count(*) AS n FROM worker_permissions').get().n,0);db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(site.id,worker.id);
    assert.equal(await changeWhileLocked(3,()=>db.prepare('UPDATE worker_accounts SET site_id=? WHERE worker_id=?').run(other.id,worker.id)),400);assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(worker.id).password_hash),originalHash);db.prepare('UPDATE worker_accounts SET site_id=? WHERE worker_id=?').run(site.id,worker.id);
    assert.equal(await changeWhileLocked(0,()=>db.prepare("INSERT INTO reviewers(site_id,login_id,name,salt,password_hash,auth_version) SELECT site_id,'late_reviewer',name,salt,password_hash,auth_version FROM reviewers WHERE id=?").run(reviewer.id)),400);assert.equal(db.prepare("SELECT count(*) AS n FROM reviewers WHERE login_id='late_reviewer'").get().n,1);db.prepare("DELETE FROM reviewers WHERE login_id='late_reviewer'").run();
    for(const [path,method,data] of cases)assert.equal((await send(path,method,data,admin)).status,method==='POST'?201:200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM reviewers').get().n,2);assert.equal(db.prepare('SELECT active FROM reviewers WHERE id=?').get(reviewer.id).active,0);assert.equal(db.prepare('SELECT count(*) AS n FROM worker_permissions').get().n,1);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}if(existsSync(flag))unlinkSync(flag);rmSync(dir,{recursive:true,force:true});}
});
