import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';
import { documentRichLimits,normalizeRichText,richTextToPlain,richTextToHTML } from '../public/rich-text.js';

const cell=(type,value)=>({type,children:[{type:'text',value}]});
const rich=[{type:'p',children:[{type:'strong',children:[{type:'text',value:'가상 문서'}]}]},{type:'table',children:[{type:'tbody',children:[{type:'tr',children:[cell('th','구분'),cell('td','가상')]},{type:'tr',children:[cell('th','기간'),cell('td','10월')]}]}]}];
const changed=[{type:'p',children:[{type:'text',value:'변경된 가상 본문'}]}];
const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
const base={type:'office',title:'가상 업무',date:'2026-10-30',details:{kind:'품의서'}};

test('업무 문서의 표는 검색 텍스트와 안전한 서식을 보존한다',()=>{
  const result=normalizeRichText(rich,documentRichLimits),html=richTextToHTML(result,documentRichLimits);
  assert.equal(richTextToPlain(result,documentRichLimits),'가상 문서\n구분\t가상\n기간\t10월');assert.match(html,/<table><tbody><tr><th>구분<\/th><td>가상<\/td><\/tr>/);
  assert.equal(richTextToPlain([{type:'p',children:[{type:'text',value:'앞'}]},{type:'table',children:[{type:'tbody',children:[{type:'tr',children:[{type:'td',children:[]},cell('td','값')]}]}]}],documentRichLimits),'앞\n\t값');
  assert.equal(richTextToPlain([{type:'table',children:[{type:'tbody',children:[{type:'tr',children:[cell('td','가'),{type:'td',children:[{type:'p',children:[{type:'text',value:'나'}]}]}]}]}]}],documentRichLimits),'가\t나');
  assert.throws(()=>normalizeRichText([{type:'table',children:[{type:'script',children:[]}]}],documentRichLimits));assert.throws(()=>normalizeRichText([{type:'table',children:[{type:'text',value:'잘못된 구조'}]}],documentRichLimits));
  assert.throws(()=>normalizeRichText([{type:'a',href:'javascript:alert(1)',children:[{type:'text',value:'링크'}]}],documentRichLimits));
  assert.equal(richTextToPlain([{type:'text',value:'가'.repeat(20000)}],documentRichLimits).length,20000);assert.throws(()=>normalizeRichText([{type:'text',value:'가'.repeat(20001)}],documentRichLimits));
});

test('업무 문서 서식은 이전 입력, 복사, 서명과 결재·참조 사본을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-rich-')),file=join(dir,'test.sqlite');let s;
  try{
    s=new Store(file);const site=s.createSite({name:'가상 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'office_rich_review',name:'가상 결재자',password:'virtual-password-123'}),legacy=s.createDocument({...base,siteId:site.id,body:'가'.repeat(15000)});
    const updated=s.updateDocument(legacy.id,{...base,siteId:site.id,details:{kind:'품의서',bodyRich:[{type:'text',value:legacy.body}]}});assert.equal(updated.body.length,15000);
    const source=s.createDocument({...base,siteId:site.id,body:'무시할 외부 입력',details:{kind:'품의서',bodyRich:rich}});assert.equal(source.body,richTextToPlain(rich,documentRichLimits));s.saveMeetingSignature(source.id,signature);
    assert.throws(()=>s.updateDocument(source.id,{...base,siteId:site.id,body:'서식 누락',details:{kind:'품의서'}}),error=>error.sessionStatus===409);assert.ok(s.meetingSignature(source.id));
    const preserved=s.updateDocument(source.id,{...base,siteId:site.id,title:'수정된 제목',body:source.body,details:{kind:'품의서'}});assert.deepEqual(JSON.parse(preserved.details).bodyRich,normalizeRichText(rich,documentRichLimits));assert.equal(s.meetingSignature(source.id),null);
    const copy=s.copyOfficeDocument(source.id,{siteId:site.id,title:'가상 복사',date:'2026-10-31'});assert.deepEqual(JSON.parse(copy.details).bodyRich,normalizeRichText(rich,documentRichLimits));assert.equal(s.meetingSignature(copy.id),null);
    const doc=s.createDocument({...base,siteId:site.id,title:'가상 참조 문서',details:{kind:'품의서',referenceDocId:source.id,bodyRich:changed}});s.setApprovalLine(doc.id,[reviewer.id]);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;
    let payload=s.reviewerPayload(s.document(doc.id));assert.deepEqual(JSON.parse(payload.document.details).bodyRich,normalizeRichText(changed,documentRichLimits));assert.deepEqual(payload.linked.reference.bodyRich,normalizeRichText(rich,documentRichLimits));
    s.updateDocument(source.id,{...base,siteId:site.id,details:{kind:'품의서',bodyRich:changed}});payload=s.reviewerPayload(s.document(doc.id));assert.deepEqual(payload.linked.reference.bodyRich,normalizeRichText(rich,documentRichLimits));
    s.close();s=null;s=new Store(file);assert.deepEqual(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).bodyRich,normalizeRichText(changed,documentRichLimits));assert.deepEqual(s.approvalCycle(doc.id,cycle).linked.reference.bodyRich,normalizeRichText(rich,documentRichLimits));
  }finally{if(s)s.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('업무 문서 API는 큰 서식과 결재 사본을 현장·계정별로 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-rich-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'api_office_rich',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:reviewer.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    const large=Array.from({length:400},()=>({type:'strong',children:[{type:'text',value:'가'.repeat(50)}]}));assert.ok(new TextEncoder().encode(JSON.stringify(large)).length>65536);const largeResult=await send('/api/documents','POST',{...base,siteId:site.id,details:{kind:'품의서',bodyRich:large}},admin);assert.equal(largeResult.status,201);assert.equal((await largeResult.json()).body.length,20000);
    const created=await send('/api/documents','POST',{...base,siteId:site.id,details:{kind:'품의서',bodyRich:rich}},admin);assert.equal(created.status,201);const doc=await created.json(),path=`/api/documents/${doc.id}`;
    assert.equal((await send(path,'PUT',{...base,siteId:site.id,body:'서식 누락'},admin)).status,409);assert.equal((await send('/api/documents','POST',{...base,siteId:site.id,details:{kind:'품의서',bodyRich:[{type:'script',children:[]}]}},admin)).status,400);
    assert.equal((await send(path+'/approval-line','PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(path+'/meeting-signature','POST',{signature},admin)).status,200);assert.equal((await send(path+'/transition','POST',{action:'submit'},admin)).status,200);
    const review=`/api/reviewer/documents/${doc.id}`;assert.equal((await send(review)).status,401);const payload=await (await send(review,'GET',undefined,cookie)).json();assert.deepEqual(JSON.parse(payload.document.details).bodyRich,normalizeRichText(rich,documentRichLimits));assert.equal(payload.document.body,richTextToPlain(rich,documentRichLimits));
    assert.equal((await send('/rich-editor.js')).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
