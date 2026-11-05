import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {riskProcessSummary,mountRiskProcesses} from '../public/risk-review-roles.js';
import {riskDetailMarkup} from '../public/risk-detail.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('공정은 위험요인 없이 저장하고 이전 화면 수정·결재 사본에서 보존한다',()=>{
 const store=new Store(':memory:');try{
  const a=store.createSite({name:'가상 현장'}),b=store.createSite({name:'다른 현장'}),company=store.createCompany({siteId:a.id,name:'가상 업체',trade:'가상 공종'}),foreign=store.createCompany({siteId:b.id,name:'다른 업체',trade:'가상 공종'}),input={siteId:a.id,type:'risk',title:'가상 평가',date:'2026-11-05',details:{items:[],processes:[{name:' <빈 공정> ',contractorId:company.id},{name:'직영 공정',contractorId:0}]}},doc=store.createDocument(input),read=()=>JSON.parse(store.document(doc.id).details);
  assert.deepEqual(read().processes,[{name:'<빈 공정>',contractorId:company.id,contractor:'가상 업체'},{name:'직영 공정',contractorId:0}]);
  for(const processes of [[{name:'다른 현장',contractorId:foreign.id}],[{name:' ',contractorId:0}],[{name:'가상',contractorId:-1}],[{name:'같음',contractorId:0},{name:' 같음 ',contractorId:0}],Array.from({length:101},(_,i)=>({name:String(i),contractorId:0}))])assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items:[],processes}}));
  store.updateDocument(doc.id,{...input,details:{items:[]}});assert.equal(read().processes.length,2);
  assert.ok(store.documents(a.id,'risk','','','','',String(company.id)).some(row=>row.id===doc.id));
  store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{items:[],processes:[{name:'새 공정',contractorId:0}]}});assert.equal(read().processes[0].name,'새 공정');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).processes[0].name,'<빈 공정>');
  const html=riskDetailMarkup({items:[],processes:JSON.parse(store.approvalCycle(doc.id,cycle).document.details).processes},esc,{}, {},{});assert.match(html,/&lt;빈 공정&gt;/);assert.doesNotMatch(html,/<빈 공정>/);assert.match(html,/가상 업체/);assert.match(riskProcessSummary(read(),esc),/새 공정/);
  store.updateDocument(doc.id,{...input,details:{items:[],processes:[]}});assert.deepEqual(read().processes,[]);
 }finally{store.close();}
});
test('공정 입력기는 목록을 읽고 삭제하며 이름과 업체를 안전하게 표시한다',()=>{
 const old=globalThis.document,list={children:[],append(row){this.children.push(row)}},add={},host={set innerHTML(value){this.html=value},querySelector(sel){return sel==='[data-process-list]'?list:add}};
 globalThis.document={createElement(){const row={set innerHTML(value){this.html=value;this.name={value:value.match(/data-process-name[^>]*value="([^"]*)"/)?.[1]||''};this.company={value:value.includes('value="1" selected')?'1':'0'};this.removeButton={}},querySelector(sel){return sel==='[data-process-name]'?this.name:sel==='[data-process-company]'?this.company:this.removeButton},remove(){list.children.splice(list.children.indexOf(this),1)}};return row;}};
 try{const editor=mountRiskProcesses(host,[{name:'가상',contractorId:1}],[{id:1,name:'<업체>',trade:'가상'}],esc);assert.match(list.children[0].html,/&lt;업체&gt;/);assert.deepEqual(editor.read(),[{name:'가상',contractorId:1}]);add.onclick();list.children[1].name.value='새 공정';assert.equal(editor.read().length,2);list.children[0].removeButton.onclick();assert.deepEqual(editor.read(),[{name:'새 공정',contractorId:0}]);}finally{globalThis.document=old;}
});
