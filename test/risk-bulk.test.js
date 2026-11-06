import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRiskBulk} from '../public/musculoskeletal.js';

test('일반 위험요인 일괄 선택과 삭제는 입력·확인·편집 상태를 지킨다',()=>{
  const previous=globalThis.confirm;let approve=false,live=true,events=0;globalThis.confirm=()=>approve;
  try{
    const nodes=Object.fromEntries(['select-all','unselect-all','delete-selected','delete-all'].map(key=>[`[data-risk-${key}]`,{}]));
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
