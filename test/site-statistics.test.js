import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSiteAttendance } from '../public/site-statistics.js';
import { Store } from '../store.js';

test('현장별 출역은 협력업체 근로자와 기존 외주를 함께 집계한다',()=>{
  const rows=[{id:1,name:'가상 A',categories:[{label:'직영',days:2},{label:'협력업체 근로자',days:3},{label:'협력업체 관리자',days:2}]},{id:2,name:'가상 B',categories:[{label:'외주',days:4},{label:'협력업체 근로자',days:1}]},{id:3,name:'빈 현장',categories:[]}];
  const result=summarizeSiteAttendance(rows);
  assert.deepEqual(result.sites.map(({direct,external,other,total})=>({direct,external,other,total})),[{direct:2,external:3,other:[{label:'협력업체 관리자',days:2}],total:7},{direct:0,external:5,other:[],total:5},{direct:0,external:0,other:[],total:0}]);
  assert.deepEqual(result.totals,{direct:2,external:8,other:[{label:'협력업체 관리자',days:2}],total:12});
  assert.deepEqual(summarizeSiteAttendance([]),{sites:[],totals:{direct:0,external:0,other:[],total:0}});
});

test('실제 가상 출역 기록에서 협력업체 근로자를 외주 인일로 집계한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'협력업체 근로자',company:'가상 업체',occupation:'가상 직종'}),manager=store.createWorker({siteId:site.id,name:'가상 관리자',category:'협력업체 관리자',company:'가상 업체',occupation:'가상 직종'}),outside=store.createWorker({siteId:other.id,name:'다른 현장 근로자',category:'협력업체 근로자',company:'가상 업체',occupation:'가상 직종'});
    for(const [siteId,person,date] of [[site.id,worker,'2026-10-01'],[site.id,worker,'2026-10-02'],[site.id,manager,'2026-10-01'],[other.id,outside,'2026-10-01']])store.setAttendance({siteId,workerId:person.id,date,present:true});
    const result=summarizeSiteAttendance(store.attendanceSitesReport('2026-10-01','2026-10-02')),first=result.sites.find(row=>row.id===site.id),second=result.sites.find(row=>row.id===other.id);assert.equal(first.external,2);assert.equal(first.total,3);assert.deepEqual(first.other,[{label:'협력업체 관리자',days:1}]);assert.equal(second.external,1);assert.equal(result.totals.external,3);assert.equal(result.totals.total,4);
  }finally{store.close();}
});

test('최초 출역은 동명이인을 구분하고 결근을 제외하며 당시 근로 구분으로 집계한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),make=(siteId,category)=>store.createWorker({siteId,name:'같은 가상 이름',category,company:'가상 업체',occupation:'가상 직종'}),one=make(site.id,'직영'),two=make(site.id,'외주'),three=make(other.id,'직영');
    for(const [siteId,person,date,present] of [[site.id,one,'2026-09-30',false],[site.id,one,'2026-10-02',true],[site.id,one,'2026-10-03',true],[site.id,two,'2026-10-03',true],[other.id,three,'2026-10-03',true]])store.setAttendance({siteId,workerId:person.id,date,present});
    const report=(from,to)=>store.attendanceSitesReport(from,to).find(row=>row.id===site.id),monthly=report('2026-10-01','2026-10-31');assert.deepEqual(monthly.firstCategories,[{label:'외주',days:1},{label:'직영',days:1}]);assert.deepEqual(monthly.categories,[{label:'외주',days:1},{label:'직영',days:2}]);
    assert.deepEqual(report('2026-10-03','2026-10-03').firstCategories,[{label:'외주',days:1}]);assert.deepEqual(store.attendanceSitesReport('2026-10-03','2026-10-03').find(row=>row.id===other.id).firstCategories,[{label:'직영',days:1}]);
    store.setAttendance({siteId:site.id,workerId:one.id,date:'2026-10-01',present:true});assert.deepEqual(report('2026-10-02','2026-10-03').firstCategories,[{label:'외주',days:1}]);store.setAttendance({siteId:site.id,workerId:one.id,date:'2026-10-01',present:false});assert.deepEqual(report('2026-10-02','2026-10-03').firstCategories,[{label:'외주',days:1},{label:'직영',days:1}]);
  }finally{store.close();}
});
