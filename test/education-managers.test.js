import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {execFileSync} from 'node:child_process';
import {hasManagerEducationTargets} from '../public/education-kinds.js';

const details={kind:'supervisor_new',timeFrom:'09:00',timeTo:'10:00',educationPlace:'가상 교실',educationMethod:'강의식',instructor:'가상 강사',textbook:'가상 교재'};
function setup(path=':memory:'){
  const s=new Store(path),site=s.createSite({name:'가상 A'}),other=s.createSite({name:'가상 B'});
  const worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
  const make=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:'가상 '+loginId,password:'virtual-password-123'});
  const manager=make(site.id,'manager_a'),peer=make(site.id,'manager_b'),foreign=make(other.id,'manager_c');
  const doc=s.createDocument({siteId:site.id,type:'education',title:'가상 관리자 교육',date:'2026-11-01',details});
  return {s,site,other,worker,manager,peer,foreign,doc};
}

test('신규 교육과 관리자 대상은 함께 저장되고 유효하지 않으면 함께 취소된다',()=>{
  const {s,site,manager,peer,foreign}=setup();try{
    const input={siteId:site.id,type:'education',title:'가상 신규 교육',date:'2026-11-01',details},before=s.documents(site.id).length;
    s.updateReviewer(peer.site_id,peer.id,{active:false});
    for(const ids of [[foreign.id],[peer.id],[manager.id,manager.id],['1'],null]){assert.throws(()=>s.createAuthorizedDocument({...input,educationManagerIds:ids}));assert.equal(s.documents(site.id).length,before);}
    assert.throws(()=>s.createAuthorizedDocument({...input,details:{kind:'regular'},educationManagerIds:[manager.id]}),/종류/);assert.equal(s.documents(site.id).length,before);
    assert.throws(()=>s.createAuthorizedDocument({...input,educationManagerIds:[manager.id]},()=>{throw Error('권한 회수');}),/권한 회수/);assert.equal(s.documents(site.id).length,before);
    s.db.exec("CREATE TRIGGER fail_draft_target BEFORE INSERT ON training_manager_targets BEGIN SELECT RAISE(ABORT,'시험 저장 실패'); END");assert.throws(()=>s.createAuthorizedDocument({...input,educationManagerIds:[manager.id]}),/시험 저장 실패/);assert.equal(s.documents(site.id).length,before);s.db.exec('DROP TRIGGER fail_draft_target');
    const doc=s.createAuthorizedDocument({...input,educationManagerIds:[manager.id]});assert.equal(s.document(doc.id).edit_version,doc.edit_version);assert.deepEqual(s.trainingTargets(doc.id).managers.filter(row=>row.selected).map(row=>row.id),[manager.id]);assert.equal(s.trainingTargets(doc.id).configured,false);
  }finally{s.close();}
});

test('신규 교육의 근로자 명단은 관리자 명단과 함께 저장되고 오류 시 취소된다',()=>{
  const {s,site,other,worker,manager}=setup();try{
    const foreign=s.createWorker({siteId:other.id,name:'다른 현장',category:'직영',company:'가상',occupation:'목공'}),input={siteId:site.id,type:'education',title:'가상 교육',date:'2026-11-01',details,educationManagerIds:[manager.id]},before=s.documents(site.id).length;
    for(const ids of [[foreign.id],[worker.id,worker.id],['1'],null]){assert.throws(()=>s.createAuthorizedDocument({...input,educationWorkerIds:ids}));assert.equal(s.documents(site.id).length,before);}
    const selected=s.createAuthorizedDocument({...input,educationWorkerIds:[worker.id]}),targets=s.trainingTargets(selected.id);assert.equal(targets.configured,true);assert.deepEqual(targets.workers.filter(row=>row.selected).map(row=>row.id),[worker.id]);assert.equal(targets.managers.find(row=>row.id===manager.id).selected,1);assert.equal(selected.edit_version,s.document(selected.id).edit_version);
    const empty=s.createAuthorizedDocument({...input,educationWorkerIds:[]});assert.equal(s.trainingTargets(empty.id).configured,true);assert.equal(s.trainingTargets(empty.id).workers.filter(row=>row.selected).length,0);
    const all=s.createAuthorizedDocument(input);assert.equal(s.trainingTargets(all.id).configured,false);
  }finally{s.close();}
});

