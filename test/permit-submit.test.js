import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';

const details={directWork:true,personnel:'2',periodFrom:'2026-10-31',periodTo:'2026-10-31',place:'가상 장소',work:'가상 작업'};
function fixture(s){
  const site=s.createSite({name:'가상 현장'}),person=s.createReviewer({siteId:site.id,loginId:'submit_manager',name:'가상 직원',password:'virtual-password-123'}),input={siteId:site.id,type:'permit',title:'가상 공정',date:'2026-10-31',details},doc=s.createDocument(input);
  s.setPermitRoles(doc.id,{expectedVersion:s.permitRoles(doc.id).version,roles:{...s.permitRoles(doc.id).roles,siteManager:person.id}});
  return {site,person,input,doc};
}
const snapshot=(s,id)=>({doc:s.document(id),roles:s.permitRoles(id),cycles:s.db.prepare('SELECT * FROM approval_cycles WHERE document_id=?').all(id),files:s.db.prepare('SELECT * FROM approval_cycle_files WHERE cycle_id IN (SELECT id FROM approval_cycles WHERE document_id=?)').all(id),events:s.db.prepare('SELECT * FROM events WHERE document_id=?').all(id)});

test('시험 요청은 각 필수값의 누락을 거절하고 문서·역할선·기존 사본을 보존한다',async t=>{
  for(const field of ['title','date','company','personnel','periodFrom','periodTo','place','work'])for(const value of ['', '   '])await t.test(`${field}: ${value?'공백':'빈값'}`,()=>{
    const s=new Store(':memory:');try{
      const {doc}=fixture(s);s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 자료'));s.transition(doc.id,'submit');s.transition(doc.id,'withdraw');
      if(['title','date'].includes(field))s.db.prepare(`UPDATE documents SET ${field}=? WHERE id=?`).run(value,doc.id);
      else s.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({...details,...(field==='company'?{directWork:false}:{}),[field]:value}),doc.id);
      const before=snapshot(s,doc.id);assert.throws(()=>s.transition(doc.id,'submit'),/작성일/);assert.deepEqual(snapshot(s,doc.id),before);
    }finally{s.close();}
  });
});

test('임시·반려 문서는 자유롭게 보완하고 직영·수동 업체·인원 조건을 요청 시 적용한다',()=>{
  const s=new Store(':memory:');try{
    const {doc,input,person}=fixture(s),put=roles=>s.setPermitRoles(doc.id,{expectedVersion:s.permitRoles(doc.id).version,roles});
    s.updateDocument(doc.id,{...input,details:{directWork:false}});assert.throws(()=>s.transition(doc.id,'submit'),/작성일/);
    for(const personnel of ['', '  ', '0',' 0 ']){s.updateDocument(doc.id,{...input,details:{...details,personnel}});assert.throws(()=>s.transition(doc.id,'submit'),/작업인원/);}
    s.updateDocument(doc.id,input);put(Object.fromEntries(Object.keys(s.permitRoles(doc.id).roles).map(key=>[key,null])));assert.throws(()=>s.transition(doc.id,'submit'),/현장소장/);
    s.setApprovalLine(doc.id,[person.id]);assert.throws(()=>s.transition(doc.id,'submit'),/현장소장/);
    put({...s.permitRoles(doc.id).roles,siteManager:person.id});s.transition(doc.id,'submit');s.transition(doc.id,'reject','가상 반려',null,person.id);
    s.updateDocument(doc.id,{...input,details:{directWork:false}});assert.equal(s.document(doc.id).status,'rejected');
    s.updateDocument(doc.id,{...input,details:{...details,directWork:false,company:' 가상 수동 업체 ',personnel:'00'}});s.transition(doc.id,'revise');assert.throws(()=>s.transition(doc.id,'submit'),/협력사 현장소장/);
    put({...s.permitRoles(doc.id).roles,contractorLead:person.id});assert.equal(s.transition(doc.id,'submit').status,'pending');
  }finally{s.close();}
});

test('요청은 같은 현장 활성 역할과 역할선 일치를 확인하며 구 pending의 승인·반려는 허용한다',()=>{
  const s=new Store(':memory:');try{
    const {doc,input,person}=fixture(s),other=s.createSite({name:'다른 가상 현장'});
    for(const [column,value] of [['active',0],['site_id',other.id]]){
      s.db.prepare(`UPDATE reviewers SET ${column}=? WHERE id=?`).run(value,person.id);const before=snapshot(s,doc.id);assert.throws(()=>s.transition(doc.id,'submit'),/활성/);assert.deepEqual(snapshot(s,doc.id),before);s.db.prepare('UPDATE reviewers SET active=1,site_id=? WHERE id=?').run(input.siteId,person.id);
    }
    s.db.prepare('DELETE FROM approval_steps WHERE document_id=?').run(doc.id);const before=snapshot(s,doc.id);assert.throws(()=>s.transition(doc.id,'submit'),/결재선/);assert.deepEqual(snapshot(s,doc.id),before);
    for(const action of ['approve','reject']){const old=s.createDocument({...input,details:{}});s.db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(old.id);assert.equal(s.transition(old.id,action).status,action==='approve'?'approved':'rejected');}
    const assigned=s.createDocument({...input,details:{}});s.setApprovalLine(assigned.id,[person.id]);s.captureApprovalCycle(s.document(assigned.id));s.db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(assigned.id);assert.equal(s.transition(assigned.id,'approve','',null,person.id).status,'approved');
  }finally{s.close();}
});

