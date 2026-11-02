import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('암호 복구가 저장 잠금을 기다리는 동안 계정이 중지되면 암호를 바꾸지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-recovery-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const module=pathToFileURL(join(process.cwd(),'reviewer-recovery.js')).href,trace=`import {ReviewerRecovery} from ${JSON.stringify(module)};const original=ReviewerRecovery.prototype.reset;ReviewerRecovery.prototype.reset=async function(...args){const tx=this.transaction;this.transaction=function(...items){process.stdout.write('RECOVERY_LOCK');return tx.apply(this,items)};try{return await original.apply(this,args)}finally{this.transaction=tx}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password',JWEB_RECOVERY_DELIVERY_URL:'',JWEB_RECOVERY_DELIVERY_TOKEN:''},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),password='virtual-password-123',admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),person=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'virtual_race',name:'가상 직원',password},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:person.login_id,password})).headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/api/reviewer/recovery/request','POST',{name:'가상 직원',email:'worker@example.test'})).status,503);
    let info=await (await send('/api/reviewer/profile','GET',undefined,cookie)).json();assert.equal((await send('/api/reviewer/profile','PUT',{...info.profile,email:'worker@example.test',version:info.version,currentPassword:password},cookie)).status,200);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const raw='A'.repeat(43),key=createHash('sha256').update(raw).digest('hex'),account=db.prepare('SELECT auth_version,password_hash FROM reviewers WHERE id=?').get(person.id),oldHash=Buffer.from(account.password_hash);
    db.prepare('INSERT INTO reviewer_recovery(reviewer_id,verified_email,reset_hash,reset_auth,reset_expires) VALUES(?,?,?,?,?)').run(person.id,'worker@example.test',key,account.auth_version,Date.now()+600000);
    db.exec('BEGIN IMMEDIATE');locked=true;const entered=once(child.stdout,'data'),pending=send('/api/reviewer/recovery/reset','POST',{token:raw,password:'virtual-new-password-456',confirmPassword:'virtual-new-password-456'});pending.catch(()=>{});
    assert.match(String((await entered)[0]),/RECOVERY_LOCK/);db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(person.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,400);assert.deepEqual(Buffer.from(db.prepare('SELECT password_hash FROM reviewers WHERE id=?').get(person.id).password_hash),oldHash);assert.equal(db.prepare('SELECT count(*) AS n FROM reviewer_recovery').get().n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
