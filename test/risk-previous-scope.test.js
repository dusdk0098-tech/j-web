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
