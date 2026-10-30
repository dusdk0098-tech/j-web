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

test('다른 업무 문서 참조는 현장·자기 참조를 확인하고 결재 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),base={siteId:site.id,type:'office',title:'가상 휴가',date:'2026-10-30',body:'이전 내용',details:{kind:'휴가신청서'}},source=s.createDocument(base),foreign=s.createDocument({...base,siteId:other.id}),nonOffice=s.createDocument({siteId:site.id,type:'tbm',title:'다른 유형',date:base.date}),file=s.addAttachment(source.id,'가상.txt',Buffer.from('이전 첨부')),reviewer=s.createReviewer({siteId:site.id,loginId:'generic_reference',name:'가상 결재자',password:'virtual-password-123'}),input={...base,title:'가상 보고',details:{kind:'사고발생보고서',referenceDocId:source.id}};
    assert.throws(()=>s.createDocument({...input,details:{...input.details,referenceDocId:foreign.id}}),/현장/);assert.throws(()=>s.createDocument({...input,details:{...input.details,referenceDocId:nonOffice.id}}),/문서/);assert.throws(()=>s.createDocument({...input,details:{kind:'경비청구',referenceId:source.id,referenceDocId:source.id}}),/문서/);
    const doc=s.createDocument(input);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'사고발생보고서'}}),/보존/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'사고발생보고서',referenceDocId:doc.id}}),/다른 업무/);assert.equal(JSON.parse(s.document(doc.id).details).referenceDocId,source.id);
    const copy=s.copyOfficeDocument(doc.id,{siteId:site.id,title:'가상 복사',date:base.date});assert.equal(JSON.parse(copy.details).referenceDocId,source.id);s.setApprovalLine(doc.id,[reviewer.id]);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');s.updateDocument(source.id,{...base,body:'새 내용'});s.deleteAttachment(file);
    const saved=s.reviewerPayload(s.document(doc.id));assert.equal(saved.linked.reference.body,'이전 내용');assert.equal(Buffer.from(s.reviewerLinkedFile(s.document(doc.id),'office-reference',source.id,file).data).toString(),'이전 첨부');assert.equal(s.reviewerLinkedFile(s.document(doc.id),'office-reference',foreign.id,file),null);
  }finally{s.close();}
});

test('연관 품의서는 같은 현장으로 제한하고 결재 당시 내용과 첨부를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),base={type:'office',title:'가상 품의',date:'2026-10-30',body:'요청 당시 내용',details:{kind:'품의서'}},source=s.createDocument({...base,siteId:site.id}),foreign=s.createDocument({...base,siteId:other.id}),file=s.addAttachment(source.id,'가상.txt',Buffer.from('요청 당시 파일')),reviewer=s.createReviewer({siteId:site.id,loginId:'expense_review',name:'가상 결재자',password:'virtual-password-123'}),expense={siteId:site.id,type:'office',title:'가상 경비',date:'2026-10-30',body:'가상 청구',details:{kind:'경비청구',referenceId:source.id}};
    assert.throws(()=>s.createDocument({...expense,details:{kind:'경비청구',referenceId:foreign.id}}),/현장/);assert.throws(()=>s.createDocument({...expense,details:{kind:'휴가신청서',referenceId:source.id}}),/품의서/);
    const doc=s.createDocument(expense);assert.throws(()=>s.updateDocument(doc.id,{...expense,details:{kind:'경비청구'}}),/보존/);s.setApprovalLine(doc.id,[reviewer.id]);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');
    s.updateDocument(source.id,{...base,siteId:site.id,body:'변경된 내용'});s.deleteAttachment(file);
    const current=s.document(doc.id),payload=s.reviewerPayload(current);assert.equal(payload.linked.reference.body,'요청 당시 내용');assert.equal(payload.linked.reference.files[0].id,file);assert.equal(Buffer.from(s.reviewerLinkedFile(current,'office-reference',source.id,file).data).toString(),'요청 당시 파일');assert.equal(s.reviewerLinkedFile(current,'office-reference',foreign.id,file),null);
    const next=s.createDocument(expense);s.setApprovalLine(next.id,[reviewer.id]);s.saveMeetingSignature(next.id,signature);s.updateDocument(source.id,{...base,siteId:site.id,details:{kind:'기타',otherKind:'가상 구분'}});assert.throws(()=>s.transition(next.id,'submit'),/품의서/);assert.equal(s.document(next.id).status,'draft');
  }finally{s.close();}
});

