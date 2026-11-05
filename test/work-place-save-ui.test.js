import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=source.indexOf("async data=>{const form=$('#dialog-form'),area=prefix=>"),end=source.indexOf('}},current);',begin);
assert.ok(begin>0&&end>begin);

// shortcut: 편집 폼의 요청과 잠금만 모사하며 실제 브라우저 입력은 별도 확인이 필요하다.
test('장소 저장 중 입력과 복사 버튼을 잠그고 실패 시 복원한다',async()=>{
 const controls=[{disabled:false},{disabled:false},{disabled:true}],form={querySelectorAll:selector=>selector==='[data-place-extra]'?[{querySelector:key=>({value:key==='[data-extra-label]'?'가상 항목':'가상 내용'})}]:[{value:'철판설치'}]},body={querySelectorAll:()=>controls},requests=[],state={current:true};
 const context={siteId:1,place:null,placeChoices:{reinforcementChoices:[]},current:()=>state.current,$:selector=>selector==='#dialog-form'?form:body,api:(path,options,current)=>new Promise((resolve,reject)=>requests.push({path,options,current,resolve,reject}))};
 const submit=runInNewContext('('+source.slice(begin,end+2)+')',context),pending=submit({name:'가상 장소',work_terrain:'평지',route_terrain:'경사지'});
 assert.deepEqual(controls.map(control=>control.disabled),[true,true,true]);assert.equal(requests[0].path,'/api/work-places');const payload=JSON.parse(requests[0].options.body);assert.equal(payload.work.terrain,'평지');assert.equal(payload.route.terrain,'경사지');assert.equal(payload.additional[0].label,'가상 항목');
 requests[0].reject(Error('가상 저장 실패'));await assert.rejects(pending,/가상 저장 실패/);assert.deepEqual(controls.map(control=>control.disabled),[false,false,true]);
 const next=submit({name:'가상 장소'});state.current=false;assert.equal(requests[1].current(),false);requests[1].resolve({id:4});await next;assert.deepEqual(controls.map(control=>control.disabled),[false,false,true]);
});

test('작업장 입력을 운행경로의 같은 항목과 선택 값에 복사한다',()=>{
 const line=source.split('\n').find(value=>value.includes("$('#copy-place').onclick="));assert.ok(line);const button={},targets=[{name:'route_terrain',type:'select-one',value:'경사지'},{name:'route_groundExtra',type:'text',value:'이전'},{name:'route_reinforcementChoices',type:'checkbox',value:'철판설치',checked:false},{name:'route_reinforcementChoices',type:'checkbox',value:'지반개량',checked:true}],form={elements:{work_terrain:{value:'평지'},work_groundExtra:{value:'가상 지반'},work_reinforcementChoices:[{value:'철판설치',checked:true},{value:'지반개량',checked:false}]},querySelectorAll:()=>targets};
 runInNewContext(line.slice(0,-2),{$:key=>key==='#copy-place'?button:form});button.onclick();assert.equal(targets[0].value,'평지');assert.equal(targets[1].value,'가상 지반');assert.equal(targets[2].checked,true);assert.equal(targets[3].checked,false);
});
