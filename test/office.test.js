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

const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

test('업무 문서 결재자 9명과 참조자 10명을 제한하고 순차 처리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),people=Array.from({length:11},(_,i)=>s.createReviewer({siteId:site.id,loginId:`office_limit_${i}`,name:`가상 ${i}`,password:'virtual-password-123'})),ids=people.map(person=>person.id),doc=s.createDocument({siteId:site.id,type:'office',title:'가상 업무 문서',date:'2026-10-30',details:{kind:'품의서'}}),normal=s.createDocument({siteId:site.id,type:'tbm',title:'가상 안전 문서',date:'2026-10-30'});
    s.setApprovalLine(doc.id,ids.slice(0,9));assert.throws(()=>s.setApprovalLine(doc.id,ids.slice(0,10)),/결재자/);assert.deepEqual(s.approvalLine(doc.id).map(row=>row.reviewer_id),ids.slice(0,9));s.setApprovalLine(normal.id,ids.slice(0,4));assert.throws(()=>s.setApprovalLine(normal.id,ids.slice(0,5)),/결재자/);assert.equal(s.approvalLine(normal.id).length,4);
    s.setOfficeReferences(doc.id,ids.slice(0,10));assert.throws(()=>s.setOfficeReferences(doc.id,ids),/참조자/);assert.equal(s.officeReferences(doc.id).length,10);s.saveMeetingSignature(doc.id,signature);assert.throws(()=>s.setApprovalLine(doc.id,[ids[0]],()=>{throw Error('세션 만료');}),/세션 만료/);assert.throws(()=>s.setOfficeReferences(doc.id,[ids[0]],()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.approvalLine(doc.id).length,9);assert.equal(s.officeReferences(doc.id).length,10);assert.ok(s.meetingSignature(doc.id));
    s.transition(doc.id,'submit');for(let i=0;i<9;i++){assert.equal(s.reviewerDocument(ids[i],doc.id)?.id,doc.id);if(i<8)assert.equal(s.reviewerDocument(ids[i+1],doc.id),null);s.reviewerTransition(doc.id,ids[i],'approve','가상 의견',signature);}assert.equal(s.document(doc.id).status,'approved');assert.equal(s.approvalLine(doc.id).filter(row=>row.state==='approved').length,9);
    const legacy=s.createDocument({siteId:site.id,type:'office',title:'이전 가상 문서',date:'2026-10-30',details:{kind:'품의서'}}),insert=s.db.prepare('INSERT INTO office_reference_recipients(document_id,reviewer_id) VALUES(?,?)');for(const id of ids)insert.run(legacy.id,id);assert.throws(()=>s.setOfficeReferences(legacy.id,ids),/참조자/);assert.equal(s.officeReferences(legacy.id).length,11);
  }finally{s.close();}
});

test('가상 업무 문서는 작성자 서명과 결재자를 확인하고 요청 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'office_review',name:'가상 결재자',password:'virtual-password-123'}),foreign=s.createReviewer({siteId:other.id,loginId:'other_review',name:'다른 결재자',password:'virtual-password-123'}),input={siteId:site.id,type:'office',title:'가상 품의',date:'2026-10-30',body:'가상 내용',details:{kind:'품의서'}};
    assert.throws(()=>s.createDocument({...input,details:{kind:'알 수 없음'}}),/구분/);assert.throws(()=>s.createDocument({...input,details:{kind:'기타',otherKind:''}}),/구분/);
    const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/서명/);assert.throws(()=>s.setApprovalLine(doc.id,[foreign.id]),/현장/);
    s.saveMeetingSignature(doc.id,signature);s.setApprovalLine(doc.id,[reviewer.id]);assert.equal(s.meetingSignature(doc.id),null);assert.throws(()=>s.transition(doc.id,'submit'),/서명/);
    s.saveMeetingSignature(doc.id,signature);s.updateDocument(doc.id,{...input,body:'수정된 가상 내용'});assert.equal(s.meetingSignature(doc.id),null);s.saveMeetingSignature(doc.id,signature);s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 첨부'));assert.equal(s.meetingSignature(doc.id),null);s.saveMeetingSignature(doc.id,signature);
    s.transition(doc.id,'submit');const requested=s.document(doc.id),payload=s.reviewerPayload(requested);assert.equal(payload.frozen,true);assert.equal(payload.document.body,'수정된 가상 내용');assert.equal(JSON.parse(payload.document.details).kind,'품의서');assert.equal(payload.attachments.length,1);assert.ok(s.reviewerLinkedSignature(requested,'author',0));assert.deepEqual(s.reviewerDocuments(foreign.id),[]);
    assert.equal(s.weeklyActivity(site.id,'2026-10-30')[0].documents.office,undefined);s.reviewerTransition(doc.id,reviewer.id,'approve','가상 의견',signature);assert.equal(s.document(doc.id).status,'approved');
  }finally{s.close();}
});

test('업무 문서 결재자 API는 지정된 시험 계정만 사본과 서명을 보여준다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/office-template.js')).status,200);const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'office_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),input={siteId:site.id,type:'office',title:'가상 휴가',date:'2026-10-30',body:'가상 내용',details:{kind:'휴가신청서'}},created=await send('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json(),path=`/api/documents/${doc.id}`;
    assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(`${path}/transition`,'POST',{action:'submit'},admin)).status,400);assert.equal((await send(`${path}/meeting-signature`,'POST',{signature},admin)).status,200);assert.equal((await send(`${path}/transition`,'POST',{action:'submit'},admin)).status,200);
    const reviewLogin=await send('/api/reviewer/login','POST',{loginId:'office_reviewer',password:'virtual-password-123'}),cookie=reviewLogin.headers.get('set-cookie').split(';')[0],reviewPath=`/api/reviewer/documents/${doc.id}`;assert.equal((await send(reviewPath)).status,401);const payload=await (await send(reviewPath,'GET',undefined,cookie)).json();assert.equal(payload.linked.authorSignature,true);assert.equal(JSON.parse(payload.document.details).kind,'휴가신청서');assert.equal((await send(`${reviewPath}/signatures/author/0`,'GET',undefined,cookie)).status,200);assert.equal((await send(`${reviewPath}/decision`,'POST',{action:'approve',signature},cookie)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
