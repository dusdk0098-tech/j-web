import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mountReviewerEducation} from '../public/reviewer-education.js';
import {changedTrainingWorkers} from '../public/training-groups.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const line=text=>source.split(/\r?\n/).find(row=>row.includes(text));

test('선택 비교는 미설정 전체와 명시적 빈 명단을 변경하지 않고 실제 변경만 전송한다',()=>{
  const workers=[{id:1,selected:0},{id:2,selected:0}];
  assert.equal(changedTrainingWorkers({configured:false,workers},[1,2]),undefined);
  assert.equal(changedTrainingWorkers({configured:true,workers},[]),undefined);
  assert.deepEqual(changedTrainingWorkers({configured:false,workers},[]),[]);
  assert.deepEqual(changedTrainingWorkers({configured:true,workers},[1]),[1]);
  const inputs=[{checked:false},{checked:false}];runInNewContext(line("if(!targets.configured)targetPanel"),{targets:{configured:false},targetPanel:{querySelectorAll:()=>inputs}});assert.ok(inputs.every(input=>input.checked));
});

test('실제 관리자 전체선택과 출역 근로자 전체선택은 서로의 선택과 미출역자를 변경하지 않는다',async()=>{
  const managers=[{dataset:{trainingManager:'10',active:'1'},checked:false},{dataset:{trainingManager:'11',active:'0'},checked:true}],workers=[{dataset:{trainingTarget:'20'},checked:false},{dataset:{trainingTarget:'21'},checked:true}],controls={},calls=[];
  const $=id=>controls[id]??=( {} ),targetPanel={insertAdjacentHTML(){},querySelectorAll(selector){const rows=selector.includes('manager')?managers:workers;return selector.includes(':checked')?rows.filter(row=>row.checked):rows;}};
  const context={managerTargets:true,editable:true,targetPanel,changedTrainingWorkers,targets:{configured:true,managers:[{id:10,name:'가상 직원',active:1},{id:11,name:'이전 직원',active:0,selected:1}],workers:[{id:20,present:1},{id:21,present:0}]},$,esc:String,doc:{id:5,edit_version:8},api:async(path,options)=>calls.push(JSON.parse(options.body)),flash(){},render:async()=>{},showError:error=>{throw error;}};
  runInNewContext(line('if(managerTargets){targetPanel'),context);runInNewContext(line("if(editable){targetPanel.insertAdjacentHTML"),context);
  controls['#training-managers-all'].onchange({target:{checked:true}});assert.deepEqual(managers.map(x=>x.checked),[true,false]);assert.deepEqual(workers.map(x=>x.checked),[false,true]);
  controls['#training-workers-all'].onchange({target:{checked:true}});assert.deepEqual(workers.map(x=>x.checked),[true,true]);assert.deepEqual(managers.map(x=>x.checked),[true,false]);
  controls['#training-workers-all'].onchange({target:{checked:false}});assert.deepEqual(workers.map(x=>x.checked),[false,true]);
  runInNewContext(line("if(editable)$('#save-targets').onclick"),context);await controls['#save-targets'].onclick();assert.deepEqual(calls,[{workerIds:[21],managerIds:[10],expectedEditVersion:8}]);
});

test('직원 교육 목록·상세의 늦은 응답은 로그아웃·계정 전환 뒤 표시되지 않는다',async()=>{
  for(const stage of ['list','detail']){
    const elements=new Map(),node=()=>({innerHTML:'',textContent:'',isConnected:true,querySelector:selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll:selector=>selector==='[data-open]'?[button]:[]}),button={dataset:{open:'5'}},target=node();let active=true,resolve;
    const pending=new Promise(done=>resolve=done),api=path=>path==='/api/reviewer/education'?(stage==='list'?pending:Promise.resolve([{id:5,title:'가상 교육',date:'2026-11-01'}])):pending;
    const mounting=mountReviewerEducation({target,api,active:()=>active});
    if(stage==='list'){active=false;target.isConnected=false;resolve([{id:5,title:'늦은 비공개 내용',date:'2026-11-01'}]);await mounting;assert.equal(elements.get('[data-list]').innerHTML,'');}
    else{await mounting;const opening=button.onclick();active=false;target.isConnected=false;resolve({document:{id:5,title:'늦은 비공개 내용',details:'{}'},attachments:[]});await opening;assert.equal(elements.get('[data-detail]').innerHTML,'');}
  }
});
