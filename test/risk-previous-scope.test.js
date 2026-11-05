import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('이전 평가 조회는 늦은 응답과 계정·화면·조건 변경을 차단한다',async()=>{
  const source=readFileSync('public/app.js','utf8');
  const code=source.split('      let riskPreviousGeneration=0;')[1].split("\n      return;\n    }\n    if(select.value==='notice')")[0];
  const input=value=>({value,addEventListener(_event,fn){this.change=fn;}});
  const kind=input('regular'),scale=input('three'),date=input('2026-01-01'),button={},error={textContent:''};
  const copies=[],muscles=[],processes=[],list={isConnected:true,_html:'',textContent:'',set innerHTML(v){this._html=v;this.buttons=v.includes('data-risk-copy')?[{dataset:{riskCopy:'0'}}]:[];this.muscles=v.includes('data-mus-copy')?[{dataset:{musCopy:'0'}}]:[];this.processes=v.includes('data-process-copy')?[{dataset:{processCopy:'0'}}]:[];},get innerHTML(){return this._html;},querySelectorAll(q){return q==='[data-risk-copy]'?this.buttons:q==='[data-process-copy]'?this.processes:this.muscles;}};
  const target={insertAdjacentHTML(_where,v){copies.push(v);}};
  const nodes={'#dialog-form select[name=riskKind]':kind,'#dialog-form select[name=riskScale]':scale,'#dialog-form input[name=date]':date,'#risk-previous-list':list,'#risk-previous':button,'#dialog-error':error,'#risk-list':target};
  const state={siteId:1,page:'documents',admin:{id:1}},actor=state.admin,dialog={open:true},select={value:'risk'},pending=[];
  const context={URLSearchParams,state,actor,siteId:1,page:'documents',detailEpoch:3,educationEpoch:3,dialog,select,doc:null,$:key=>nodes[key],esc:x=>x,rowHtml:row=>row.text,copyRiskItem:x=>x,updateRiskInputs(){},addRiskCopyButtons(){},muscleEditor:{append:x=>muscles.push(x)},processEditor:{append:x=>{processes.push(x);return x.length;}},api:(_url,_options,current)=>new Promise((resolve,reject)=>pending.push({resolve,reject,current}))};
  vm.runInNewContext('let riskPreviousGeneration=0;'+code,context);
  const data=title=>[{date:'2025-01-01',title,details:JSON.stringify({items:[{text:title}],musculoskeletalItems:[{name:title}],processes:[{name:title,contractorId:0,roles:{workerRequired:{kind:'worker',id:1}}}]})}];
  const old=button.onclick(),fresh=button.onclick();
  pending[1].resolve(data('최신'));await fresh;assert.match(list.innerHTML,/최신/);const oldButton=list.buttons[0],oldMuscle=list.muscles[0],oldProcess=list.processes[0];
  pending[0].resolve(data('이전'));await old;assert.match(list.innerHTML,/최신/);assert.doesNotMatch(list.innerHTML,/이전/);
  oldButton.onclick();oldProcess.onclick();oldMuscle.onclick();assert.deepEqual(copies,['최신']);assert.equal(processes.length,1);assert.equal(muscles.length,1);
  const cancelled=button.onclick();state.admin={id:2};pending[2].reject(new Error('오래된 오류'));await cancelled;assert.equal(error.textContent,'근골격계 항목을 추가했습니다. 확인 후 문서를 저장하세요.');
  oldButton.onclick();oldProcess.onclick();oldMuscle.onclick();assert.equal(processes.length,1);assert.equal(copies.length,1);assert.equal(muscles.length,1);await button.onclick();assert.equal(pending.length,3);
  state.admin=actor;const changed=button.onclick();kind.value='other';kind.change();kind.value='regular';pending[3].resolve(data('조건 변경'));await changed;assert.equal(list.innerHTML,'');
  const left=button.onclick();state.page='other';pending[4].resolve(data('이동'));await left;assert.equal(list.innerHTML,'');
});

test('이전 평가의 새 공정과 위험요인 함께 추가 버튼은 같은 조회 화면에서만 동작한다',async()=>{
  const {planProcessRiskCopy}=await import('../public/risk-scale.js'),source=readFileSync('public/app.js','utf8'),code=source.split('      let riskPreviousGeneration=0;')[1].split("\n      return;\n    }\n    if(select.value==='notice')")[0],input=value=>({value,addEventListener(){}}),kind=input('regular'),scale=input('3x3'),date=input('2026-01-01'),button={},error={textContent:''},appended=[],riskMarkup=[],muscles=[];
  const list={isConnected:true,set innerHTML(value){this.html=value;this.buttons=value.includes('data-process-full-copy')?[{dataset:{processFullCopy:'0'}}]:[];},get innerHTML(){return this.html||'';},querySelectorAll(q){return q==='[data-process-full-copy]'?this.buttons:[];}},riskList={querySelectorAll:()=>[],insertAdjacentHTML:(_where,value)=>riskMarkup.push(value)},nodes={'#dialog-form select[name=riskKind]':kind,'#dialog-form select[name=riskScale]':scale,'#dialog-form input[name=date]':date,'#risk-previous-list':list,'#risk-previous':button,'#dialog-error':error,'#risk-list':riskList},state={siteId:1,page:'documents',admin:{id:1}},actor=state.admin,previous={date:'2025-01-01',title:'가상 이전 평가',details:JSON.stringify({processes:[{name:'공정',contractorId:0,roles:{workerRequired:{kind:'worker',id:1}}}],items:[{processName:'공정',contractor:'직영',task:'가상 위험',selected:true,supervisorOpinion:'이전 의견'}],musculoskeletalItems:[]})};
  const context={URLSearchParams,state,actor,siteId:1,page:'documents',detailEpoch:3,educationEpoch:3,dialog:{open:true},select:{value:'risk'},doc:null,$:key=>nodes[key],esc:String,rowHtml:row=>JSON.stringify(row),copyRiskItem:x=>x,updateRiskInputs(){},addRiskCopyButtons(){},riskFields:{task:'작업'},riskScale:scale,companies:[],planProcessRiskCopy,muscleEditor:{read:()=>[],append:rows=>muscles.push(rows)},processEditor:{read:()=>[],append:rows=>appended.push(rows)},api:async()=>[previous]};
  vm.runInNewContext('let riskPreviousGeneration=0;'+code,context);await button.onclick();const full=list.buttons[0];full.onclick();assert.equal(full.disabled,true);assert.deepEqual(appended[0],[{name:'공정',contractorId:0}]);assert.match(riskMarkup[0],/가상 위험/);assert.doesNotMatch(riskMarkup[0],/이전 의견/);assert.equal(muscles.length,1);state.admin={id:2};full.onclick();assert.equal(appended.length,1);
});
