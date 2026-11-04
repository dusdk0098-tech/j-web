import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';

test('중량물 안전성 검토는 저장·복사·결재 시 보존되고 이전 화면의 누락을 거절한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),load={kind:'가상 중량물',size:'1m',totalWeight:'1t',liftWeight:'500kg',liftMode:'other',safetyReview:'가상 검토 내용'},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{heavyLoads:[load]}},doc=s.createDocument(input);
    assert.equal(JSON.parse(doc.details).heavyLoads[0].safetyReview,'가상 검토 내용');
    const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'가상 복사',date:'2026-11-05'});assert.equal(JSON.parse(copy.details).heavyLoads[0].safetyReview,'가상 검토 내용');
    const old={...load};delete old.safetyReview;assert.throws(()=>s.updateDocument(doc.id,{...input,details:{heavyLoads:[old]}}),/안전성 검토/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{heavyLoads:[{...load,safetyReview:'가'.repeat(4001)}]}}),/안전성 검토/);
    s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,details:{heavyLoads:[{...load,safetyReview:'수정된 검토'}]}});
    assert.equal(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).heavyLoads[0].safetyReview,'가상 검토 내용');
    assert.equal(JSON.parse(s.document(doc.id).details).heavyLoads[0].safetyReview,'수정된 검토');
  }finally{s.close();}
});