test('관리자 명부는 교육 종류에 따라 표시되며 근로자 교육과 TBM에는 표시되지 않는다',()=>{
  for(const kind of ['supervisor','supervisor_new','supervisor_regular','supervisor_special','supervisor_changed','msds','other'])assert.equal(hasManagerEducationTargets({type:'education',details:JSON.stringify({kind})}),true);
  for(const kind of ['new','regular','risk','special','changed',''])assert.equal(hasManagerEducationTargets({type:'education',details:JSON.stringify({kind})}),false);
  assert.equal(hasManagerEducationTargets({type:'tbm',details:JSON.stringify(details)}),false);
});

test('직원 대상과 근로자 대상은 별개이며 동일 현장 활성 계정만 원자적으로 저장한다',()=>{
  const {s,worker,manager,peer,foreign,doc}=setup();try{
    const original=s.trainingStateVersion(doc.id),before=s.document(doc.id).edit_version;
    s.setTrainingTargets(doc.id,[worker.id],()=>{},[manager.id]);
    assert.notEqual(s.trainingStateVersion(doc.id),original);assert.ok(s.document(doc.id).edit_version>before);
    assert.deepEqual(s.trainingTargets(doc.id).managers.filter(p=>p.selected).map(p=>p.id),[manager.id]);
    assert.deepEqual(s.trainingTargets(doc.id).workers.filter(p=>p.selected).map(p=>p.id),[worker.id]);
    s.updateReviewer(peer.site_id,peer.id,{active:false});
    for(const ids of [[foreign.id],[peer.id],[manager.id,manager.id],['1'],[-1],null]){
      const current=s.trainingStateVersion(doc.id);assert.throws(()=>s.setTrainingTargets(doc.id,[],()=>{},ids));assert.equal(s.trainingStateVersion(doc.id),current);
    }
    s.setTrainingTargets(doc.id,[]);assert.equal(s.trainingTargets(doc.id).managers.find(p=>p.id===manager.id).selected,1);
    assert.throws(()=>s.setTrainingTargets(doc.id,[worker.id],()=>{throw Error('권한 회수');},[]),/권한 회수/);assert.equal(s.trainingTargets(doc.id).managers.find(p=>p.id===manager.id).selected,1);
    const regular=s.createDocument({siteId:doc.site_id,type:'education',title:'가상 근로자 교육',date:doc.date,details:{...details,kind:'regular'}});
    assert.throws(()=>s.setTrainingTargets(regular.id,[],()=>{},[manager.id]),/종류/);
  }finally{s.close();}
});

