import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';

test('결재 사본은 요청 당시 이름을 보존하고 이전 사본의 미기록을 추정하지 않는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),worker=store.join(store.createInvitation(site.id).token,{name:'가상 작성자',category:'직영',company:'가상 업체',occupation:'목공',loginId:'virtual_author',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});store.setWorkerPermissions(site.id,worker.id,['training']);
    const doc=store.createWorkerDocument(site.id,worker.id,{type:'tbm',title:'가상 문서',date:'2026-11-03',body:'내용'});assert.equal(store.documentAuthor(doc.id),'가상 작성자');store.transition(doc.id,'submit');const pending=store.document(doc.id),cycle=pending.approval_cycle_id;assert.equal(store.reviewerPayload(pending).document.author_name,'가상 작성자');
    store.db.prepare('UPDATE workers SET name=? WHERE id=?').run('변경된 이름',worker.id);assert.equal(store.documentAuthor(doc.id),'변경된 이름');assert.equal(store.documents(site.id).find(row=>row.id===doc.id).author_name,'변경된 이름');assert.equal(store.reviewerPayload(pending).document.author_name,'가상 작성자');
    store.transition(doc.id,'withdraw');store.transition(doc.id,'submit');assert.equal(store.reviewerPayload(store.document(doc.id)).document.author_name,'변경된 이름');assert.equal(store.approvalCycle(doc.id,cycle).document.author_name,'가상 작성자');
    const latest=store.document(doc.id);store.db.prepare("UPDATE approval_cycles SET document_json=json_remove(document_json,'$.author_name') WHERE id=?").run(latest.approval_cycle_id);const legacy=store.reviewerPayload(latest);assert.equal(legacy.frozen,true);assert.equal(Object.hasOwn(legacy.document,'author_name'),false);assert.equal(store.reviewerPayload({...latest,approval_cycle_id:null}).document.author_name,'변경된 이름');
  }finally{store.close();}
});

test('관리자·직원 화면은 작성자 이름을 안전하게 표시하고 미기록을 구분한다',async()=>{
  const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split(/\r?\n/),review=readFileSync(new URL('../public/review.js',import.meta.url),'utf8').split(/\r?\n/),adminEsc=admin.find(line=>line.startsWith('const esc =')),reviewEsc=review.find(line=>line.startsWith('const esc=')),table=admin.find(line=>line.startsWith('function documentTable('));
  const doc={id:1,site_id:1,type:'notice',title:'가상 문서',date:'2026-11-03',status:'draft',body:'본문',author_name:'<가상 작성자>'},ctx={state:{siteId:1,types:{notice:'공지'}},statusLabels:{draft:'임시'},items:[doc]};
  const html=runInNewContext(`${adminEsc}\n${table}\ndocumentTable(items,true)`,{...ctx});assert.match(html,/<th>작성자<\/th>/);assert.match(html,/&lt;가상 작성자&gt;/);assert.doesNotMatch(html,/<가상 작성자>/);assert.doesNotMatch(runInNewContext(`${adminEsc}\n${table}\ndocumentTable(items)`,{...ctx}),/<th>작성자<\/th>/);
  const detailLine=admin.find(line=>line.startsWith('  content.innerHTML=`<section class="panel"><div class="panel-head"')&&line.includes('detail-body rich-body')),content={};assert.ok(detailLine);runInNewContext(`${adminEsc}\n${detailLine}`,{content,doc,state:ctx.state,statusLabels:ctx.statusLabels,details:{},actions:[],educationDetail:'',detailFields:'',rowsDetail:'',riskDetail:'',events:[]});assert.match(content.innerHTML,/작성자: &lt;가상 작성자&gt;/);
  const reference=review.find(line=>line.startsWith('async function openReference(')),detail={};assert.ok(reference);const api=async()=>({document:doc,attachments:[],linked:null,frozen:true});await runInNewContext(`${reviewEsc}\n${reference}\nopenReference(1)`,{api,detail,displayDocumentDetails:()=>'',planLinks:()=>''});assert.match(detail.innerHTML,/작성자: &lt;가상 작성자&gt;/);
  const reviewLine=review.find(line=>line.startsWith('  detail.innerHTML=`<h2>${esc(doc.title)}</h2>')&&line.includes('review-events'));assert.ok(reviewLine);runInNewContext(`${reviewEsc}\n${reviewLine}`,{detail,doc:{...doc,author_name:undefined},result:{frozen:true,attachments:[],linked:null,priorReviews:[]},id:1,displayDocumentDetails:()=>'',planLinks:()=>'',reviewEvents:()=>''});assert.match(detail.innerHTML,/작성자: 미기록/);
});
