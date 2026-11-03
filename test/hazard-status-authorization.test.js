import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('위험신고 처리 변경은 저장 잠금 뒤 권한을 확인하고 거절 시 기존 값을 보존한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),id=store.createHazardReport(site.id,{title:'가상 신고',body:'가상 내용',reporter:'가상 신고자'}),change={status:'resolved',response:'가상 조치'};
    assert.throws(()=>store.updateHazardReport(site.id,id,change,()=>{throw Error('가상 권한 만료');}),/권한 만료/);
    assert.equal(store.hazardReports(site.id)[0].status,'received');assert.equal(store.hazardReports(site.id)[0].response,'');
    assert.throws(()=>store.updateHazardReport(other.id,id,change),/현장/);
    store.updateHazardReport(site.id,id,change);assert.equal(store.hazardReports(site.id)[0].response,'가상 조치');
  }finally{store.close();}
});
