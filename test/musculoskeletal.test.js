import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { copyMusculoskeletalItems } from '../public/risk-scale.js';

test('근골격계 시험 항목은 별도로 검증하고 현장과 결재 당시 값을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),company=s.createCompany({siteId:site.id,name:'가상 업체',trade:'가상 공종'}),foreign=s.createCompany({siteId:other.id,name:'다른 업체',trade:'가상 공종'});
    const row={processName:'가상 공정',contractorId:company.id,task:'가상 작업',hazard:'반복 작업',existingMeasures:'가상 조치',additionalMeasures:'추가 조치',grade:'',likelihood:'2',severity:'3',score:999,selected:true};
    const input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{scale:'3x3',items:[{task:'일반 항목'}],musculoskeletalItems:[row,{...row,hazard:'다른 요인',selected:false}]}};
    const doc=s.createDocument(input),saved=JSON.parse(doc.details);assert.equal(saved.items[0].task,'일반 항목');assert.equal(saved.musculoskeletalItems[0].contractor,'가상 업체');assert.equal(saved.musculoskeletalItems[0].score,6);assert.equal(saved.musculoskeletalItems[1].selected,false);
    assert.throws(()=>s.createDocument({...input,details:{...input.details,musculoskeletalItems:[{...row,contractorId:foreign.id}]}}),/현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'3x3',items:input.details.items}}),/근골격계/);
    for(const bad of [{...row,likelihood:'5'},{...row,selected:'true'},{...row,hazard:'x'.repeat(2001)}])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,musculoskeletalItems:[bad]}}));
    assert.equal(JSON.parse(s.document(doc.id).details).musculoskeletalItems.length,2);
    const reversed={...input,details:{...input.details,musculoskeletalItems:[input.details.musculoskeletalItems[1],row]}};s.updateDocument(doc.id,reversed);assert.equal(JSON.parse(s.document(doc.id).details).musculoskeletalItems[0].hazard,'다른 요인');
    const submitted=s.transition(doc.id,'submit'),cycle=submitted.approval_cycle_id;s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,details:{...input.details,musculoskeletalItems:[]}});
    assert.deepEqual(JSON.parse(s.document(doc.id).details).musculoskeletalItems,[]);assert.equal(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).musculoskeletalItems[0].hazard,'다른 요인');
  }finally{s.close();}
});

test('근로자 시험 권한도 근골격계 항목을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'muscle_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    s.setWorkerPermissions(site.id,worker.id,['risk']);const input={type:'risk',title:'가상 평가',date:'2026-10-29',details:{scale:'5x4',items:[],musculoskeletalItems:[{task:'시험 작업',hazard:'가상 부담',likelihood:'5',severity:'4',selected:true}]}};
    const doc=s.createWorkerDocument(site.id,worker.id,input);assert.equal(JSON.parse(doc.details).musculoskeletalItems[0].score,20);
    assert.throws(()=>s.updateWorkerDocument(site.id,worker.id,doc.id,{...input,details:{scale:'5x4',items:[]}}),/근골격계/);
    s.updateWorkerDocument(site.id,worker.id,doc.id,{...input,details:{...input.details,musculoskeletalItems:[{...input.details.musculoskeletalItems[0],selected:false}]}});assert.equal(JSON.parse(s.workerDocument(site.id,worker.id,doc.id).details).musculoskeletalItems[0].selected,false);
  }finally{s.close();}
});

test('이전 근골격계 항목 복사는 개수와 척도를 확인하고 기존 자료를 보존한다',()=>{
  const source=[{processName:'가상 공정',contractor:'가상 업체',contractorId:1,task:'작업',hazard:'부담',likelihood:'2',severity:'3',selected:false,score:999},{task:'다른 작업',selected:true}];
  const copied=copyMusculoskeletalItems(source,98,'3x3');assert.equal(copied[0].selected,false);assert.equal(copied[0].contractorId,1);assert.equal(Object.hasOwn(copied[0],'score'),false);copied[0].task='복사 수정';assert.equal(source[0].task,'작업');
  assert.throws(()=>copyMusculoskeletalItems(source,99,'3x3'),/100개/);assert.throws(()=>copyMusculoskeletalItems([{...source[0],likelihood:'5'}],0,'3x3'),/확인/);assert.throws(()=>copyMusculoskeletalItems([{...source[0],selected:'true'}],0,'3x3'),/확인/);
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),company=s.createCompany({siteId:a.id,name:'가상 업체',trade:'가상 공종'}),items=source.map(row=>({...row,contractorId:company.id})),input={siteId:a.id,type:'risk',title:'가상 평가',date:'2026-10-28',details:{kind:'regular',scale:'3x3',items:[],musculoskeletalItems:items}},old=s.createDocument(input),outside=s.createDocument({...input,siteId:b.id,details:{...input.details,musculoskeletalItems:[]}});
    s.transition(old.id,'submit');s.transition(outside.id,'submit');const found=s.previousRiskAssessments(a.id,'2026-10-29','regular','3x3',0);assert.deepEqual(found.map(row=>row.id),[old.id]);
    const previous=JSON.parse(found[0].details).musculoskeletalItems,target=s.createDocument({...input,title:'새 평가',date:'2026-10-29',details:{...input.details,musculoskeletalItems:[{task:'기존 입력',selected:true}]}}),extra=copyMusculoskeletalItems(previous,1,'3x3');
    s.updateDocument(target.id,{...input,title:'새 평가',date:'2026-10-29',details:{...input.details,musculoskeletalItems:[{task:'기존 입력',selected:true},...extra]}});
    const saved=JSON.parse(s.document(target.id).details).musculoskeletalItems;assert.deepEqual(saved.map(row=>row.task),['기존 입력','작업','다른 작업']);assert.equal(saved[1].score,6);assert.equal(saved[1].selected,false);assert.equal(JSON.parse(s.document(old.id).details).musculoskeletalItems[0].task,'작업');
  }finally{s.close();}
});