test('결재 중인 지정 계정만 참조 품의서의 저장된 파일을 읽는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reference-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),make=async loginId=>(await (await send('/api/reviewers','POST',{siteId:site.id,loginId,name:loginId,password:'virtual-password-123'},admin)).json()),reviewer=await make('ref_first'),outsider=await make('ref_other'),sourceInput={siteId:site.id,type:'office',title:'가상 품의',date:'2026-10-30',body:'가상 원본',details:{kind:'품의서'}},source=await (await send('/api/documents','POST',sourceInput,admin)).json();
    const upload=await fetch(`${base}/api/documents/${source.id}/attachments`,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'가상 파일'});assert.equal(upload.status,201);const file=(await upload.json()).id,expense=await (await send('/api/documents','POST',{...sourceInput,title:'가상 경비',details:{kind:'경비청구',referenceId:source.id}},admin)).json(),path=`/api/documents/${expense.id}`;
    assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(`${path}/meeting-signature`,'POST',{signature},admin)).status,200);assert.equal((await send(`${path}/transition`,'POST',{action:'submit'},admin)).status,200);
    const login=async id=>(await send('/api/reviewer/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],cookie=await login('ref_first'),otherCookie=await login('ref_other'),url=`/api/reviewer/documents/${expense.id}/linked/office-reference/${source.id}/${file}`;
    assert.equal((await send(url)).status,401);assert.equal((await send(url,'GET',undefined,otherCookie)).status,404);assert.equal(await (await send(url,'GET',undefined,cookie)).text(),'가상 파일');assert.equal((await send(`/api/reviewer/documents/${expense.id}/linked/office-reference/${source.id}/999999`,'GET',undefined,cookie)).status,404);
    assert.equal((await send(`/api/attachments/${file}`,'DELETE',undefined,admin)).status,200);assert.equal(await (await send(url,'GET',undefined,cookie)).text(),'가상 파일');const payload=await (await send(`/api/reviewer/documents/${expense.id}`,'GET',undefined,cookie)).json(),cycle=payload.document.approval_cycle_id;assert.equal(await (await send(`${path}/approval-cycles/${cycle}/files/office-reference/${source.id}/${file}`,'GET',undefined,admin)).text(),'가상 파일');
    const genericSource=await (await send('/api/documents','POST',{...sourceInput,title:'가상 휴가',details:{kind:'휴가신청서'}},admin)).json(),genericFile=(await (await fetch(`${base}/api/documents/${genericSource.id}/attachments`,{method:'POST',headers:{cookie:admin,'x-file-name':'generic.txt'},body:'가상 참조 파일'})).json()).id,generic=await (await send('/api/documents','POST',{...sourceInput,title:'가상 보고',details:{kind:'사고발생보고서',referenceDocId:genericSource.id}},admin)).json(),genericPath=`/api/documents/${generic.id}`;
    assert.equal((await send(`${genericPath}/approval-line`,'PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(`${genericPath}/meeting-signature`,'POST',{signature},admin)).status,200);assert.equal((await send(`${genericPath}/transition`,'POST',{action:'submit'},admin)).status,200);const genericUrl=`/api/reviewer/documents/${generic.id}/linked/office-reference/${genericSource.id}/${genericFile}`;assert.equal((await send(genericUrl,'GET',undefined,otherCookie)).status,404);assert.equal(await (await send(genericUrl,'GET',undefined,cookie)).text(),'가상 참조 파일');assert.equal((await send(`/api/attachments/${genericFile}`,'DELETE',undefined,admin)).status,200);assert.equal(await (await send(genericUrl,'GET',undefined,cookie)).text(),'가상 참조 파일');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
