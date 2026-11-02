import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('발주처 복구는 잠금 대기 중 로그아웃과 계정 중지를 다시 확인한다',{timeout:30000},async()=>{
  let delivered=0;const receiver=createHttpServer((req,res)=>{delivered++;res.writeHead(202);res.end();});await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  const dir=mkdtempSync(join(tmpdir(),'jweb-client-recovery-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const module=pathToFileURL(join(process.cwd(),'reviewer-recovery.js')).href,trace=`import {ClientRecovery} from ${JSON.stringify(module)};for(const [name,marker] of [['startVerification','VERIFY_LOCK'],['reset','RESET_LOCK']]){const original=ClientRecovery.prototype[name];ClientRecovery.prototype[name]=async function(...args){const tx=this.transaction;this.transaction=function(...items){process.stdout.write(marker);return tx.apply(this,items)};try{return await original.apply(this,args)}finally{this.transaction=tx}}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password',JWEB_RECOVERY_DELIVERY_URL:`http://127.0.0.1:${receiver.address().port}/send`,JWEB_RECOVERY_DELIVERY_TOKEN:'virtual-delivery-token-123'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),account={kind:'individual',businessNumber:'',businessName:'',loginId:'virtual_race',password:'virtual-password-123',confirmPassword:'virtual-password-123',name:'가상 발주처',position:'',email:'client@example.test',phone:'010-0000-0000',acknowledged:true};
    assert.equal((await send('/api/client/register','POST',account)).status,201);let cookie=(await send('/api/client/login','POST',{loginId:account.loginId,password:account.password})).headers.get('set-cookie').split(';')[0],status=await (await send('/api/client/recovery/status','GET',undefined,cookie)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;let entered=once(child.stdout,'data'),pending=send('/api/client/recovery/verification','POST',{clientId:status.clientId,version:status.version},cookie);pending.catch(()=>{});
    assert.match(String((await entered)[0]),/VERIFY_LOCK/);db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(status.clientId);db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT count(*) AS n FROM client_recovery').get().n,0);assert.equal(delivered,0);
    cookie=(await send('/api/client/login','POST',{loginId:account.loginId,password:account.password})).headers.get('set-cookie').split(';')[0];status=await (await send('/api/client/recovery/status','GET',undefined,cookie)).json();const raw='A'.repeat(43),key=createHash('sha256').update(raw).digest('hex'),row=db.prepare('SELECT auth_version,password_hash FROM client_accounts WHERE id=?').get(status.clientId),oldHash=Buffer.from(row.password_hash);
    db.prepare('INSERT INTO client_recovery(client_id,verified_email,reset_hash,reset_auth,reset_expires) VALUES(?,?,?,?,?)').run(status.clientId,account.email,key,row.auth_version,Date.now()+600000);db.exec('BEGIN IMMEDIATE');locked=true;entered=once(child.stdout,'data');pending=send('/api/client/recovery/reset','POST',{token:raw,password:'virtual-new-password-456',confirmPassword:'virtual-new-password-456'});pending.catch(()=>{});
    assert.match(String((await entered)[0]),/RESET_LOCK/);db.prepare('UPDATE client_accounts SET active=0 WHERE id=?').run(status.clientId);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM client_accounts WHERE id=?').get(status.clientId).password_hash),oldHash);assert.equal(db.prepare('SELECT count(*) AS n FROM client_recovery').get().n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await new Promise(resolve=>receiver.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
