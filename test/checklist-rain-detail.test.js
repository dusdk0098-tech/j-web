import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { checklistSources, checklistCategoryForKind } from '../public/checklist-copy.js';

test('상세 우천 점검은 기존 점검 답변과 구분하여 검증하고 저장한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}), answers=Array.from({length:7},()=>({answer:'O',note:''}));
    const base={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29'};
    const old=store.createDocument({...base,details:{kind:'rain',answers}});
    const current=store.createDocument({...base,details:{kind:'rain_detail',answers:answers.map((a,i)=>({...a,answer:i===0?'':a.answer}))}});
    assert.throws(()=>store.transition(current.id,'submit'),/필수/);
    assert.throws(()=>store.updateDocument(current.id,{...base,details:{kind:'rain_detail',answers:answers.map((a,i)=>i===1?{...a,answer:'해당없음'}:a)}}),/답변/);
    store.updateDocument(current.id,{...base,details:{kind:'rain_detail',answers}});
    assert.equal(store.transition(current.id,'submit').status,'pending');
    const oldDoc=store.document(old.id),newDoc=store.document(current.id);
    assert.equal(JSON.parse(oldDoc.details).kind,'rain');assert.equal(JSON.parse(newDoc.details).kind,'rain_detail');
    assert.equal(checklistCategoryForKind('rain_detail'),'weather');
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'rain_detail','2026-10-30').map(row=>row.id),[current.id]);
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'rain','2026-10-30').map(row=>row.id),[old.id]);
  }finally{store.close();}
});
