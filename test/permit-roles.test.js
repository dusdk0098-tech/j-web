import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once,EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const keys=['contractorLead','coordinator','supervisor','safetyOfficer','siteManager','inspector'];
const empty=()=>Object.fromEntries(keys.map(key=>[key,null]));
const png=new PNG({width:1,height:1});png.data[3]=255;
const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
function fixture(s){const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 가상 현장'}),people=Array.from({length:7},(_,i)=>s.createReviewer({siteId:i===6?other.id:site.id,loginId:`permit_role_${i}`,name:`가상 직원 ${i}`,password:'virtual-password-123'})),input={siteId:site.id,type:'permit',title:'가상 허가',date:'2026-10-31',details:{company:'가상 작업업체',personnel:'2',periodFrom:'2026-10-31',periodTo:'2026-10-31',place:'가상 장소',work:'가상 작업'}},doc=s.createDocument(input);return {site,people,input,doc,roles:Object.fromEntries(keys.map((key,i)=>[key,people[i].id]))};}

test('여섯 역할은 순차 결재와 요청 사본에 연결되고 재요청·재시작에도 사본을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-roles-')),file=join(dir,'db.sqlite');let s=new Store(file);
  try{
    const {site,people,input,doc,roles}=fixture(s),put=roles=>s.setPermitRoles(doc.id,{expectedVersion:s.permitRoles(doc.id).version,roles});
    assert.deepEqual(s.permitRoles(doc.id).roles,empty());put(roles);assert.deepEqual(s.approvalLine(doc.id).map(r=>r.reviewer_id),people.slice(0,6).map(r=>r.id));
    const version=s.permitRoles(doc.id).version;s.updateDocument(doc.id,input);assert.deepEqual(s.permitRoles(doc.id).roles,roles);assert.notEqual(s.permitRoles(doc.id).version,version);assert.throws(()=>s.setPermitRoles(doc.id,{expectedVersion:version,roles}),/다시 조회/);
    assert.throws(()=>s.setApprovalLine(doc.id,[people[0].id]),/전체 해제/);
    s.managedTransition(doc.id,{action:'submit'});const cycle=s.document(doc.id).approval_cycle_id,snapshot=s.approvalCycle(doc.id,cycle).linked.permitRoles;assert.equal(snapshot.length,6);assert.equal(snapshot[0].label,'협력사 현장소장');
    assert.throws(()=>put(empty()),/수정 가능한/);assert.throws(()=>s.reviewerTransition(doc.id,people[1].id,'approve','',signature),/현재 차례/);
    s.managedTransition(doc.id,{action:'withdraw'});put({...roles,coordinator:people[5].id,inspector:people[1].id});s.managedTransition(doc.id,{action:'submit'});
    const order=s.approvalLine(doc.id).map(row=>row.reviewer_id);for(let i=0;i<6;i++){s.reviewerTransition(doc.id,order[i],'approve','',signature);assert.equal(s.document(doc.id).status,i===5?'approved':'pending');}
    s.db.prepare('UPDATE reviewers SET name=? WHERE id=?').run('변경된 가상 이름',people[0].id);assert.deepEqual(s.approvalCycle(doc.id,cycle).linked.permitRoles,snapshot);
    const duplicate=s.createDocument(input),putDuplicate=roles=>s.setPermitRoles(duplicate.id,{expectedVersion:s.permitRoles(duplicate.id).version,roles});putDuplicate({...empty(),contractorLead:people[1].id,siteManager:people[1].id});assert.equal(s.approvalLine(duplicate.id).length,1);
    s.managedTransition(duplicate.id,{action:'submit'});s.reviewerTransition(duplicate.id,people[1].id,'reject','가상 반려');putDuplicate({...empty(),contractorLead:people[2].id,siteManager:people[2].id});s.managedTransition(duplicate.id,{action:'revise'});s.managedTransition(duplicate.id,{action:'submit'});s.reviewerTransition(duplicate.id,people[2].id,'approve','',signature);assert.equal(s.document(duplicate.id).status,'approved');
    s.close();s=new Store(file);assert.deepEqual(s.approvalCycle(doc.id,cycle).linked.permitRoles,snapshot);assert.equal(s.permitRoles(duplicate.id).roles.siteManager,people[2].id);
  }finally{s.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('역할 필수조건·현장·활성·버전 검사와 삽입 실패는 역할 및 결재선을 원자적으로 보존한다',()=>{
  const s=new Store(':memory:');try{
    const {people,input,doc,roles}=fixture(s),put=value=>s.setPermitRoles(doc.id,{expectedVersion:s.permitRoles(doc.id).version,roles:value});
    for(const value of [{...roles,siteManager:null},{...roles,contractorLead:null},{...roles,inspector:people[6].id},{...roles,inspector:'1'},{siteManager:people[0].id}])assert.throws(()=>put(value));
    put(roles);const before=s.permitRoles(doc.id);assert.throws(()=>s.setPermitRoles(doc.id,{expectedVersion:before.version,roles:empty()},()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(s.permitRoles(doc.id),before);
    s.db.exec("CREATE TRIGGER fail_permit_line BEFORE INSERT ON approval_steps BEGIN SELECT RAISE(ABORT,'시험 삽입 실패'); END");assert.throws(()=>put({...roles,inspector:null}),/시험 삽입 실패/);assert.deepEqual(s.permitRoles(doc.id),before);s.db.exec('DROP TRIGGER fail_permit_line');
    s.updateReviewer(input.siteId,people[0].id,{active:false});assert.throws(()=>put(roles),/활성/);assert.throws(()=>s.managedTransition(doc.id,{action:'submit'}),/활성/);s.updateReviewer(input.siteId,people[0].id,{active:true});
    put(empty());s.setApprovalLine(doc.id,[people[0].id]);const prior=s.permitRoles(doc.id).version;s.setApprovalLine(doc.id,[]);s.setApprovalLine(doc.id,[people[0].id]);assert.throws(()=>s.setPermitRoles(doc.id,{expectedVersion:prior,roles}),/다시 조회/);
    assert.throws(()=>s.managedTransition(doc.id,{action:'submit'}),/현장소장/);put({...empty(),siteManager:people[0].id,contractorLead:people[0].id});s.managedTransition(doc.id,{action:'submit'});s.reviewerTransition(doc.id,people[0].id,'approve','',signature);assert.equal(s.document(doc.id).status,'approved');
    const free=s.createDocument({...input,details:{}}),assigned={...empty(),siteManager:people[0].id};s.setPermitRoles(free.id,{expectedVersion:s.permitRoles(free.id).version,roles:assigned});s.updateDocument(free.id,input);assert.throws(()=>s.managedTransition(free.id,{action:'submit'}),/협력사 현장소장/);assert.deepEqual(JSON.parse(s.document(free.id).details),input.details);
    const legacy=s.createDocument(input);s.db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(legacy.id);s.managedTransition(legacy.id,{action:'approve',signature});assert.equal(s.document(legacy.id).status,'approved');
    const deleted=s.createDocument(input);s.db.prepare('DELETE FROM documents WHERE id=?').run(deleted.id);assert.equal(s.db.prepare('SELECT 1 FROM permit_roles WHERE document_id=?').get(deleted.id),undefined);
  }finally{s.close();}
});

function waitOutput(child,marker,timeout=30000){return new Promise((resolve,reject)=>{let text='';const finish=error=>{clearTimeout(timer);child.stdout.off('data',read);child.stdout.off('error',failed);child.off('exit',ended);child.off('error',failed);error?reject(error):resolve();},read=chunk=>{text+=chunk;if(text.includes(marker))finish();else text=text.slice(-(marker.length-1));},ended=()=>finish(Error('시험 서버 종료')),failed=error=>finish(error),timer=setTimeout(()=>finish(Error('시험 신호 시간 초과')),timeout);child.stdout.on('data',read);child.stdout.once('error',failed);child.once('exit',ended);child.once('error',failed);if(child.exitCode!==null||child.signalCode)ended();});}

test('역할 시험 신호 대기는 종료·오류·분할 출력과 시간 초과를 처리한다',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),exitCode:null,signalCode:null});
  const pending=waitOutput(child,'READY');child.stdout.write('RE');child.stdout.write('ADY');await pending;
  for(const source of [child,child.stdout]){const failed=waitOutput(child,'READY');source.emit('error',Error('가상 오류'));await assert.rejects(failed,/가상 오류/);}
  await assert.rejects(waitOutput(child,'READY',10),/시간 초과/);child.exitCode=1;await assert.rejects(waitOutput(child,'READY'),/종료/);assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);assert.equal(child.stdout.listenerCount('data'),0);assert.equal(child.stdout.listenerCount('error'),0);child.stdout.destroy();
});

