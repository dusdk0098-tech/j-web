import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('협력업체 관리자의 위임 출역은 연결된 같은 업체만 허용한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),a=s.createCompany({siteId:site.id,name:'같은 업체명',trade:'A'}),b=s.createCompany({siteId:site.id,name:'같은 업체명',trade:'B'}),base={siteId:site.id,company:a.name,occupation:'가상 직종'},token=s.createInvitation(site.id).token;
  const manager=s.join(token,{...base,companyId:a.id,name:'가상 관리자',category:'협력업체 관리자',loginId:'test_manager',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),same=s.createWorker({...base,companyId:a.id,name:'같은 업체',category:'협력업체 근로자'}),other=s.createWorker({...base,companyId:b.id,name:'다른 업체',category:'협력업체 근로자'}),unlinked=s.createWorker({...base,name:'소속 미연결',category:'협력업체 근로자'}),date='2026-11-01';
  s.setWorkerPermissions(site.id,manager.id,['attendance']);const list=()=>s.delegatedAttendance(site.id,manager.id,date);assert.deepEqual(new Set(list().map(row=>row.id)),new Set([manager.id,same.id]));
  for(const worker of [other,unlinked])assert.throws(()=>s.setDelegatedAttendance(site.id,manager.id,{workerId:worker.id,date,present:true,expectedDayVersion:0}),/관리 가능한/);
  s.setDelegatedAttendance(site.id,manager.id,{workerId:same.id,date,present:true,expectedDayVersion:0});assert.equal(list().find(row=>row.id===same.id).present,1);
  s.updateWorker(manager.id,{...base,name:manager.name,category:manager.category,companyId:0});assert.deepEqual(list(),[]);assert.throws(()=>s.setDelegatedAttendance(site.id,manager.id,{workerId:same.id,date,present:false,expectedDayVersion:1}),/관리 가능한/);
 }finally{s.close();}
});
