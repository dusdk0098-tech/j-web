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