test('역할 HTTP 저장은 본문 중 로그아웃과 잠금 대기 중 계정·문서·결재선·세션 변경을 거절한다',{timeout:120000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-role-http-')),flag=join(dir,'expired'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const trace=`import http from 'node:http';import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};import {LocalAuth} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'auth.js')).href)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-slow'])req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('READY'));return server};const set=Store.prototype.setPermitRoles;Store.prototype.setPermitRoles=function(...args){process.stdout.write('LOCK_WAIT');return set.apply(this,args)};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(flag)})?9*60*60*1000:0))};`;
  const readTrace="const read=Store.prototype.permitRoles;Store.prototype.permitRoles=function(...args){process.stdout.write('READ_WAIT');return read.apply(this,args)};";
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace+readTrace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await waitOutput(child,'READY');const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await login();
    const s=new Store(join(dir,'jweb.sqlite'));const {doc,people,roles}=fixture(s);s.close();db=new DatabaseSync(join(dir,'jweb.sqlite'));const path=`/api/documents/${doc.id}/permit-roles`,get=async()=>await (await send(path,'GET',undefined,admin)).json();assert.equal((await send(path)).status,401);
    let current=await get();assert.equal((await send(path,'PUT',{expectedVersion:current.version,roles},admin)).status,200);
    db.exec('PRAGMA journal_mode=DELETE');db.exec('BEGIN EXCLUSIVE');locked=true;const reading=waitOutput(child,'READ_WAIT'),pendingRead=send(path,'GET',undefined,admin);await reading;writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;const expiredRead=await pendingRead;assert.equal(expiredRead.status,401);const expiredBody=await expiredRead.json();assert.deepEqual(Object.keys(expiredBody),['error']);assert.ok(!JSON.stringify(expiredBody).includes('contractorLead'));unlinkSync(flag);admin=await login();db.exec('PRAGMA journal_mode=WAL');
    for(const change of ['account','status','line','session']){
      current=await get();db.exec('BEGIN IMMEDIATE');locked=true;const waiting=waitOutput(child,'LOCK_WAIT'),pending=send(path,'PUT',{expectedVersion:current.version,roles:{...roles,inspector:null}},admin);await waiting;
      if(change==='account')db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(people[1].id);
      if(change==='status')db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(doc.id);
      if(change==='line')db.prepare('UPDATE approval_steps SET state=state WHERE document_id=?').run(doc.id);
      if(change==='session')writeFileSync(flag,'expired');
      db.exec('COMMIT');locked=false;const response=await pending;assert.ok([400,409,401].includes(response.status),`${change}: ${response.status}`);assert.equal(JSON.parse(db.prepare('SELECT roles FROM permit_roles WHERE document_id=?').get(doc.id).roles).inspector,people[5].id);
      if(change==='account')db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(people[1].id);
      if(change==='status')db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(doc.id);
      if(change==='session'){assert.equal(response.status,401);unlinkSync(flag);admin=await login();}
    }
    current=await get();const data=JSON.stringify({expectedVersion:current.version,roles:empty()}),begun=waitOutput(child,'BODY_STARTED');let slow;const pending=new Promise((resolve,reject)=>{slow=request(base+path,{method:'PUT',headers:{cookie:admin,'content-type':'application/json','content-length':Buffer.byteLength(data),'x-slow':'1'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});slow.on('error',reject);slow.write(data.slice(0,1));});await begun;assert.equal((await send('/api/logout','POST',{},admin)).status,200);slow.end(data.slice(1));assert.equal(await pending,401);assert.equal(JSON.parse(db.prepare('SELECT roles FROM permit_roles WHERE document_id=?').get(doc.id).roles).inspector,people[5].id);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
