import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { planChartsMarkup } from '../public/plan-charts.js';

test('추가 계획도는 현장과 내용을 확인하고 복사와 이전 화면 저장에서 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'',obstacles:'',protection:''};
    const first=s.createWorkPlace({siteId:site.id,name:'첫 장소',work:area,route:area}),second=s.createWorkPlace({siteId:site.id,name:'둘째 장소',work:area,route:area}),foreign=s.createWorkPlace({siteId:other.id,name:'다른 장소',work:area,route:area});
    const chart=id=>({workPlaceId:id,routeDescription:'가상 경로',workSequence:'가상 순서',managementPoints:'가상 관리'}),input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{additionalCharts:[chart(first.id),chart(second.id)]}},doc=s.createDocument(input);
    assert.deepEqual(JSON.parse(doc.details).additionalCharts.map(row=>row.placeName),['첫 장소','둘째 장소']);
    const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'복사',date:'2026-11-05'});assert.equal(JSON.parse(copy.details).additionalCharts.length,2);
    s.updateDocument(doc.id,{...input,details:{}});assert.equal(JSON.parse(s.document(doc.id).details).additionalCharts.length,2);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{additionalCharts:[chart(foreign.id)]}}),/같은 현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{additionalCharts:[{...chart(first.id),managementPoints:'가'.repeat(4001)}]}}),/계획도/);
    assert.throws(()=>s.createWorkPlace({siteId:site.id,name:'수정',work:area,route:area,expected:{name:first.name,details:first.details}},first.id),/계획서/);
    s.updateDocument(doc.id,{...input,details:{additionalCharts:[]}});assert.deepEqual(JSON.parse(s.document(doc.id).details).additionalCharts,[]);
    const html=planChartsMarkup([{placeName:'<장소>',...chart(first.id)}],value=>String(value).replaceAll('<','&lt;'));assert.match(html,/&lt;장소>/);assert.match(html,/가상 경로/);
  } finally {s.close();}
});

test('계획도별 이미지는 같은 문서에서 선택하고 복사할 때 새 파일로 연결한다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'',obstacles:'',protection:''},place=s.createWorkPlace({siteId:site.id,name:'가상 장소',work:area,route:area});
    const chart={workPlaceId:place.id,routeDescription:'경로',workSequence:'순서',managementPoints:'관리',imageIds:[]},input={siteId:site.id,type:'work_plan',title:'계획',date:'2026-11-04',details:{additionalCharts:[chart]}},doc=s.createDocument(input),other=s.createDocument({...input,title:'다른 계획'});
    const image=s.addAttachment(doc.id,'가상.png',Buffer.from('89504e470d0a1a0a00','hex'),'plan_diagram'),foreign=s.addAttachment(other.id,'다른.png',Buffer.from('89504e470d0a1a0a00','hex'),'plan_diagram'),general=s.addAttachment(doc.id,'일반.txt',Buffer.from('abc'),'general');
    const withImages=ids=>({...input,details:{additionalCharts:[{...chart,imageIds:ids}]}});
    for(const bad of [[foreign],[general],[image,image],Array(6).fill(image)])assert.throws(()=>s.updateDocument(doc.id,withImages(bad)),/이미지/);
    s.updateDocument(doc.id,withImages([image]));assert.throws(()=>s.deleteAttachment(image),/연결을 해제/);
    const old={...chart};delete old.imageIds;assert.throws(()=>s.updateDocument(doc.id,{...input,details:{additionalCharts:[old]}}),/보존/);
    const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'복사',date:'2026-11-05'}),newId=JSON.parse(copy.details).additionalCharts[0].imageIds[0];assert.notEqual(newId,image);assert.equal(s.attachment(newId).document_id,copy.id);assert.deepEqual(Buffer.from(s.attachment(newId).data),Buffer.from(s.attachment(image).data));
    s.updateDocument(doc.id,withImages([]));s.deleteAttachment(image);assert.equal(s.attachment(image),undefined);
  }finally{s.close();}
});