test('관리자만 변경하면 근로자 기본 전체·명시적 빈 명단·기존 선택을 그대로 보존한다',()=>{
  const {s,site,worker,manager,doc}=setup();try{
    s.setTrainingTargets(doc.id,undefined,()=>{},[manager.id]);assert.equal(s.trainingTargets(doc.id).configured,false);
    const added=s.createWorker({siteId:site.id,name:'나중 가입한 가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');assert.ok(s.workerTraining(added.id,doc.date).some(row=>row.id===doc.id));
    for(const ids of [[],[worker.id]]){
      const next=s.createDocument({siteId:site.id,type:'education',title:'가상 교육',date:doc.date,details});s.setTrainingTargets(next.id,ids);s.setTrainingTargets(next.id,undefined,()=>{},[manager.id]);
      const targets=s.trainingTargets(next.id);assert.equal(targets.configured,true);assert.deepEqual(targets.workers.filter(row=>row.selected).map(row=>row.id),ids);
    }
    assert.throws(()=>s.setTrainingTargets(doc.id,undefined),/교육 대상자/);
  }finally{s.close();}
});

test('선정 직원은 승인 교육과 그 첨부만 조회하며 다른 현장·비활성·미선정·임시 문서는 차단한다',()=>{
  const {s,manager,peer,foreign,doc}=setup();try{
    s.setTrainingTargets(doc.id,[],()=>{},[manager.id]);
    assert.deepEqual(s.reviewerEducation(manager.id),[]);assert.equal(s.reviewerEducation(manager.id,doc.id),null);
    assert.deepEqual(s.managerEducationAssignments(manager.site_id,'2026-11-01','2026-11-30'),[]);
    const file=s.addAttachment(doc.id,'가상.txt',Buffer.from('virtual'));
    s.transition(doc.id,'submit');const cycle=s.approvalCycle(doc.id,s.document(doc.id).approval_cycle_id);
    assert.deepEqual(cycle.linked.managers,[{id:manager.id,name:manager.name}]);
    s.transition(doc.id,'approve');assert.equal(s.reviewerEducation(manager.id,doc.id).document.id,doc.id);
    assert.deepEqual(s.managerEducationAssignments(manager.site_id,'2026-11-01','2026-11-30').map(row=>[row.id,row.document_id,row.kind]),[[manager.id,doc.id,'supervisor_new']]);
    assert.throws(()=>s.managerEducationAssignments(manager.site_id,'2026-11-30','2026-11-01'),/시작일/);
    assert.equal(Buffer.from(s.reviewerEducationAttachment(manager.id,doc.id,file).data).toString(),'virtual');
    for(const person of [peer,foreign]){assert.deepEqual(s.reviewerEducation(person.id),[]);assert.equal(s.reviewerEducation(person.id,doc.id),null);assert.equal(s.reviewerEducationAttachment(person.id,doc.id,file),null);}
    assert.equal(s.reviewerEducationAttachment(manager.id,doc.id,file+999),null);
    assert.throws(()=>s.setTrainingTargets(doc.id,[],()=>{},[]),/수정 가능한/);
    s.updateReviewer(manager.site_id,manager.id,{active:false});assert.deepEqual(s.reviewerEducation(manager.id),[]);assert.equal(s.reviewerEducationAttachment(manager.id,doc.id,file),null);
    s.updateReviewer(manager.site_id,manager.id,{active:true});s.db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(foreign.site_id,manager.id);assert.equal(s.reviewerEducationAttachment(manager.id,doc.id,file),null);
    s.db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(manager.site_id,manager.id);
    s.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({...details,kind:'regular'}),doc.id);assert.equal(s.reviewerEducation(manager.id,doc.id),null);assert.equal(s.reviewerEducationAttachment(manager.id,doc.id,file),null);assert.deepEqual(s.trainingTargets(doc.id).managers,[]);
    s.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify(details),doc.id);assert.equal(s.trainingTargets(doc.id).managers.find(p=>p.id===manager.id).selected,1);
    s.db.prepare('UPDATE reviewers SET name=? WHERE id=?').run('변경된 가상 이름',manager.id);
    assert.deepEqual(s.approvalCycle(doc.id,cycle.id).linked.managers,[{id:manager.id,name:manager.name}]);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM worker_training_checks').get().n,0);
  }finally{s.close();}
});

test('선정 뒤 비활성화된 직원은 승인 요청을 막으며 기존 근로자·관리자 대상은 보존한다',()=>{
  const {s,worker,manager,doc}=setup();try{
    s.setTrainingTargets(doc.id,[worker.id],()=>{},[manager.id]);s.updateReviewer(manager.site_id,manager.id,{active:false});
    assert.throws(()=>s.transition(doc.id,'submit'),/관리자 교육 대상/);assert.equal(s.document(doc.id).status,'draft');
    assert.equal(s.trainingTargets(doc.id).managers.find(p=>p.id===manager.id).selected,1);
    s.setTrainingTargets(doc.id,[worker.id],()=>{},[]);assert.equal(s.transition(doc.id,'submit').status,'pending');
  }finally{s.close();}
});

test('관리자 대상은 SQLite 재개방·백업 복원에서 근로자 대상 및 기존 자료와 함께 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-manager-targets-')),path=join(dir,'source.sqlite');let data=setup(path),s=data.s;
  try{
    s.setTrainingTargets(data.doc.id,[data.worker.id],()=>{},[data.manager.id]);s.close();s=new Store(path);
    assert.equal(s.trainingTargets(data.doc.id).managers.find(p=>p.id===data.manager.id).selected,1);
    execFileSync(process.execPath,['db-copy.js','restore',path,dir],{env:{...process.env}});s.close();s=new Store(join(dir,'jweb.sqlite'));
    assert.equal(s.trainingTargets(data.doc.id).workers.find(p=>p.id===data.worker.id).selected,1);
    assert.equal(s.trainingTargets(data.doc.id).managers.find(p=>p.id===data.manager.id).selected,1);
    assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
