import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRiskBulk} from '../public/musculoskeletal.js';

test('일반 위험요인 일괄 선택과 삭제는 입력·확인·편집 상태를 지킨다',()=>{
  const previous=globalThis.confirm;let approve=false,live=true,events=0;globalThis.confirm=()=>approve;
  try{
    const nodes=Object.fromEntries(['select-all','unselect-all','delete-selected','delete-all','clear-existing','clear-additional'].map(key=>[`[data-risk-${key}]`,{}]));
    const host={querySelector:key=>nodes[key]},list={children:[],dispatchEvent:event=>{assert.equal(event.type,'input');events++;}};
    for(const selected of [true,false,true]){const input={checked:selected},row={querySelector:()=>input,remove(){list.children.splice(list.children.indexOf(row),1);}};list.children.push(row);}
    mountRiskBulk(host,{list,active:()=>live});const click=key=>nodes[`[data-risk-${key}]`].onclick();
    click('unselect-all');assert.ok(list.children.every(row=>!row.querySelector().checked));assert.equal(events,1);
    click('select-all');assert.ok(list.children.every(row=>row.querySelector().checked));assert.equal(events,2);
    list.children[1].querySelector().checked=false;click('delete-selected');assert.equal(list.children.length,1);assert.equal(events,3);
    click('delete-all');assert.equal(list.children.length,1);approve=true;live=false;click('delete-all');click('select-all');assert.equal(list.children.length,1);assert.equal(events,3);
    live=true;click('delete-all');assert.equal(list.children.length,0);assert.equal(events,4);
  }finally{if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;}
});

test('관리자와 근로자의 기존·추가 조치는 구분해 확인 후 모두 지운다',()=>{
  const previous=globalThis.confirm;let approve=false,live=true,events=0;globalThis.confirm=()=>approve;
  try{
    const nodes=Object.fromEntries(['select-all','unselect-all','delete-selected','delete-all','clear-existing','clear-additional'].map(key=>[`[data-risk-${key}]`,{}]));
    const values=[{existingMeasures:{value:'가상 기존 1'},additionalMeasures:{value:'가상 추가 1'}},{existingMeasures:{value:'가상 기존 2'},additionalMeasures:{value:'가상 추가 2'}}];
    const list={children:values.map(fields=>({querySelector:selector=>selector==='[data-risk-field=existingMeasures],[data-risk=existingMeasures]'?fields.existingMeasures:selector==='[data-risk-field=additionalMeasures],[data-risk=additionalMeasures]'?fields.additionalMeasures:null})),dispatchEvent:()=>events++};
    mountRiskBulk({querySelector:key=>nodes[key]},{list,active:()=>live});
    nodes['[data-risk-clear-existing]'].onclick();assert.equal(values[0].existingMeasures.value,'가상 기존 1');assert.equal(events,0);
    approve=true;live=false;nodes['[data-risk-clear-existing]'].onclick();assert.equal(values[1].existingMeasures.value,'가상 기존 2');
    live=true;nodes['[data-risk-clear-existing]'].onclick();assert.ok(values.every(row=>row.existingMeasures.value===''));assert.equal(values[0].additionalMeasures.value,'가상 추가 1');assert.equal(events,1);
    nodes['[data-risk-clear-additional]'].onclick();assert.ok(values.every(row=>row.additionalMeasures.value===''));assert.equal(events,2);
    nodes['[data-risk-clear-existing]'].onclick();assert.equal(events,2);
  }finally{if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;}
});

for(const role of ['관리자','근로자'])test(`${role} 일괄 편집은 저장·재조회 후 반영하고 결재 사본은 보존한다`,async()=>{
  const {Store}=await import('../store.js'),store=new Store(':memory:'),previous=globalThis.confirm;globalThis.confirm=()=>true;
  try{
    const site=store.createSite({name:'가상 현장'}),invitation=store.createInvitation(site.id),worker=store.join(invitation.token,{name:'가상 근로자',category:'직영',company:'',occupation:'가상 직종',loginId:'bulk_risk',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    store.setWorkerPermissions(site.id,worker.id,['risk']);
    const original=[{task:'가상 A',selected:true,existingMeasures:'기존 A',additionalMeasures:'추가 A'},{task:'가상 B',selected:false,existingMeasures:'기존 B',additionalMeasures:'추가 B'}],base={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-01'},input=items=>({...base,details:{items}}),doc=role==='관리자'?store.createDocument(input(original)):store.createWorkerDocument(site.id,worker.id,input(original));
    const submitted=role==='관리자'?store.transition(doc.id,'submit'):store.transitionWorkerDocument(site.id,worker.id,doc.id,'submit');
    if(role==='관리자')store.transition(doc.id,'withdraw');else store.transitionWorkerDocument(site.id,worker.id,doc.id,'withdraw');
    const update=items=>role==='관리자'?store.updateDocument(doc.id,input(items)):store.updateWorkerDocument(site.id,worker.id,doc.id,input(items));
    const nodes=Object.fromEntries(['select-all','unselect-all','delete-selected','delete-all','clear-existing','clear-additional'].map(key=>[`[data-risk-${key}]`,{}])),list={children:[],dispatchEvent(){}};
    for(const value of original){const selected={checked:value.selected},existing={value:value.existingMeasures},additional={value:value.additionalMeasures},row={task:value.task,selected,existing,additional,querySelector:selector=>selector==='[data-risk-selected]'?selected:selector.includes('existingMeasures')?existing:selector.includes('additionalMeasures')?additional:null,remove(){list.children.splice(list.children.indexOf(row),1);}};list.children.push(row);}
    mountRiskBulk({querySelector:key=>nodes[key]},{list,active:()=>true});nodes['[data-risk-clear-existing]'].onclick();nodes['[data-risk-delete-selected]'].onclick();
    update(list.children.map(row=>({task:row.task,selected:row.selected.checked,existingMeasures:row.existing.value,additionalMeasures:row.additional.value})));
    const current=JSON.parse(store.document(doc.id).details).items;assert.equal(current.length,1);assert.equal(current[0].task,'가상 B');assert.equal(current[0].existingMeasures,'');assert.equal(current[0].additionalMeasures,'추가 B');
    nodes['[data-risk-delete-all]'].onclick();update([]);assert.deepEqual(JSON.parse(store.document(doc.id).details).items,[]);
    assert.deepEqual(JSON.parse(store.approvalCycle(doc.id,submitted.approval_cycle_id).document.details).items.map(row=>[row.task,row.existingMeasures]),[['가상 A','기존 A'],['가상 B','기존 B']]);
  }finally{store.close();if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;}
});
