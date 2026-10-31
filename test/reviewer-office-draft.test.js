import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
const base={title:'가상 직원 문서',date:'2026-10-31',body:'가상 본문',details:{kind:'품의서'}};
const tables=['documents','office_document_authors','approval_steps','office_reference_recipients','meeting_signatures','office_reference_signature_versions'];
const counts=db=>tables.map(table=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

test('직원 일괄 작성은 본인 참조와 활성 결재선을 검증하고 저장 실패를 모두 되돌린다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),outside=store.createSite({name:'다른 가상 현장'}),make=(id,name)=>store.createReviewer({siteId:id,loginId:name,name,password:'virtual-password-123'}),author=make(site.id,'draft_author'),reviewer=make(site.id,'draft_reviewer'),other=make(site.id,'draft_other'),foreign=make(outside.id,'draft_foreign');
    const own=store.createReviewerOfficeDocument(author.id,base),alien=store.createReviewerOfficeDocument(other.id,base),foreignDoc=store.createReviewerOfficeDocument(foreign.id,base),preview=store.reviewerOfficeReferencePreview(author.id,own.id),setup={reviewerIds:[reviewer.id],referenceIds:[other.id],signature,referenceVersion:preview.version},input={...base,details:{kind:'품의서',referenceDocId:own.id},officeSetup:setup};
    assert.deepEqual(store.approvalLine(own.id),[]);assert.equal(store.meetingSignature(own.id),null);
    for(const id of [alien.id,foreignDoc.id,0,'invalid'])assert.throws(()=>store.reviewerOfficeReferencePreview(author.id,id));
    const initial=counts(store.db);
    for(const id of [null,undefined,0,'invalid']){assert.throws(()=>store.createReviewerOfficeDocument(id,input));assert.deepEqual(counts(store.db),initial);}
    const invalid=[{...setup,reviewerIds:[]},{...setup,reviewerIds:[author.id]},{...setup,reviewerIds:[reviewer.id,reviewer.id]},{...setup,reviewerIds:[String(reviewer.id)]},{...setup,referenceIds:[other.id,other.id]},{...setup,referenceIds:[String(other.id)]},{...setup,reviewerIds:Array.from({length:10},(_,i)=>i+1)},{...setup,referenceIds:Array.from({length:11},(_,i)=>i+1)},{...setup,reviewerIds:[foreign.id]},{...setup,referenceIds:[foreign.id]},{...setup,signature:'invalid'},{...setup,referenceVersion:'old'},null];
    for(const officeSetup of invalid){assert.throws(()=>store.createReviewerOfficeDocument(author.id,{...input,officeSetup}));assert.deepEqual(counts(store.db),initial);}
    for(const id of [alien.id,foreignDoc.id]){assert.throws(()=>store.createReviewerOfficeDocument(author.id,{...input,details:{kind:'품의서',referenceDocId:id}}));assert.deepEqual(counts(store.db),initial);}
    for(const person of [author,reviewer,other]){store.updateReviewer(site.id,person.id,{active:false});assert.throws(()=>store.createReviewerOfficeDocument(author.id,input));assert.deepEqual(counts(store.db),initial);store.updateReviewer(site.id,person.id,{active:true});}
    assert.throws(()=>store.createReviewerOfficeDocument(author.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(counts(store.db),initial);
    for(const table of tables.slice(1)){store.db.exec(`CREATE TRIGGER fail_draft BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'시험 저장 실패'); END`);assert.throws(()=>store.createReviewerOfficeDocument(author.id,input),/시험 저장 실패/);assert.deepEqual(counts(store.db),initial);store.db.exec('DROP TRIGGER fail_draft');}
    store.updateReviewerOfficeDocument(author.id,own.id,{...base,body:'변경된 가상 본문'},store.reviewerOfficeDetail(author.id,own.id).version);
    assert.throws(()=>store.createReviewerOfficeDocument(author.id,input),error=>error.sessionStatus===409);assert.deepEqual(counts(store.db),initial);
    const doc=store.createReviewerOfficeDocument(author.id,{...input,siteId:outside.id,type:'risk',officeSetup:{...setup,referenceVersion:store.reviewerOfficeReferencePreview(author.id,own.id).version}}),detail=store.reviewerOfficeDetail(author.id,doc.id);
    assert.equal(doc.site_id,site.id);assert.equal(doc.type,'office');assert.equal(detail.hasSignature,true);assert.equal(detail.signatureStale,false);assert.deepEqual(detail.line.map(row=>row.reviewer_id),[reviewer.id]);assert.deepEqual(detail.references.map(row=>row.id),[other.id]);assert.equal(detail.reference.body,'변경된 가상 본문');
    assert.equal(store.officeApprovalDefault(site.id,'품의서','',author.id).document.id,doc.id);assert.equal(store.officeApprovalDefault(site.id,'품의서','',other.id),null);assert.throws(()=>store.officeApprovalDefault(outside.id,'품의서','',author.id));
    store.updateReviewer(site.id,author.id,{active:false});assert.throws(()=>store.officeApprovalDefault(site.id,'품의서','',author.id));assert.throws(()=>store.reviewerOfficeReferencePreview(author.id,own.id));
  }finally{store.close();}
});

async function start(dir,imports=[]){
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[...imports,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['pipe','pipe','pipe']});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
  const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {child,send};
}
async function stop(child){if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
function cleanup(dir){assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
async function fixture(send){
  const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await(await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),make=async(siteId,loginId)=>await(await send('/api/reviewers','POST',{siteId,loginId,name:loginId,password:'virtual-password-123'},admin)).json(),author=await make(site.id,'api_author'),reviewer=await make(site.id,'api_reviewer'),foreign=await make(otherSite.id,'api_foreign'),login=async person=>(await send('/api/reviewer/login','POST',{loginId:person.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
  return {admin,site,author,reviewer,foreign,cookie:await login(author),other:await login(reviewer),outside:await login(foreign)};
}

test('직원 일괄 작성과 본인 전용 조회 API는 재시작 뒤에도 보존된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-staff-draft-api-'));let app;
  try{
    app=await start(dir);const {send}=app,{admin,site,author,reviewer,cookie,other,outside}=await fixture(send),path='/api/reviewer/office-documents',defaults='/api/reviewer/office-approval-default?kind='+encodeURIComponent('품의서');
    assert.equal((await send(defaults)).status,401);assert.equal(await(await send(defaults,'GET',undefined,cookie)).json(),null);
    const old=await send(path,'POST',base,cookie);assert.equal(old.status,201);const own=await old.json();assert.equal(own.hasSignature,false);
    const previewPath=`/api/reviewer/office-reference-preview?id=${own.document.id}`;assert.equal((await send(previewPath)).status,401);for(const token of [other,outside])assert.equal((await send(previewPath,'GET',undefined,token)).status,400);
    const preview=await(await send(previewPath,'GET',undefined,cookie)).json();assert.equal(preview.reference.body,base.body);
    const input={...base,details:{kind:'품의서',referenceDocId:own.document.id},officeSetup:{reviewerIds:[reviewer.id],referenceIds:[],signature,referenceVersion:preview.version}},created=await send(path,'POST',input,cookie);assert.equal(created.status,201);const data=await created.json();assert.equal(data.hasSignature,true);assert.equal(data.signatureStale,false);assert.deepEqual(data.line.map(row=>row.reviewer_id),[reviewer.id]);
    const alien=await(await send(path,'POST',{...base,officeSetup:{reviewerIds:[author.id],referenceIds:[],signature}},other)).json();assert.ok(alien.document.id>data.document.id);assert.equal((await(await send(defaults,'GET',undefined,cookie)).json()).document.id,data.document.id);assert.equal((await(await send(defaults,'GET',undefined,other)).json()).document.id,alien.document.id);assert.equal(await(await send(defaults,'GET',undefined,outside)).json(),null);
    const otherKind=await(await send(path,'POST',{...base,details:{kind:'기타',otherKind:'가상 구분'},officeSetup:{reviewerIds:[reviewer.id],referenceIds:[],signature}},cookie)).json();assert.equal((await(await send('/api/reviewer/office-approval-default?'+new URLSearchParams({kind:'기타',otherKind:'가상 구분'}),'GET',undefined,cookie)).json()).document.id,otherKind.document.id);
    assert.equal((await send(path,'POST',{...input,officeSetup:{...input.officeSetup,referenceVersion:'old'}},cookie)).status,409);
    await stop(app.child);app=await start(dir);const login=(await app.send('/api/reviewer/login','POST',{loginId:author.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],saved=await(await app.send(`${path}/${data.document.id}`,'GET',undefined,login)).json();assert.equal(saved.hasSignature,true);assert.equal(saved.signatureStale,false);assert.deepEqual(saved.line,data.line);assert.deepEqual(saved.reference,data.reference);
    const newAdmin=(await app.send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];assert.equal((await app.send(`/api/reviewers/${author.id}`,'PUT',{siteId:site.id,active:false},newAdmin)).status,200);assert.equal((await app.send(defaults,'GET',undefined,login)).status,401);assert.equal((await app.send(previewPath,'GET',undefined,login)).status,401);
  }finally{if(app)await stop(app.child);cleanup(dir);}
});

test('직원 저장 잠금 대기 후 계정과 세션 및 참조 변경을 다시 검사한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-staff-draft-lock-')),module=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(module)};const original=Store.prototype.createOfficeDraft;Store.prototype.createOfficeDraft=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('DRAFT_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}};`;let app,db,locked=false;
  try{
    app=await start(dir,['--import',`data:text/javascript,${encodeURIComponent(trace)}`]);const {send,child}=app,{author,reviewer,cookie}=await fixture(send),path='/api/reviewer/office-documents',own=await(await send(path,'POST',base,cookie)).json(),preview=await(await send(`/api/reviewer/office-reference-preview?id=${own.document.id}`,'GET',undefined,cookie)).json(),input={...base,details:{kind:'품의서',referenceDocId:own.document.id},officeSetup:{reviewerIds:[reviewer.id],referenceIds:[reviewer.id],signature,referenceVersion:preview.version}};
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const initial=counts(db);
    for(const mode of ['reviewer','reference','session','author']){
      const currentCookie=mode==='author'?(await send('/api/reviewer/login','POST',{loginId:author.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0]:cookie;
      db.exec('BEGIN IMMEDIATE');locked=true;const signal=once(child.stdout,'data'),pending=send(path,'POST',input,currentCookie);pending.catch(()=>{});assert.match(String((await signal)[0]),/DRAFT_LOCK/);
      if(mode==='reviewer')db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(reviewer.id);
      if(mode==='reference')db.prepare('UPDATE documents SET body=? WHERE id=?').run('잠금 뒤 변경된 본문',own.document.id);
      if(mode==='session')db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(author.id);
      if(mode==='author')db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(author.id);
      db.exec('COMMIT');locked=false;assert.equal((await pending).status,mode==='reference'?409:mode==='reviewer'?400:401);assert.deepEqual(counts(db),initial);
      db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(reviewer.id);db.prepare('UPDATE documents SET body=? WHERE id=?').run(base.body,own.document.id);
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(app)await stop(app.child);cleanup(dir);}
});
