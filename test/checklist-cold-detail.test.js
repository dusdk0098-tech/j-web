import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { checklistSources, checklistCategoryForKind } from '../public/checklist-copy.js';

test('상세 저온기 점검은 기존 답변과 분리되고 필수 답변을 확인한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),answers=Array.from({length:10},()=>({answer:'O',note:''}));
    const base={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29'};
    const old=store.createDocument({...base,details:{kind:'cold',answers}});
    const current=store.createDocument({...base,details:{kind:'cold_detail',answers:answers.map((a,i)=>({...a,answer:i===8?'':a.answer}))}});
    assert.throws(()=>store.transition(current.id,'submit'),/필수/);
    answers[8].answer='해당없음';store.updateDocument(current.id,{...base,details:{kind:'cold_detail',answers}});
    assert.equal(store.transition(current.id,'submit').status,'pending');
    const oldDoc=store.document(old.id),newDoc=store.document(current.id);
    assert.equal(JSON.parse(oldDoc.details).kind,'cold');assert.equal(JSON.parse(newDoc.details).kind,'cold_detail');
    assert.equal(checklistCategoryForKind('cold_detail'),'weather');
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'cold_detail','2026-10-30').map(row=>row.id),[current.id]);
    assert.deepEqual(checklistSources([oldDoc,newDoc],site.id,'cold','2026-10-30').map(row=>row.id),[old.id]);
  }finally{store.close();}
});
