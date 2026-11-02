import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

test('DB 잠금 대기 중 로그아웃이나 암호 재설정이 일어나면 이전 요청을 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-password-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const module=pathToFileURL(join(process.cwd(),'worker-password.js')).href,trace=`import {WorkerPassword} from ${JSON.stringify(module)};const original=WorkerPassword.prototype.change;WorkerPassword.prototype.change=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('WORKER_PASSWORD_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료되었습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),qr=await(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(qr.link).searchParams.get('token'),info=await(await send(`/api/join?token=${token}`)).json();
    assert.equal((await send('/api/join','POST',{token,name:'가상 근로자',loginId:'worker_race',password:'virtual-old-password',category:'직영',company:'가상 회사',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
    const login=async password=>{const response=await send('/api/worker/login','POST',{siteKey:info.siteKey,loginId:'worker_race',password});assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie').split(';')[0],data:await response.json()};};
    let session=await login('virtual-old-password');db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const id=session.data.worker.id,original=Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(id).password_hash),attempt=()=>({currentPassword:'virtual-old-password',newPassword:'virtual-new-password',confirmPassword:'virtual-new-password',reportContext:session.data.reportContext});
    db.exec('BEGIN IMMEDIATE');locked=true;let entered=once(child.stdout,'data'),pending=send('/api/worker/password','PUT',attempt(),session.cookie);pending.catch(()=>{});assert.match(String((await entered)[0]),/WORKER_PASSWORD_LOCK/);
    db.prepare('DELETE FROM worker_sessions WHERE worker_id=?').run(id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(id).password_hash),original);
    session=await login('virtual-old-password');const salt=Buffer.alloc(16,7),reset=scryptSync('virtual-admin-reset',salt,32);db.exec('BEGIN IMMEDIATE');locked=true;entered=once(child.stdout,'data');pending=send('/api/worker/password','PUT',attempt(),session.cookie);pending.catch(()=>{});assert.match(String((await entered)[0]),/WORKER_PASSWORD_LOCK/);
    db.prepare('UPDATE worker_accounts SET salt=?,password_hash=? WHERE worker_id=?').run(salt,reset,id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=?').get(id).password_hash),reset);await login('virtual-admin-reset');
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
