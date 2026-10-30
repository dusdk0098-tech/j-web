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

test('시험 전결은 권한과 현재 순서를 확인하고 생략된 결재를 구분한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-final-approval-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=loginId=>s.createReviewer({siteId:site.id,loginId,name:loginId,password:'virtual-password-123'});
    const first=make('final_first'),second=make('final_second'),third=make('final_third');
    const doc=s.createDocument({siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',body:'가상 내용',details:{kind:'품의서'}});
    s.setApprovalLine(doc.id,[first.id,second.id,third.id]);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');
    assert.equal(s.reviewerCanFinalApprove(second.id),false);
    assert.throws(()=>s.setReviewerFinalApproval(other.id,second.id,{enabled:true,expectedEnabled:false}),/현장/);
    assert.throws(()=>s.setReviewerFinalApproval(site.id,second.id,{enabled:true,expectedEnabled:false},()=>{throw Error('세션 만료');}),/세션 만료/);
    s.setReviewerFinalApproval(site.id,second.id,{enabled:true,expectedEnabled:false});
    assert.equal(s.reviewers(site.id).find(row=>row.id===second.id).final_approval_enabled,1);s.updateReviewer(site.id,second.id,{active:false});assert.equal(s.reviewerCanFinalApprove(second.id),false);s.updateReviewer(site.id,second.id,{active:true});assert.equal(s.reviewerCanFinalApprove(second.id),true);
    assert.throws(()=>s.setReviewerFinalApproval(site.id,second.id,{enabled:false,expectedEnabled:false}),error=>error.sessionStatus===409);
    assert.throws(()=>s.reviewerTransition(doc.id,second.id,'final_approve','',signature),/차례/);
    assert.throws(()=>s.transition(doc.id,'final_approve','',signature),/결재자|권한/);
    s.reviewerTransition(doc.id,first.id,'approve','첫 시험 승인',signature);
    assert.throws(()=>s.reviewerTransition(doc.id,second.id,'final_approve','',null),/서명/);
    assert.throws(()=>s.reviewerTransition(doc.id,second.id,'final_approve','',signature,()=>{throw Error('세션 만료');}),/세션 만료/);
    s.setReviewerFinalApproval(site.id,second.id,{enabled:false,expectedEnabled:true});
    assert.throws(()=>s.reviewerTransition(doc.id,second.id,'final_approve','',signature),/전결/);
    s.setReviewerFinalApproval(site.id,second.id,{enabled:true,expectedEnabled:false});
    s.db.exec("CREATE TRIGGER fail_final_approval BEFORE INSERT ON events WHEN NEW.action='final_approve' BEGIN SELECT RAISE(ABORT,'시험 이력 실패'); END");
    assert.throws(()=>s.reviewerTransition(doc.id,second.id,'final_approve','',signature),/시험 이력 실패/);
    assert.equal(s.document(doc.id).status,'pending');assert.deepEqual(s.approvalLine(doc.id).map(row=>row.state),['approved','pending','pending']);
    s.db.exec('DROP TRIGGER fail_final_approval');s.reviewerTransition(doc.id,second.id,'final_approve','시험 전결 의견',signature);
    assert.equal(s.document(doc.id).status,'approved');assert.deepEqual(s.approvalLine(doc.id).map(row=>row.state),['approved','approved','skipped']);
    const event=s.events(doc.id).at(-1);assert.equal(event.action,'final_approve');assert.equal(event.reviewer_id,second.id);assert.equal(event.has_signature,1);assert.equal(event.opinion,'시험 전결 의견');
    assert.equal(s.reviewerDocument(third.id,doc.id),null);assert.throws(()=>s.reviewerTransition(doc.id,third.id,'approve','',signature),/차례/);
    const normal=s.createDocument({siteId:site.id,type:'tbm',title:'가상 안전 문서',date:'2026-10-30'});s.setApprovalLine(normal.id,[second.id]);s.transition(normal.id,'submit');
    assert.throws(()=>s.reviewerTransition(normal.id,second.id,'final_approve','',signature),/업무 문서|전결/);assert.equal(s.document(normal.id).status,'pending');
    s.close();s=new Store(file);assert.equal(s.reviewerCanFinalApprove(second.id),true);assert.deepEqual(s.approvalLine(doc.id).map(row=>row.state),['approved','approved','skipped']);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('시험 전결 권한은 관리자만 지정하며 API가 서명과 현장 권한을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-final-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    const make=async loginId=>(await (await send('/api/reviewers','POST',{siteId:site.id,loginId,name:loginId,password:'virtual-password-123'},admin)).json()),first=await make('final_api_first'),second=await make('final_api_second');
    const doc=await (await send('/api/documents','POST',{siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',details:{kind:'품의서'}},admin)).json(),path=`/api/documents/${doc.id}`;
    assert.equal((await send(path+'/approval-line','PUT',{reviewerIds:[first.id,second.id]},admin)).status,200);assert.equal((await send(path+'/meeting-signature','POST',{signature},admin)).status,200);assert.equal((await send(path+'/transition','POST',{action:'submit'},admin)).status,200);
    const login=async loginId=>(await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],firstCookie=await login(first.login_id),secondCookie=await login(second.login_id),review=`/api/reviewer/documents/${doc.id}`,privilege=`/api/reviewers/${first.id}/final-approval`;
    assert.equal((await (await send(review,'GET',undefined,firstCookie)).json()).canFinalApprove,false);
    assert.equal((await send(privilege,'PUT',{siteId:site.id,enabled:true,expectedEnabled:false})).status,401);assert.equal((await send(privilege,'PUT',{siteId:site.id,enabled:true,expectedEnabled:false},firstCookie)).status,401);
    assert.equal((await send(review+'/decision','POST',{action:'final_approve',signature},firstCookie)).status,400);
    assert.equal((await send(privilege,'PUT',{siteId:site.id,enabled:true,expectedEnabled:false},admin)).status,200);const available=await (await send(review,'GET',undefined,firstCookie)).json();assert.equal(available.canFinalApprove,true);assert.deepEqual(available.remainingApprovers,[second.name]);
    assert.equal((await send(privilege,'PUT',{siteId:site.id,enabled:false,expectedEnabled:true},admin)).status,200);assert.equal((await (await send(review,'GET',undefined,firstCookie)).json()).canFinalApprove,false);assert.equal((await send(review+'/decision','POST',{action:'final_approve',signature},firstCookie)).status,400);
    assert.equal((await send(privilege,'PUT',{siteId:site.id,enabled:true,expectedEnabled:false},admin)).status,200);
    assert.equal((await send(review+'/decision','POST',{action:'final_approve'},firstCookie)).status,400);assert.equal((await send(path+'/transition','POST',{action:'final_approve',signature},admin)).status,400);
    assert.equal((await send(review+'/decision','POST',{action:'final_approve',signature},firstCookie)).status,200);assert.equal((await send(review,'GET',undefined,secondCookie)).status,404);
    assert.deepEqual((await (await send(path+'/approval-line','GET',undefined,admin)).json()).map(row=>row.state),['approved','skipped']);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