function waitFor(child,marker){return new Promise((resolve,reject)=>{let output='';const finish=error=>{clearTimeout(timer);child.stdout.off('data',read);child.off('exit',exit);child.off('error',fail);error?reject(error):resolve();},read=chunk=>{output+=chunk;if(output.includes(marker))finish();},exit=()=>finish(Error('시험 서버 종료')),fail=error=>finish(error),timer=setTimeout(()=>finish(Error('시험 신호 시간 초과')),15000);child.stdout.on('data',read);child.once('exit',exit);child.once('error',fail);});}

test('HTTP 요청은 쓰기 잠금 대기 후 최신 내용·역할·활성 상태를 검사하고 실패 시 자료를 보존한다',{timeout:60000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-submit-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import http from 'node:http';import {Store} from ${JSON.stringify(source)};const create=http.createServer;http.createServer=function(...args){const server=create.apply(this,args);server.once('listening',()=>process.stdout.write('READY'));return server};const original=Store.prototype.managedTransition;Store.prototype.managedTransition=function(...args){process.stdout.write('LOCK_WAIT');return original.apply(this,args)};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let s,db,locked=false,stage='서버 시작',stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4096);});
  try{
    await waitFor(child,'READY');s=new Store(join(dir,'jweb.sqlite'));const {doc,person}=fixture(s);s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 사본'));s.transition(doc.id,'submit');s.transition(doc.id,'withdraw');db=new DatabaseSync(join(dir,'jweb.sqlite'));
    const initialTimeout=db.prepare('PRAGMA busy_timeout').get().timeout,journal=db.prepare('PRAGMA journal_mode').get().journal_mode;
    // 다른 연결의 BEGIN IMMEDIATE가 잠시 잡는 읽기 잠금에도 시험 COMMIT이 즉시 실패하지 않도록 제품과 같은 대기시간을 쓴다.
    db.exec('PRAGMA busy_timeout=3000');assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,3000);t.diagnostic(`SQLite journal=${journal}, 시험 연결 busy_timeout=${initialTimeout}->3000, Store busy_timeout=${s.db.prepare('PRAGMA busy_timeout').get().timeout}`);
    const base=`http://127.0.0.1:${port}`,send=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});stage='관리자 로그인';const login=await send('/api/login',{password:'virtual-admin-password'}),cookie=login.headers.get('set-cookie').split(';')[0],path=`/api/documents/${doc.id}/transition`;await login.text();
    for(const change of ['work','title','date','roles','active']){
      stage=`잠금 시험: ${change}`;db.exec('BEGIN IMMEDIATE');locked=true;const waiting=waitFor(child,'LOCK_WAIT'),pending=send(path,{action:'submit'},cookie);pending.catch(()=>{});await waiting;
      if(change==='work')db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({...details,work:''}),doc.id);
      if(['title','date'].includes(change))db.prepare(`UPDATE documents SET ${change}='' WHERE id=?`).run(doc.id);
      if(change==='roles')db.prepare("UPDATE permit_roles SET roles='{}' WHERE document_id=?").run(doc.id);
      if(change==='active')db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(person.id);
      db.exec('COMMIT');locked=false;const before=snapshot(s,doc.id),response=await pending;assert.equal(response.status,400,change);await response.text();assert.deepEqual(snapshot(s,doc.id),before,change);
      db.prepare('UPDATE documents SET title=?,date=?,details=? WHERE id=?').run('가상 공정','2026-10-31',JSON.stringify(details),doc.id);db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(person.id);s.setPermitRoles(doc.id,{expectedVersion:s.permitRoles(doc.id).version,roles:{...s.permitRoles(doc.id).roles,siteManager:person.id}});
    }
    stage='정상 요청';const response=await send(path,{action:'submit'},cookie);assert.equal(response.status,200);await response.text();assert.equal(s.document(doc.id).status,'pending');assert.equal(s.db.prepare('SELECT count(*) AS n FROM approval_cycles WHERE document_id=?').get(doc.id).n,2);
  }catch(error){throw new Error(`가상 서버 시험 실패 (${stage}; 종료 코드 ${child.exitCode}; 표준 오류: ${stderr||'없음'})`,{cause:error});}finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}s?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
