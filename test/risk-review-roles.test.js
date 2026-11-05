import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { riskReviewInputs,readRiskReviewRoles,riskReviewSummary } from '../public/risk-review-roles.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('평가 담당자 이름과 기록일 입력·읽기·표시는 다섯 역할을 안전하게 보존한다',()=>{
  const roles={supervisor:{name:'가상 <이름>',date:'2026-11-02'},chief:{name:'가상 대표',date:''}},markup=riskReviewInputs({riskReviewRoles:roles},escape),values={riskRole_supervisor_name:'가상 <이름>',riskRole_supervisor_date:'2026-11-02',riskRole_chief_name:'가상 대표'};
  assert.match(markup,/가상 &lt;이름&gt;/);assert.doesNotMatch(markup,/<이름>/);assert.equal((markup.match(/type="date"/g)||[]).length,5);const read=readRiskReviewRoles(name=>values[name]);assert.equal(read.supervisor.name,'가상 <이름>');assert.equal(read.chief.name,'가상 대표');assert.deepEqual(read.safety,{name:'',date:''});const result=riskReviewSummary({riskReviewRoles:read},escape);assert.match(result,/가상 &lt;이름&gt;/);assert.match(result,/2026-11-02/);assert.match(result,/실제 검토·결재를 뜻하지 않습니다/);assert.equal(riskReviewSummary({},escape),'');
});
test('평가 담당자 기록은 이전 요청과 결재 사본에서 보존되고 잘못된 값은 거절된다',()=>{
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-03',details:{kind:'regular',items:[{task:'가상 작업'}],riskReviewRoles:{supervisor:{name:' 가상 담당 ',date:'2026-11-02'},chief:{name:'가상 대표',date:''}}}},doc=store.createDocument(input),read=()=>JSON.parse(store.document(doc.id).details),saved=read().riskReviewRoles;assert.equal(saved.supervisor.name,'가상 담당');assert.equal(saved.supervisor.date,'2026-11-02');assert.equal(saved.chief.name,'가상 대표');
    store.updateDocument(doc.id,{...input,details:{kind:'regular',items:[{task:'가상 수정'}]}});assert.deepEqual(read().riskReviewRoles,saved);
    for(const value of [{supervisor:{name:123}},{supervisor:{name:'가'.repeat(201)}},{supervisor:{date:'2026-02-30'}},{unknown:{name:'가상'}},null])assert.throws(()=>store.updateDocument(doc.id,{...input,details:{...input.details,riskReviewRoles:value}}));assert.deepEqual(read().riskReviewRoles,saved);
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{...input.details,riskReviewRoles:{supervisor:{name:'새 가상 담당',date:''}}}});assert.equal(read().riskReviewRoles.supervisor.name,'새 가상 담당');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).riskReviewRoles.supervisor.name,'가상 담당');
  }finally{store.close();}
});

test('관리자와 근로자 문서 저장은 입력된 평가 담당자 기록을 전달한다',()=>{
  const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),worker=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8'),adminLine=admin.split(String.fromCharCode(10)).find(line=>line.includes("if(data.type==='risk') data.details=")),workerLine=worker.split(String.fromCharCode(10)).find(line=>line.includes('Object.assign(input.details,{riskReviewRoles:'));assert.ok(adminLine&&workerLine);const data={type:'risk',riskRole_supervisor_name:'가상 관리자',riskRole_supervisor_date:'2026-11-02'},muscleEditor={read:()=>[]},document={querySelectorAll:()=>[]};runInNewContext(adminLine,{data,muscleEditor,document,riskFields:{},readRiskReviewRoles});assert.equal(data.details.riskReviewRoles.supervisor.name,'가상 관리자');const input={details:{}},form={elements:{kind:{value:''},scale:{value:''},periodFrom:{value:''},periodTo:{value:''},riskRole_supervisor_name:{value:'가상 근로자'},riskRole_supervisor_date:{value:'2026-11-03'}}},fields={querySelector:()=>({children:[]})};runInNewContext(workerLine,{input,form,fields,muscleEditor,riskFields:{},readRiskReviewRoles});assert.equal(input.details.riskReviewRoles.supervisor.name,'가상 근로자');assert.equal(input.details.riskReviewRoles.supervisor.date,'2026-11-03');
});
