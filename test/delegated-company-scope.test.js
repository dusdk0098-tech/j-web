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

test('협력업체 관리자의 문서 작성 선택 목록은 자기 업체 출입자만 표시한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),a=s.createCompany({siteId:site.id,name:'같은 업체',trade:'A'}),b=s.createCompany({siteId:site.id,name:'같은 업체',trade:'B'}),token=s.createInvitation(site.id).token,base={siteId:site.id,company:a.name,occupation:'가상 직종'},join=(name,id,companyId,category)=>s.join(token,{...base,name,category,companyId,loginId:id,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
  const manager=join('관리자','manager_scope',a.id,'협력업체 관리자'),same=join('동일 업체','same_scope',a.id,'협력업체 근로자'),other=join('다른 업체','other_scope',b.id,'협력업체 근로자');s.setWorkerPermissions(site.id,manager.id,['risk','work_plan']);
  for(const type of ['risk','work_plan']){const result=s.workerDocumentOptions(site.id,manager.id,type),workers=type==='risk'?result.riskPeople.filter(person=>person.kind==='worker'):result.workers;assert.deepEqual(new Set(workers.map(person=>person.id)),new Set([manager.id,same.id]));assert.ok(!workers.some(person=>person.id===other.id));}
  s.updateWorker(manager.id,{...base,name:manager.name,category:manager.category,companyId:0});assert.equal(s.workerDocumentOptions(site.id,manager.id,'work_plan').workers.length,0);assert.equal(s.workerDocumentOptions(site.id,manager.id,'risk').riskPeople.filter(person=>person.kind==='worker').length,0);
 }finally{s.close();}
});

test('협력업체 교육 대상 변경은 다른 업체의 명시·기본 대상을 보존한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),a=s.createCompany({siteId:site.id,name:'가상 A',trade:'A'}),b=s.createCompany({siteId:site.id,name:'가상 B',trade:'B'}),token=s.createInvitation(site.id).token,base={siteId:site.id,company:a.name,occupation:'가상 직종'},manager=s.join(token,{...base,companyId:a.id,name:'관리자',category:'협력업체 관리자',loginId:'scope_training',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),same=s.createWorker({...base,companyId:a.id,name:'같은 업체',category:'협력업체 근로자'}),other=s.createWorker({...base,companyId:b.id,name:'다른 업체',category:'협력업체 근로자'});
  s.setWorkerPermissions(site.id,manager.id,['training']);const doc=s.createWorkerDocument(site.id,manager.id,{type:'education',title:'가상 교육',date:'2026-11-01',details:{kind:'regular'}}),selected=()=>s.trainingTargets(doc.id).workers.filter(row=>row.selected).map(row=>row.id).sort((x,y)=>x-y);
  assert.throws(()=>s.setTrainingTargets(doc.id,[other.id],()=>{},undefined,manager.id),/같은 업체/);assert.equal(s.trainingTargets(doc.id).configured,false);
  s.setTrainingTargets(doc.id,[same.id],()=>{},undefined,manager.id);assert.deepEqual(selected(),[same.id,other.id].sort((x,y)=>x-y));
  s.setTrainingTargets(doc.id,[manager.id],()=>{},undefined,manager.id);assert.deepEqual(selected(),[manager.id,other.id].sort((x,y)=>x-y));
  s.updateWorker(manager.id,{...base,name:manager.name,category:manager.category,companyId:0});assert.throws(()=>s.setTrainingTargets(doc.id,[same.id],()=>{},undefined,manager.id),/같은 업체/);assert.deepEqual(selected(),[manager.id,other.id].sort((x,y)=>x-y));
 }finally{s.close();}
});
