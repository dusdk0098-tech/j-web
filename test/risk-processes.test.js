import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {riskProcessSummary,mountRiskProcesses,mountRiskProcessPicker} from '../public/risk-review-roles.js';
import {riskDetailMarkup} from '../public/risk-detail.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('공정은 위험요인 없이 저장하고 이전 화면 수정·결재 사본에서 보존한다',()=>{
 const store=new Store(':memory:');try{
  const a=store.createSite({name:'가상 현장'}),b=store.createSite({name:'다른 현장'}),company=store.createCompany({siteId:a.id,name:'가상 업체',trade:'가상 공종'}),foreign=store.createCompany({siteId:b.id,name:'다른 업체',trade:'가상 공종'}),input={siteId:a.id,type:'risk',title:'가상 평가',date:'2026-11-05',details:{items:[],processes:[{name:' <빈 공정> ',contractorId:company.id},{name:'직영 공정',contractorId:0}]}},doc=store.createDocument(input),read=()=>JSON.parse(store.document(doc.id).details);
  assert.deepEqual(read().processes,[{name:'<빈 공정>',contractorId:company.id,contractor:'가상 업체'},{name:'직영 공정',contractorId:0}]);
  for(const processes of [[{name:'다른 현장',contractorId:foreign.id}],[{name:' ',contractorId:0}],[{name:'가상',contractorId:-1}],[{name:'같음',contractorId:0},{name:' 같음 ',contractorId:0}],Array.from({length:101},(_,i)=>({name:String(i),contractorId:0}))])assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items:[],processes}}));
  store.updateDocument(doc.id,{...input,details:{items:[]}});assert.equal(read().processes.length,2);
  assert.ok(store.documents(a.id,'risk','','','','',String(company.id)).some(row=>row.id===doc.id));
  store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{items:[],processes:[{name:'새 공정',contractorId:0,roles:{}}]}});assert.equal(read().processes[0].name,'새 공정');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).processes[0].name,'<빈 공정>');
  const html=riskDetailMarkup({items:[],processes:JSON.parse(store.approvalCycle(doc.id,cycle).document.details).processes},esc,{}, {},{});assert.match(html,/&lt;빈 공정&gt;/);assert.doesNotMatch(html,/<빈 공정>/);assert.match(html,/가상 업체/);assert.match(riskProcessSummary(read(),esc),/새 공정/);
  store.updateDocument(doc.id,{...input,details:{items:[],processes:[]}});assert.deepEqual(read().processes,[]);
 }finally{store.close();}
});
test('공정 입력기는 목록을 읽고 삭제하며 이름과 업체를 안전하게 표시한다',()=>{
 const old=globalThis.document,list={children:[],append(row){this.children.push(row)}},add={},host={set innerHTML(value){this.html=value},querySelector(sel){return sel==='[data-process-list]'?list:add}};
 globalThis.document={createElement(){const row={set innerHTML(value){this.html=value;this.name={value:value.match(/data-process-name[^>]*value="([^"]*)"/)?.[1]||''};this.company={value:value.includes('value="1" selected')?'1':'0'};this.removeButton={}},querySelector(sel){return sel==='[data-process-name]'?this.name:sel==='[data-process-company]'?this.company:this.removeButton},remove(){list.children.splice(list.children.indexOf(this),1)}};return row;}};
 try{const editor=mountRiskProcesses(host,[{name:'가상',contractorId:1,roles:{}}],[{id:1,name:'<업체>',trade:'가상'}],esc);assert.match(list.children[0].html,/&lt;업체&gt;/);assert.deepEqual(editor.read(),[{name:'가상',contractorId:1,roles:{}}]);add.onclick();list.children[1].name.value='새 공정';assert.equal(editor.read().length,2);list.children[0].removeButton.onclick();assert.deepEqual(editor.read(),[{name:'새 공정',contractorId:0,roles:{}}]);}finally{globalThis.document=old;}
});


test('위험요인에서 현재 공정을 선택하면 공정명과 협력사를 함께 입력한다',()=>{
 const listeners={},container={addEventListener:(name,fn)=>{listeners[name]=fn;}},values={process:{value:'기존 공정'},company:{value:'3'},name:{value:'기존 업체'}},row={parentElement:container,querySelector:sel=>values[sel]},select={value:'',innerHTML:'',matches:sel=>sel==='[data-risk-process]',closest:()=>row},companies=[{id:1,name:'<가상 업체>'}],processes=[{name:' 가상 공정 ',contractorId:1},{name:'직영 공정',contractorId:0},{name:'다른 업체',contractorId:99}],editor={read:()=>processes},selectors={process:'process',companySelect:'company',companyName:'name'};
 mountRiskProcessPicker(container,editor,companies,selectors,esc);listeners.focusin({target:select});assert.match(select.innerHTML,/&lt;가상 업체&gt;/);assert.doesNotMatch(select.innerHTML,/다른 업체|<가상 업체>/);
 select.value=JSON.stringify(['가상 공정',1]);listeners.change({target:select});assert.deepEqual(Object.values(values).map(v=>v.value),['가상 공정','1','<가상 업체>']);assert.equal(select.value,'');
 select.value=JSON.stringify(['직영 공정',0]);listeners.change({target:select});assert.deepEqual(Object.values(values).map(v=>v.value),['직영 공정','','직영']);
 select.value=JSON.stringify(['가상 공정',1]);processes.shift();listeners.change({target:select});assert.deepEqual(Object.values(values).map(v=>v.value),['직영 공정','','직영']);
 select.value='잘못된 값';listeners.change({target:select});assert.deepEqual(Object.values(values).map(v=>v.value),['직영 공정','','직영']);
});

test('공정 담당자는 같은 현장과 협력사 계정만 지정하고 비활성 후에도 기존 사본을 보존한다',()=>{
 const store=new Store(':memory:');try{
  const a=store.createSite({name:'가상 현장'}),b=store.createSite({name:'다른 현장'}),company=store.createCompany({siteId:a.id,name:'시험 업체',trade:'가상'}),other=store.createCompany({siteId:a.id,name:'다른 업체',trade:'가상'}),make=(siteId,companyId,name)=>store.createWorker({siteId,name,companyId,company:companyId===company.id?'시험 업체':'다른 업체',category:'일용직',occupation:'가상'}),worker=make(a.id,company.id,'시험 근로자'),wrong=make(a.id,other.id,'다른 소속'),foreign=make(b.id,0,'다른 현장'),staff=store.createReviewer({siteId:a.id,loginId:'processstaff',name:'시험 직원',password:'virtual-password-123'});
  for(const person of [worker,wrong,foreign])store.db.prepare('INSERT INTO worker_accounts(worker_id,site_id,login_id,salt,password_hash) VALUES(?,?,?,?,?)').run(person.id,person.site_id,'u'+person.id,Buffer.alloc(16),Buffer.alloc(32));
  assert.throws(()=>store.workerDocumentOptions(a.id,worker.id,'risk'),/권한/);store.setWorkerPermissions(a.id,worker.id,['risk']);const options=store.workerDocumentOptions(a.id,worker.id,'risk');assert.ok(options.riskPeople.some(person=>person.kind==='worker'&&person.id===worker.id));assert.ok(options.riskPeople.some(person=>person.kind==='reviewer'&&person.id===staff.id));assert.ok(!options.riskPeople.some(person=>person.id===foreign.id&&person.kind==='worker'));assert.ok(options.riskPeople.every(person=>!('login_id' in person)&&!('password_hash' in person)));
  const roles={workerRequired:{kind:'worker',id:worker.id,name:'위조'},constructionManager:{kind:'reviewer',id:staff.id}},base={siteId:a.id,type:'risk',title:'시험 평가',date:'2026-11-05',details:{items:[],processes:[{name:'시험 공정',contractorId:company.id,roles}]}},doc=store.createAuthorizedDocument(base),read=()=>JSON.parse(store.document(doc.id).details).processes[0];
  assert.equal(read().roles.workerRequired.name,'시험 근로자');assert.equal(read().roles.constructionManager.name,'시험 직원');assert.throws(()=>store.createAuthorizedDocument({...base,details:{items:[],processes:[{name:'시험 공정',contractorId:company.id,roles:{workerRequired:{kind:'worker',id:wrong.id}}}]}}),/현장과 협력사/);assert.throws(()=>store.createAuthorizedDocument({...base,details:{items:[],processes:[{name:'시험 공정',contractorId:company.id,roles:{workerRequired:{kind:'worker',id:foreign.id}}}]}}),/현장과 협력사/);
  assert.throws(()=>store.updateDocument(doc.id,{...base,details:{items:[],processes:[{name:'시험 공정',contractorId:company.id}]}}),/담당자를 보존/);store.updateDocument(doc.id,{...base,details:{items:[]}});assert.equal(read().roles.workerRequired.name,'시험 근로자');
  store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateReviewer(a.id,staff.id,{active:false});store.db.prepare('INSERT INTO worker_account_blocks(worker_id,site_id,blocked,version) VALUES(?,?,1,?)').run(worker.id,a.id,'virtual');store.updateDocument(doc.id,base);assert.equal(read().roles.constructionManager.name,'시험 직원');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).processes[0].roles.workerRequired.name,'시험 근로자');
  assert.throws(()=>store.createAuthorizedDocument(base),/활성 시험 담당자/);assert.doesNotMatch(JSON.stringify(store.riskProcessPeople(a.id)),/시험 직원|시험 근로자/);
 }finally{store.close();}
});

test('담당자 선택은 후보 로딩과 협력사 변경에도 기존 선택·해제 상태를 보존한다',()=>{
 const previous=globalThis.document,list={children:[],append(x){this.children.push(x)}},status={textContent:''},add={},host={set innerHTML(value){this.html=value},querySelector(sel){return sel==='[data-process-list]'?list:sel==='[data-process-people-status]'?status:add}};
 globalThis.document={createElement(){const selectors={},field={saved:{},set innerHTML(value){this.html=value;selectors['[data-process-name]']={value:'공정'};selectors['[data-process-company]']={value:'1'};selectors['[data-process-remove]']={};for(const key of ['workerRequired','workerOptional','constructionManager','contractorManager'])selectors[`[data-process-role="${key}"]`]={value:'',innerHTML:'',disabled:false};},querySelector:key=>selectors[key],remove(){}};return field;}};
 try{const editor=mountRiskProcesses(host,[{name:'공정',contractorId:1,roles:{workerRequired:{kind:'worker',id:1,name:'<이전 사람>'}}}],[{id:1,name:'업체'},{id:2,name:'다른 업체'}],esc),field=list.children[0],required=field.querySelector('[data-process-role="workerRequired"]');assert.equal(required.disabled,true);assert.equal(required.value,'worker:1');assert.match(required.innerHTML,/&lt;이전 사람&gt;/);
  editor.setPeople([{kind:'worker',id:1,name:'<현재 사람>',company_id:1},{kind:'worker',id:2,name:'다른 소속',company_id:2},{kind:'reviewer',id:3,name:'직원'}]);assert.equal(required.disabled,false);assert.match(required.innerHTML,/&lt;현재 사람&gt;/);assert.doesNotMatch(required.innerHTML,/다른 소속/);assert.equal(editor.read()[0].roles.workerRequired.id,1);
  field.querySelector('[data-process-company]').value='2';field.querySelector('[data-process-company]').onchange();assert.equal(required.value,'worker:1');assert.match(required.innerHTML,/&lt;현재 사람&gt;/);required.value='';field.querySelector('[data-process-company]').onchange();assert.equal(required.value,'');assert.equal(editor.read()[0].roles.workerRequired,undefined);assert.match(required.innerHTML,/다른 소속/);
 }finally{globalThis.document=previous;}
});
