import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

test('요청 중인 업무 문서의 참조자 변경은 사본과 접근 권한을 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:loginId,password:'virtual-password-123'});
    const approver=make(site.id,'access_approver'),one=make(site.id,'access_one'),two=make(site.id,'access_two'),foreign=make(other.id,'access_foreign');
    const doc=s.createDocument({siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',body:'요청 당시 내용',details:{kind:'품의서'}});
    s.setApprovalLine(doc.id,[approver.id]);s.setOfficeReferences(doc.id,[one.id]);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');
    const cycle=s.document(doc.id).approval_cycle_id,input={expectedCycleId:cycle,expectedReviewerIds:[one.id],reviewerIds:[two.id]};
    assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,{...input,reviewerIds:[foreign.id]}),/현장/);
    assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.deepEqual(s.officeReferenceDocuments(one.id).map(row=>row.id),[doc.id]);assert.deepEqual(s.officeReferenceDocuments(two.id),[]);
    s.updateReviewer(site.id,two.id,{active:false});assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,input),/활성/);s.updateReviewer(site.id,two.id,{active:true});
    s.db.exec("CREATE TRIGGER fail_reference_access BEFORE INSERT ON events WHEN NEW.action='reference_access' BEGIN SELECT RAISE(ABORT,'시험 이력 실패'); END");
    assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,input),/시험 이력 실패/);assert.deepEqual(s.officeReferenceDocuments(one.id).map(row=>row.id),[doc.id]);assert.deepEqual(s.officeReferenceDocuments(two.id),[]);
    s.db.exec('DROP TRIGGER fail_reference_access');
    s.changeOfficeReferenceAccess(doc.id,input);
    assert.deepEqual(s.officeReferenceDocuments(one.id),[]);assert.deepEqual(s.officeReferenceDocuments(two.id).map(row=>row.id),[doc.id]);
    assert.equal(s.reviewerDocument(two.id,doc.id),null);assert.throws(()=>s.reviewerTransition(doc.id,two.id,'approve','',signature),/결재자/);
    assert.deepEqual(s.approvalCycle(doc.id,cycle).linked.referenceRecipients.map(row=>row.id),[one.id]);
    assert.equal(s.events(doc.id).at(-1).action,'reference_access');
    assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,input),error=>error.sessionStatus===409);
    assert.throws(()=>s.changeOfficeReferenceAccess(doc.id,{...input,expectedCycleId:cycle+1,expectedReviewerIds:[two.id]}),error=>error.sessionStatus===409);
    s.reviewerTransition(doc.id,approver.id,'approve','',signature);
    s.changeOfficeReferenceAccess(doc.id,{expectedCycleId:cycle,expectedReviewerIds:[two.id],reviewerIds:[one.id]});
    assert.deepEqual(s.officeReferenceDocuments(two.id),[]);assert.equal(s.officeReferenceDocuments(one.id)[0].status,'approved');
    assert.deepEqual(s.approvalCycle(doc.id,cycle).linked.referenceRecipients.map(row=>row.id),[one.id]);
    const count=s.events(doc.id).length;s.changeOfficeReferenceAccess(doc.id,{expectedCycleId:cycle,expectedReviewerIds:[one.id],reviewerIds:[one.id]});assert.equal(s.events(doc.id).length,count);
    s.changeOfficeReferenceAccess(doc.id,{expectedCycleId:cycle,expectedReviewerIds:[one.id],reviewerIds:[]});assert.deepEqual(s.officeReferenceDocuments(one.id),[]);
  }finally{s.close();}
});

test('관리자가 요청 후 참조자를 바꾸면 API 접근도 즉시 바뀐다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reference-access-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),make=async loginId=>(await (await send('/api/reviewers','POST',{siteId:site.id,loginId,name:loginId,password:'virtual-password-123'},admin)).json());
    const approver=await make('access_api_approver'),one=await make('access_api_one'),two=await make('access_api_two');
    const doc=await (await send('/api/documents','POST',{siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',body:'가상 내용',details:{kind:'품의서'}},admin)).json(),path=`/api/documents/${doc.id}`;
    const upload=await fetch(base+path+'/attachments',{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'가상 첨부'}),file=(await upload.json()).id;
    assert.equal((await send(path+'/approval-line','PUT',{reviewerIds:[approver.id]},admin)).status,200);
    assert.equal((await send(path+'/office-references','PUT',{reviewerIds:[one.id]},admin)).status,200);
    assert.equal((await send(path+'/meeting-signature','POST',{signature},admin)).status,200);
    assert.equal((await send(path+'/transition','POST',{action:'submit'},admin)).status,200);
    const login=async loginId=>(await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    const oneCookie=await login(one.login_id),twoCookie=await login(two.login_id),approverCookie=await login(approver.login_id),refPath=`/api/reviewer/references/${doc.id}`;
    const original=await (await send(refPath,'GET',undefined,oneCookie)).json(),cycle=original.document.approval_cycle_id,input={expectedCycleId:cycle,expectedReviewerIds:[one.id],reviewerIds:[two.id]},access=path+'/office-reference-access';
    assert.equal((await send(access,'PUT',input)).status,401);assert.equal((await send(access,'PUT',input,twoCookie)).status,401);
    assert.equal((await send(access,'PUT',input,admin)).status,200);assert.equal((await send(access,'PUT',input,admin)).status,409);
    assert.equal((await send(refPath,'GET',undefined,oneCookie)).status,404);assert.equal((await send(refPath,'GET',undefined,twoCookie)).status,200);
    assert.equal(await (await send(`${refPath}/attachments/${file}`,'GET',undefined,twoCookie)).text(),'가상 첨부');
    assert.equal((await send(`/api/reviewer/documents/${doc.id}/decision`,'POST',{action:'approve',signature},twoCookie)).status,404);
    assert.equal((await send(`/api/reviewer/documents/${doc.id}/decision`,'POST',{action:'approve',signature},approverCookie)).status,200);
    assert.equal((await send(access,'PUT',{expectedCycleId:cycle,expectedReviewerIds:[two.id],reviewerIds:[one.id]},admin)).status,200);
    assert.equal((await send(refPath,'GET',undefined,twoCookie)).status,404);assert.equal((await send(refPath,'GET',undefined,oneCookie)).status,200);
    const frozen=await (await send(path+`/approval-cycles/${cycle}`,'GET',undefined,admin)).json();assert.deepEqual(frozen.linked.referenceRecipients.map(row=>row.id),[one.id]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
