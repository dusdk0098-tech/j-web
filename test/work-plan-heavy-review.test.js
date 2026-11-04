import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { heavyImageChoices,heavyImageMarkup } from '../public/rigging-standards.js';

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

test('중량물별 사진은 같은 문서에서 연결하고 복사와 결재 때 보존한다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),load={kind:'가상 물품',size:'1m',totalWeight:'1t',liftWeight:'500kg',liftMode:'other',safetyReview:'가상 검토',safetyImageIds:[]},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{heavyLoads:[load]}},doc=s.createDocument(input),other=s.createDocument({...input,title:'다른 계획'}),bytes=Buffer.from('89504e470d0a1a0a00','hex');
    const image=s.addAttachment(doc.id,'사진.png',bytes,'plan_diagram'),foreign=s.addAttachment(other.id,'다른.png',bytes,'plan_diagram'),general=s.addAttachment(doc.id,'일반.txt',Buffer.from('abc'),'general'),withImages=ids=>({...input,details:{heavyLoads:[{...load,safetyImageIds:ids}]}});
    const files=[{id:image,name:'가상 사진.png',category:'plan_diagram'},{id:general,name:'일반.txt',category:'general'}],escape=value=>String(value).replaceAll('&','&amp;');assert.match(heavyImageChoices(files,[image],escape),/checked/);assert.doesNotMatch(heavyImageChoices(files,[image],escape),/일반.txt/);
    const markup=heavyImageMarkup([{kind:'가상 물품',safetyImageIds:[image]}],files,escape,file=>'/review/'+file.id+'?preview=1&cycle=2');assert.match(markup,/preview=1&amp;cycle=2/);assert.match(markup,/가상 물품/);
    for(const ids of [[foreign],[general],[image,image],Array(6).fill(image)])assert.throws(()=>s.updateDocument(doc.id,withImages(ids)),/이미지|사진/);
    s.updateDocument(doc.id,withImages([image]));assert.throws(()=>s.deleteAttachment(image),/연결을 해제/);
    const old={...load};delete old.safetyImageIds;assert.throws(()=>s.updateDocument(doc.id,{...input,details:{heavyLoads:[old]}}),/사진/);
    const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'복사',date:'2026-11-05'}),copied=JSON.parse(copy.details).heavyLoads[0].safetyImageIds[0];assert.notEqual(copied,image);assert.equal(s.attachment(copied).document_id,copy.id);assert.deepEqual(Buffer.from(s.attachment(copied).data),bytes);
    s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'document',0,image).data),bytes);
    s.transition(doc.id,'withdraw');s.updateDocument(doc.id,withImages([]));s.deleteAttachment(image);assert.equal(s.attachment(image),undefined);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'document',0,image).data),bytes);
  }finally{s.close();}
});

test('중량물 줄걸이 규격과 체결장구는 같은 현장과 등록 규격을 확인한다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,category,name,standards)=>s.createRigging({siteId,category,kind:'가상 장구',name,standards,additional:[],spec:''}),rope=make(site.id,'줄걸이','가상 줄',['10mm']),fastening=make(site.id,'체결장구','가상 고리',['5t']),foreign=make(other.id,'체결장구','다른 고리',['5t']);
    const load={kind:'가상 물품',size:'1m',totalWeight:'1t',liftWeight:'500kg',liftMode:'rigging',riggingId:rope.id,lines:'2줄',method:'일자형',safetyReview:'가상 검토',ropeStandard:'10mm',fasteningId:fastening.id,fasteningStandard:'5t'},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{riggingIds:[rope.id,fastening.id],heavyLoads:[load]}},doc=s.createDocument(input),saved=JSON.parse(doc.details).heavyLoads[0];
    assert.equal(saved.ropeStandard,'10mm');assert.equal(saved.fasteningName,'가상 고리');assert.equal(saved.fasteningStandard,'5t');
    const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'복사',date:'2026-11-05'});assert.equal(JSON.parse(copy.details).heavyLoads[0].fasteningName,'가상 고리');
    for(const invalid of [{...load,ropeStandard:'미등록'},{...load,fasteningStandard:'미등록'},{...load,fasteningId:foreign.id},{...load,fasteningId:rope.id}])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,heavyLoads:[invalid]}}),/규격|체결장구/);
    const old={...load};delete old.fasteningId;assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,heavyLoads:[old]}}),/보존/);
  }finally{s.close();}
});
