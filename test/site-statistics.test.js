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
