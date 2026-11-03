import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('순회 점검자는 저장·수정·결재 사본에 보존되고 잘못된 입력은 거절된다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'patrol',title:'가상 점검',date:'2026-11-03',details:{inspector:' 가상 점검자 ',items:[]}},doc=store.createDocument(input);
    assert.equal(JSON.parse(doc.details).inspector,'가상 점검자');
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{inspector:'가'.repeat(201),items:[]}}),/점검자/);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{inspector:42,items:[]}}),/점검자/);
    store.updateDocument(doc.id,{...input,details:{items:[]}});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'가상 점검자');
    store.updateDocument(doc.id,{...input,details:null});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'가상 점검자');
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;
    store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{inspector:'다른 점검자',items:[]}});
    assert.equal(JSON.parse(store.document(doc.id).details).inspector,'다른 점검자');
    assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).inspector,'가상 점검자');
    store.updateDocument(doc.id,{...input,details:{inspector:'',items:[]}});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'');
    const legacy=store.createDocument({...input,details:{items:[]}});assert.equal(JSON.parse(legacy.details).inspector,'');
  }finally{store.close();}
});
