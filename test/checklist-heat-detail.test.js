import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { checklistSources, checklistCategoryForKind } from '../public/checklist-copy.js';

test('상세 고온기 점검은 기존 답변을 섞지 않고 필수 항목을 검증한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}), answers=Array.from({length:8},()=>({answer:'O',note:''}));
    const base={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29'};
    const old=store.createDocument({...base,details:{kind:'heat',answers}});
    const current=store.createDocument({...base,details:{kind:'heat_detail',answers:answers.map((a,i)=>({...a,answer:i===1?'':a.answer}))}});
    assert.throws(()=>store.transition(current.id,'submit'),/필수/);
    assert.throws(()=>store.updateDocument(current.id,{...base,details:{kind:'heat_detail',answers:answers.map((a,i)=>i===1?{...a,answer:'해당없음'}:a)}}),/답변/);
    answers[2].answer='해당없음';store.updateDocument(current.id,{...base,details:{kind:'heat_detail',answers}});
    assert.equal(store.transition(current.id,'submit').status,'pending');
    const oldDoc=store.document(old.id),newDoc=store.document(current.id);
    assert.equal(JSON.parse(oldDoc.details).kind,'heat');assert.equal(JSON.parse(newDoc.details).kind,'heat_detail');
    assert.equal(checklistCategoryForKind('heat_detail'),'weather');
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'heat_detail','2026-10-30').map(row=>row.id),[current.id]);
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'heat','2026-10-30').map(row=>row.id),[old.id]);
  }finally{store.close();}
});
