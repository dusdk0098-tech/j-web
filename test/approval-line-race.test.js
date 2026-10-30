import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('결재선과 참조자 변경은 저장 대기 중 상태와 계정을 다시 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-approval-line-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};for(const name of ['setApprovalLine','setOfficeReferences']){const original=Store.prototype[name];Store.prototype[name]=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('APPROVAL_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),make=async loginId=>(await (await send('/api/reviewers','POST',{siteId:site.id,loginId,name:loginId,password:'virtual-password-123'},admin)).json()),first=await make('lock_first'),second=await make('lock_second'),doc=await (await send('/api/documents','POST',{siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',details:{kind:'품의서'}},admin)).json(),path=`/api/documents/${doc.id}`;
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.prepare('INSERT INTO approval_steps(document_id,position,reviewer_id) VALUES(?,?,?)').run(doc.id,1,first.id);db.prepare('INSERT INTO office_reference_recipients(document_id,reviewer_id) VALUES(?,?)').run(doc.id,first.id);
    db.exec('BEGIN IMMEDIATE');locked=true;const firstLock=once(child.stdout,'data'),pending=send(`${path}/approval-line`,'PUT',{reviewerIds:[second.id]},admin);pending.catch(()=>{});assert.match(String((await firstLock)[0]),/APPROVAL_LOCK/);db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(doc.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT reviewer_id FROM approval_steps WHERE document_id=?').get(doc.id).reviewer_id,first.id);
    db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(doc.id);db.exec('BEGIN IMMEDIATE');locked=true;const secondLock=once(child.stdout,'data'),pendingRefs=send(`${path}/office-references`,'PUT',{reviewerIds:[second.id]},admin);pendingRefs.catch(()=>{});assert.match(String((await secondLock)[0]),/APPROVAL_LOCK/);db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(second.id);db.exec('COMMIT');locked=false;assert.equal((await pendingRefs).status,400);assert.equal(db.prepare('SELECT reviewer_id FROM office_reference_recipients WHERE document_id=?').get(doc.id).reviewer_id,first.id);
    db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(second.id);assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[second.id]},admin)).status,200);assert.equal((await send(`${path}/office-references`,'PUT',{reviewerIds:[second.id]},admin)).status,200);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
