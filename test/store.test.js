import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { jointExamples } from '../public/joint-examples.js';

test('가상 결재자는 현장과 순서에 따라 문서를 승인하고 우회 요청을 거절한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:loginId,password:'virtual-password-123'}),one=add(a.id,'reviewer_one'),two=add(a.id,'reviewer_two'),other=add(b.id,'reviewer_other');
    assert.equal(s.authenticateReviewer('reviewer_one','wrong'),null);assert.equal(s.authenticateReviewer('reviewer_one','virtual-password-123').id,one.id);assert.equal(s.authenticateReviewer('none','wrong'),null);
    const doc=s.createDocument({siteId:a.id,type:'tbm',title:'가상 문서',date:'2026-10-29'}),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    assert.throws(()=>s.setApprovalLine(doc.id,[one.id,other.id]),/현장/);assert.throws(()=>s.setApprovalLine(doc.id,[one.id,one.id]),/결재자/);
    s.setApprovalLine(doc.id,[one.id,two.id]);s.transition(doc.id,'submit');assert.throws(()=>s.setApprovalLine(doc.id,[]),/수정/);assert.throws(()=>s.approveDocument(doc.id,'',signature),/결재자/);assert.throws(()=>s.approveDocuments(a.id,[doc.id],signature),/결재자/);
    assert.deepEqual(s.reviewerDocuments(one.id).map(d=>d.id),[doc.id]);assert.deepEqual(s.reviewerDocuments(two.id),[]);assert.deepEqual(s.reviewerDocuments(other.id),[]);assert.throws(()=>s.reviewerTransition(doc.id,two.id,'approve','',signature),/결재자/);assert.throws(()=>s.reviewerTransition(doc.id,one.id,'approve','',''),/서명/);
    s.reviewerTransition(doc.id,one.id,'approve','첫 시험 검토',signature);assert.equal(s.document(doc.id).status,'pending');assert.deepEqual(s.reviewerDocuments(one.id),[]);assert.deepEqual(s.reviewerDocuments(two.id).map(d=>d.id),[doc.id]);assert.equal(s.events(doc.id).at(-1).reviewer_name,'reviewer_one');const firstEvent=s.events(doc.id).at(-1).id;assert.deepEqual(s.priorReviewerEvents(s.document(doc.id),two.id).map(e=>e.id),[firstEvent]);
    s.reviewerTransition(doc.id,two.id,'reject','시험 반려');assert.equal(s.document(doc.id).status,'rejected');s.transition(doc.id,'revise');s.transition(doc.id,'submit');assert.deepEqual(s.approvalLine(doc.id).map(x=>x.state),['pending','pending']);
    assert.deepEqual(s.priorReviewerEvents(s.document(doc.id),one.id),[]);s.reviewerTransition(doc.id,one.id,'approve','',signature);assert.deepEqual(s.priorReviewerEvents(s.document(doc.id),two.id).map(e=>e.id),[s.events(doc.id).at(-1).id]);assert.notEqual(s.priorReviewerEvents(s.document(doc.id),two.id)[0].id,firstEvent);s.reviewerTransition(doc.id,two.id,'approve','',signature);assert.equal(s.document(doc.id).status,'approved');assert.equal(s.events(doc.id).at(-1).reviewer_name,'reviewer_two');
    const waiting=s.createDocument({siteId:a.id,type:'tbm',title:'대기 문서',date:'2026-10-29'});s.setApprovalLine(waiting.id,[one.id,two.id]);s.transition(waiting.id,'submit');s.reviewerTransition(waiting.id,one.id,'approve','',signature);s.updateReviewer(a.id,two.id,{active:false});assert.deepEqual(s.reviewerDocuments(two.id),[]);assert.throws(()=>s.approveDocument(waiting.id,'',signature),/결재자/);assert.throws(()=>s.reviewerTransition(waiting.id,two.id,'approve','',signature),/결재자/);assert.equal(s.document(waiting.id).status,'pending');s.transition(waiting.id,'withdraw');s.setApprovalLine(waiting.id,[one.id]);s.transition(waiting.id,'submit');s.reviewerTransition(waiting.id,one.id,'approve','',signature);assert.equal(s.document(waiting.id).status,'approved');
  }finally{s.close();}
});

test('이전 시험 결재선은 같은 현장과 문서 유형의 앞선 기록에서만 조회한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),makeReviewer=(siteId,id)=>s.createReviewer({siteId,loginId:id,name:id,password:'virtual-password-123'}),one=makeReviewer(site.id,'previous_one'),two=makeReviewer(site.id,'previous_two'),foreign=makeReviewer(other.id,'previous_other'),make=(siteId,type,title)=>s.createDocument({siteId,type,title,date:'2026-10-29'}),source=make(site.id,'tbm','가상 원본');
    assert.equal(s.previousApprovalLine(source.id),null);s.setApprovalLine(source.id,[one.id,two.id]);const outside=make(other.id,'tbm','다른 현장');s.setApprovalLine(outside.id,[foreign.id]);const different=make(site.id,'education','다른 유형');s.setApprovalLine(different.id,[one.id]);make(site.id,'tbm','결재선 없는 문서');const target=make(site.id,'tbm','가상 대상'),future=make(site.id,'tbm','이후 문서');s.setApprovalLine(future.id,[two.id]);
    const previous=s.previousApprovalLine(target.id);assert.equal(previous.document.id,source.id);assert.deepEqual(previous.reviewers.map(step=>step.reviewer_id),[one.id,two.id]);assert.deepEqual(s.approvalLine(target.id),[]);
    s.updateReviewer(site.id,two.id,{active:false});assert.equal(s.previousApprovalLine(target.id).reviewers[1].active,0);assert.throws(()=>s.setApprovalLine(target.id,[one.id,two.id]),/활성/);assert.deepEqual(s.approvalLine(target.id),[]);
    s.setApprovalLine(target.id,[one.id]);s.transition(target.id,'submit');assert.throws(()=>s.previousApprovalLine(target.id),/수정/);assert.throws(()=>s.previousApprovalLine(99999),/문서/);
  }finally{s.close();}
});

test('시험 결재 계정과 진행 순서는 데이터베이스를 다시 열어도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-persist-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),first=s.createReviewer({siteId:site.id,loginId:'persist_one',name:'가상 첫째',password:'virtual-password-123'}),second=s.createReviewer({siteId:site.id,loginId:'persist_two',name:'가상 둘째',password:'virtual-password-123'}),doc=s.createDocument({siteId:site.id,type:'tbm',title:'가상 문서',date:'2026-10-29'}),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    s.setApprovalLine(doc.id,[first.id,second.id]);s.transition(doc.id,'submit');s.reviewerTransition(doc.id,first.id,'approve','가상 의견',signature);s.close();s=new Store(file);
    assert.equal(s.authenticateReviewer('persist_two','virtual-password-123').id,second.id);assert.deepEqual(s.approvalLine(doc.id).map(step=>step.state),['approved','pending']);assert.deepEqual(s.reviewerDocuments(second.id).map(row=>row.id),[doc.id]);assert.equal(s.events(doc.id).at(-1).reviewer_name,'가상 첫째');s.reviewerTransition(doc.id,second.id,'approve','',signature);assert.equal(s.document(doc.id).status,'approved');
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('관리자 단독 결재 요청도 사본을 보존하고 재요청과 저장 실패를 분리한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-admin-cycle-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{items:[{task:'가상 작업',dueDate:'2026-11-01',responsible:'가상 담당'}]}}),attachment=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 자료'));
    s.transition(doc.id,'submit');const first=s.document(doc.id).approval_cycle_id;assert.ok(first);assert.equal(s.events(doc.id)[0].approval_cycle_id,first);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,first,'document',0,attachment).data),Buffer.from('가상 자료'));
    s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{siteId:site.id,type:'risk',title:'수정 평가',date:'2026-10-29',details:{items:[{task:'변경 작업',dueDate:'2026-11-02'}]}});s.transition(doc.id,'submit');const second=s.document(doc.id).approval_cycle_id;assert.notEqual(first,second);s.transition(doc.id,'approve');s.updateRiskImprovement(doc.id,{siteId:site.id,index:0,dueDate:'2026-11-03',completionDate:'',responsible:'새 담당'});
    s.close();s=new Store(file);assert.equal(JSON.parse(s.approvalCycle(doc.id,first).document.details).items[0].task,'가상 작업');assert.equal(JSON.parse(s.approvalCycle(doc.id,second).document.details).items[0].dueDate,'2026-11-02');assert.equal(JSON.parse(s.document(doc.id).details).items[0].dueDate,'2026-11-03');
    const failing=s.createDocument({siteId:site.id,type:'tbm',title:'보존 실패',date:'2026-10-29'});s.addAttachment(failing.id,'가상.txt',Buffer.from('첨부'));s.db.exec("CREATE TRIGGER fail_admin_capture BEFORE INSERT ON approval_cycle_files BEGIN SELECT RAISE(ABORT,'보존 시험 오류'); END");assert.throws(()=>s.transition(failing.id,'submit'),/보존 시험 오류/);assert.equal(s.document(failing.id).status,'draft');assert.equal(s.document(failing.id).approval_cycle_id,null);assert.deepEqual(s.events(failing.id),[]);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('순차 결재는 요청 당시 자료를 보존하고 재요청 시 새 자료를 별도로 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),reviewer=(id)=>s.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),one=reviewer('snapshot_one'),two=reviewer('snapshot_two'),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',body:'첫 내용'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`,input={kind:'meeting',date:'2026-10-29',place:'가상 장소',host:'가상 주관',participants:'가상 참석',content:'첫 활동'},activity=s.saveRiskActivity(doc.id,input),photo=s.addRiskActivityPhoto(doc.id,activity,'가상.png',bytes),attachment=s.addAttachment(doc.id,'가상.txt',Buffer.from('첫 첨부'));
    s.setApprovalLine(doc.id,[one.id,two.id]);s.transition(doc.id,'submit');const submitted=s.document(doc.id),cycleId=submitted.approval_cycle_id,first=s.reviewerPayload(submitted);assert.equal(first.frozen,true);assert.equal(first.linked.activities[0].content,'첫 활동');assert.equal(first.attachments[0].id,attachment);
    s.reviewerTransition(doc.id,one.id,'approve','첫 승인',signature);s.saveRiskActivity(doc.id,{...input,content:'변경된 활동'},activity);s.deleteRiskActivityPhoto(doc.id,activity,photo);const second=s.reviewerPayload(s.document(doc.id));assert.equal(second.linked.activities[0].content,'첫 활동');assert.deepEqual(Buffer.from(s.reviewerLinkedFile(s.document(doc.id),'risk',activity,photo).data),bytes);assert.equal(s.events(doc.id).at(-1).approval_cycle_id,cycleId);
    s.reviewerTransition(doc.id,two.id,'reject','가상 반려');s.transition(doc.id,'revise');s.updateDocument(doc.id,{siteId:site.id,type:'risk',title:'변경된 평가',date:'2026-10-29',body:'새 내용'});s.transition(doc.id,'submit');const next=s.document(doc.id),newCycle=next.approval_cycle_id;assert.notEqual(newCycle,cycleId);assert.equal(s.reviewerPayload(next).linked.activities[0].content,'변경된 활동');assert.equal(s.reviewerLinkedFile(next,'risk',activity,photo),null);assert.equal(s.approvalCycle(doc.id,cycleId).document.body,'첫 내용');assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycleId,'risk',activity,photo).data),bytes);assert.equal(s.approvalCycle(doc.id,newCycle).document.body,'새 내용');
    const unfinished=s.createDocument({siteId:site.id,type:'tbm',title:'이전 요청',date:'2026-10-29'});s.setApprovalLine(unfinished.id,[one.id]);s.transition(unfinished.id,'submit');s.db.prepare('UPDATE documents SET approval_cycle_id=NULL WHERE id=?').run(unfinished.id);assert.equal(s.reviewerPayload(s.document(unfinished.id)).frozen,false);assert.throws(()=>s.reviewerTransition(unfinished.id,one.id,'approve','',signature),/다시 요청/);s.reviewerTransition(unfinished.id,one.id,'reject','가상 반려');assert.equal(s.document(unfinished.id).status,'rejected');
    const failing=s.createDocument({siteId:site.id,type:'tbm',title:'보존 실패',date:'2026-10-29'});s.addAttachment(failing.id,'가상.txt',Buffer.from('가상'));s.setApprovalLine(failing.id,[one.id]);s.db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON approval_cycle_files BEGIN SELECT RAISE(ABORT,'보존 시험 오류'); END");assert.throws(()=>s.transition(failing.id,'submit'),/보존 시험 오류/);assert.equal(s.document(failing.id).status,'draft');assert.equal(s.document(failing.id).approval_cycle_id,null);assert.equal(s.events(failing.id).length,0);assert.equal(s.approvalLine(failing.id)[0].state,'pending');s.db.exec('DROP TRIGGER fail_snapshot');
  }finally{s.close();}
});

test('일괄 시험 승인은 같은 현장의 대기 문서만 모두 처리하며 오류 때 전부 되돌린다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=siteId=>s.createDocument({siteId,type:'tbm',title:'가상 문서',date:'2026-10-29'}),one=make(a.id),two=make(a.id),other=make(b.id),draft=make(a.id);
    const image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    for(const doc of [one,two,other])s.transition(doc.id,'submit');
    for(const ids of [[],[one.id,one.id],[one.id,draft.id],[one.id,other.id],[one.id,99999],Array(101).fill(one.id)])assert.throws(()=>s.approveDocuments(a.id,ids,signature));
    assert.throws(()=>s.approveDocuments(a.id,[one.id],''),/서명/);
    assert.equal(s.document(one.id).status,'pending');assert.equal(s.events(one.id).length,1);
    s.db.exec(`CREATE TRIGGER test_batch_failure BEFORE INSERT ON events WHEN NEW.document_id=${two.id} AND NEW.action='approve' BEGIN SELECT RAISE(ABORT,'시험 오류'); END`);
    assert.throws(()=>s.approveDocuments(a.id,[one.id,two.id],signature),/시험 오류/);assert.equal(s.document(one.id).status,'pending');assert.equal(s.events(one.id).length,1);
    s.db.exec('DROP TRIGGER test_batch_failure');assert.deepEqual(s.approveDocuments(a.id,[one.id,two.id],signature),{approved:2});assert.equal(s.document(one.id).status,'approved');const event=s.events(two.id).at(-1);assert.equal(event.action,'approve');assert.equal(event.has_signature,1);assert.deepEqual(Buffer.from(s.eventSignature(two.id,event.id)),bytes);assert.equal(s.eventSignature(other.id,event.id),null);assert.equal(s.document(other.id).status,'pending');
  }finally{s.close();}
});

test('가상 노임 직종별 합계는 현장과 월, 기록 당시 직종으로 구분한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name,occupation)=>s.createWorker({siteId,name,category:'직영',company:'가상 회사',occupation}),one=add(a.id,'가상 1','목공'),two=add(a.id,'가상 2','목공'),other=add(b.id,'다른 현장','목공'),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'};
    for(const [siteId,worker,month] of [[a.id,one,'2024-02'],[a.id,two,'2024-02'],[b.id,other,'2024-02'],[a.id,one,'2024-03']])s.saveWageRecord({siteId,workerId:worker.id,month,gross:'1000',deductions});
    s.updateWorker(one.id,{siteId:a.id,name:'가상 1',category:'직영',company:'가상 회사',occupation:'전기'});
    assert.deepEqual(s.wageSummary(a.id,'2024-02'),[{occupation:'목공',count:2,gross:2000,deductions:376,net:1624}]);assert.equal(s.wageSummary(b.id,'2024-02')[0].count,1);assert.equal(s.wageSummary(a.id,'2024-03')[0].count,1);
  }finally{s.close();}
});

test('가상 노임 생년월일은 등록 당시 가입 정보만 보존하고 비고를 수정한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공',loginId:'wage_virtual',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'1990-01-02'}}),deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'},input={siteId:site.id,workerId:worker.id,month:'2024-02',gross:'1000',deductions,remark:'가상 비고'};
    s.saveWageRecord(input);let row=s.wageRecords(site.id,'2024-02')[0];assert.equal(row.birth_date_snapshot,'1990-01-02');assert.equal(row.remark,'가상 비고');
    s.db.prepare('UPDATE join_acknowledgements SET profile=? WHERE worker_id=?').run(JSON.stringify({birthDate:'2000-02-03'}),worker.id);
    s.saveWageRecord({...input,gross:'1100',remark:'수정 비고'},true);row=s.wageRecords(site.id,'2024-02')[0];assert.equal(row.birth_date_snapshot,'1990-01-02');assert.equal(row.remark,'수정 비고');
    const {remark,...withoutRemark}=input;s.saveWageRecord(withoutRemark,true);assert.equal(s.wageRecords(site.id,'2024-02')[0].remark,'수정 비고');
    assert.throws(()=>s.saveWageRecord({...input,remark:'가'.repeat(501)},true),/비고/);assert.throws(()=>s.saveWageRecord({...input,siteId:other.id},true),/현장/);assert.equal(s.wageRecords(site.id,'2024-02')[0].remark,'수정 비고');
    s.saveWageRecord({...input,month:'2024-03',remark:''});assert.equal(s.wageRecords(site.id,'2024-03')[0].birth_date_snapshot,'2000-02-03');assert.equal(s.wageRecords(site.id,'2024-03')[0].remark,'');
  }finally{s.close();}
});

test('가상 노임 검색과 합계는 저장 당시 소속·구분과 현장·월을 기준으로 한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name,company,category)=>s.createWorker({siteId,name,company,category,occupation:'목공'}),one=add(a.id,'가상 한','업체 A','협력'),two=add(a.id,'가상 둘','업체 B','직영'),other=add(b.id,'가상 셋','업체 A','협력'),deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'};
    for(const [siteId,worker,month] of [[a.id,one,'2024-02'],[a.id,two,'2024-02'],[a.id,one,'2024-03'],[b.id,other,'2024-02']])s.saveWageRecord({siteId,workerId:worker.id,month,gross:'1000',deductions});
    s.updateWorker(one.id,{siteId:a.id,name:'변경 이름',company:'새 업체',category:'직영',occupation:'전기'});
    const filter={company:'업체 A',category:'협력',q:'가상 한'},records=s.wageRecords(a.id,'2024-02',filter);assert.equal(records.length,1);assert.equal(records[0].worker_id,one.id);assert.equal(records[0].category,'협력');assert.equal(s.wageSummary(a.id,'2024-02',filter)[0].gross,1000);assert.equal(s.wageRecords(a.id,'2024-02',{company:'새 업체'}).length,0);assert.equal(s.wageRecords(a.id,'2024-02',{company:'업체 B',category:'협력'}).length,0);assert.equal(s.wageRecords(b.id,'2024-02',filter).length,0);assert.equal(s.wageRecords(a.id,'2024-03',filter).length,1);assert.deepEqual(s.wageDailyRecords(a.id,'2024-02',filter).map(row=>row.worker_id),[one.id]);assert.deepEqual(s.wageDailyRecords(b.id,'2024-02',filter),[]);
  }finally{s.close();}
});

test('가상 노임은 현장과 월별로 수동 공제액을 검증하고 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'},input={siteId:a.id,workerId:worker.id,month:'2024-02',gross:'1000',deductions};
    s.saveWageRecord(input);const row=s.wageRecords(a.id,'2024-02')[0];assert.equal(row.total,188);assert.equal(row.net,812);assert.equal(s.wageRecords(b.id,'2024-02').length,0);assert.equal(s.wageRecords(a.id,'2024-03').length,0);
    assert.throws(()=>s.saveWageRecord({...input,siteId:b.id}),/현장/);assert.throws(()=>s.saveWageRecord({...input,gross:'100'}),/공제액/);assert.throws(()=>s.saveWageRecord({...input,deductions:{...deductions,income:'-1'}}),/금액/);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,1000);
    assert.throws(()=>s.saveWageRecord({...input,gross:'2000'}),/이미 등록/);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,1000);s.saveWageRecord({...input,gross:'2000'},true);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,2000);assert.throws(()=>s.saveWageRecord({...input,month:'2024-03'},true),/찾을 수 없/);
    s.updateWorker(worker.id,{siteId:a.id,name:'변경 이름',category:'외주',company:'변경 회사',occupation:'전기'});s.saveWageRecord({...input,gross:'3000'},true);const saved=s.wageRecords(a.id,'2024-02')[0];assert.equal(saved.name,'가상 근로자');assert.equal(saved.company,'가상 회사');assert.equal(saved.occupation,'목공');s.db.prepare('UPDATE wage_records SET name_snapshot=NULL,company_snapshot=NULL,occupation_snapshot=NULL').run();assert.equal(s.wageRecords(a.id,'2024-02')[0].company,'기록 없음');
  }finally{s.close();}
});

test('시험 노임은 조회 시점의 해당 근로자 출역과 공수를 별도로 표시한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=add(a.id,'가상 근로자'),other=add(b.id,'다른 근로자'),deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'};s.saveWageRecord({siteId:a.id,workerId:one.id,month:'2024-02',gross:'1000',deductions});
    const record=()=>s.wageRecords(a.id,'2024-02')[0];assert.equal(record().attendance_days,0);assert.equal(record().units_hundredths,null);assert.equal(record().units_missing,0);assert.equal(record().estimated_pay,null);assert.equal(record().pay_missing,0);
    for(const [siteId,worker,date] of [[a.id,one,'2024-02-01'],[a.id,one,'2024-02-02'],[a.id,one,'2024-03-01'],[b.id,other,'2024-02-01']])s.setAttendance({siteId,workerId:worker.id,date,present:true});s.setAttendanceUnits({siteId:a.id,workerId:one.id,date:'2024-02-01',units:'1.25'});s.setAttendanceUnits({siteId:b.id,workerId:other.id,date:'2024-02-01',units:'9'});
    const first={siteId:a.id,workerId:one.id,date:'2024-02-01'},second={...first,date:'2024-02-02'};s.setAttendanceDailyRate({...first,dailyRate:'101'});assert.equal(record().attendance_days,2);assert.equal(record().units_hundredths,125);assert.equal(record().units_missing,1);assert.equal(record().estimated_pay,126);assert.equal(record().pay_missing,1);assert.equal(record().gross,1000);assert.equal(record().net,1000);
    s.setAttendanceUnits({...second,units:'0.5'});s.setAttendanceDailyRate({...second,dailyRate:'101'});assert.equal(record().estimated_pay,177);assert.equal(record().pay_missing,0);s.setAttendanceUnits({...first,units:'0.5'});assert.equal(record().estimated_pay,102);s.setAttendanceDailyRate({...first,dailyRate:'0'});assert.equal(record().estimated_pay,51);s.setAttendanceDailyRate({...second,dailyRate:'0'});assert.equal(record().estimated_pay,0);s.setAttendanceDailyRate({...second,dailyRate:''});assert.equal(record().pay_missing,1);
    s.setAttendance({...first,present:false});assert.equal(record().attendance_days,1);assert.equal(record().estimated_pay,null);assert.equal(record().pay_missing,1);assert.equal(record().gross,1000);assert.deepEqual(s.wageDailyRecords(a.id,'2024-02')[0].days.map(day=>day.date),['2024-02-02']);
  }finally{s.close();}
});

test('월급과 연봉 시험 기록은 일당 계산과 분리되고 기존 노임을 바꾸지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 A'}),other=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),date='2026-10-01',base={siteId:site.id,workerId:worker.id,date},deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'};
    s.saveWageRecord({siteId:site.id,workerId:worker.id,month:'2026-10',gross:'1000',deductions});s.setAttendance({...base,present:true});s.setAttendanceUnits({...base,units:'1'});s.setAttendanceDailyRate({...base,dailyRate:'100'});
    s.setAttendanceSalary({...base,kind:'monthly',amount:'3000'});let row=s.monthlyAttendance(site.id,'2026-10')[0].units[0];assert.equal(row.salary_kind,'monthly');assert.equal(row.salary_amount,3000);assert.equal(row.daily_rate,100);assert.equal(row.estimated_pay,null);assert.equal(s.wageRecords(site.id,'2026-10')[0].estimated_pay,null);assert.equal(s.wageRecords(site.id,'2026-10')[0].gross,1000);
    assert.throws(()=>s.setAttendanceSalary({...base,siteId:other.id,kind:'yearly',amount:'12000'}),/현장/);assert.throws(()=>s.setAttendanceSalary({...base,kind:'invalid',amount:'100'}),/종류/);assert.throws(()=>s.setAttendanceSalary({...base,kind:'monthly',amount:''}),/종류/);assert.equal(s.attendance(site.id,date)[0].salary_amount,3000);
    s.setAttendanceSalary({...base,kind:'yearly',amount:'12000'});s.setAttendanceDailyRate({...base,dailyRate:'150'});row=s.monthlyAttendance(site.id,'2026-10')[0].units[0];assert.equal(row.salary_kind,null);assert.equal(row.estimated_pay,150);
    s.setAttendanceSalary({...base,kind:'other',amount:'10'});s.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2026-10',dailyRate:'200'});row=s.monthlyAttendance(site.id,'2026-10')[0].units[0];assert.equal(row.salary_kind,null);assert.equal(row.estimated_pay,200);assert.equal(s.wageRecords(site.id,'2026-10')[0].gross,1000);
  }finally{s.close();}
});

test('월별 시험 급여 일괄 변경은 선택한 출역 기록에만 적용된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),one=make(site.id),two=make(site.id),foreign=make(other.id),base={siteId:site.id,workerId:one.id,month:'2026-10'};
    for(const [siteId,workerId,date] of [[site.id,one.id,'2026-10-01'],[site.id,one.id,'2026-10-02'],[site.id,one.id,'2026-11-01'],[site.id,two.id,'2026-10-01'],[other.id,foreign.id,'2026-10-01']])s.setAttendance({siteId,workerId,date,present:true});s.setAttendance({siteId:site.id,workerId:one.id,date:'2026-10-02',present:false});
    for(const change of [{salaryKind:'monthly'},{salaryAmount:'100'},{salaryKind:'invalid',salaryAmount:'100'},{salaryKind:'monthly',salaryAmount:'-1'},{salaryKind:'yearly',salaryAmount:'100',dailyRate:'1'}])assert.throws(()=>s.updateMonthlyAttendanceDetails({...base,company:'바뀌면 안 됨',...change}));
    assert.equal(s.monthlyAttendance(site.id,'2026-10').find(w=>w.id===one.id).units[0].company,'가상 업체');assert.throws(()=>s.updateMonthlyAttendanceDetails({...base,siteId:other.id,salaryKind:'monthly',salaryAmount:'3000'}),/현장/);
    assert.equal(s.updateMonthlyAttendanceDetails({...base,salaryKind:'monthly',salaryAmount:'3000'}),1);const row=s.monthlyAttendance(site.id,'2026-10').find(w=>w.id===one.id).units[0];assert.equal(row.salary_kind,'monthly');assert.equal(row.salary_amount,3000);assert.equal(s.monthlyAttendance(site.id,'2026-11').find(w=>w.id===one.id).units[0].salary_kind,null);assert.equal(s.monthlyAttendance(site.id,'2026-10').find(w=>w.id===two.id).units[0].salary_kind,null);assert.equal(s.monthlyAttendance(other.id,'2026-10')[0].units[0].salary_kind,null);
    s.setAttendance({siteId:site.id,workerId:one.id,date:'2026-10-02',present:true});assert.equal(s.monthlyAttendance(site.id,'2026-10').find(w=>w.id===one.id).units[1].salary_kind,null);assert.equal(s.updateMonthlyAttendanceDetails({...base,salaryKind:'yearly',salaryAmount:'0'}),2);assert.ok(s.monthlyAttendance(site.id,'2026-10').find(w=>w.id===one.id).units.every(r=>r.salary_kind==='yearly'&&r.salary_amount===0));
  }finally{s.close();}
});

test('기존 일당 기록은 급여 구분 추가 후 보존되고 새 급여 설정도 재시작 후 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-salary-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),base={siteId:site.id,workerId:worker.id,date:'2026-10-01'};s.setAttendance({...base,present:true});s.setAttendanceUnits({...base,units:'1'});s.setAttendanceDailyRate({...base,dailyRate:'100'});s.db.exec('ALTER TABLE attendance DROP COLUMN salary_amount');s.db.exec('ALTER TABLE attendance DROP COLUMN salary_kind');s.close();s=new Store(file);let row=s.monthlyAttendance(site.id,'2026-10')[0].units[0];assert.equal(row.daily_rate,100);assert.equal(row.salary_kind,null);assert.equal(row.estimated_pay,100);s.setAttendanceSalary({...base,kind:'monthly',amount:'3000'});s.close();s=new Store(file);row=s.monthlyAttendance(site.id,'2026-10')[0].units[0];assert.equal(row.salary_kind,'monthly');assert.equal(row.salary_amount,3000);assert.equal(row.daily_rate,100);assert.equal(row.estimated_pay,null);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('식대 시험 기록은 출역과 현장을 검증하고 기록 단가를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:a.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:a.id,workerId:worker.id,date:'2024-02-29',kind:'lunch',restaurantId:restaurant.id};
    assert.throws(()=>s.saveMealCheck(input),/출역자/);s.setAttendance({siteId:a.id,workerId:worker.id,date:input.date,present:true});s.saveMealCheck(input);
    assert.throws(()=>s.saveMealCheck({...input,siteId:b.id}),/출역자/);assert.throws(()=>s.saveMealCheck({...input,kind:'invalid'}),/종류/);
    s.saveRestaurant({siteId:a.id,name:'수정 식당',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);const row=s.mealChecks(a.id,input.date)[0];assert.equal(row.price,5000);assert.equal(row.restaurant_name,'가상 식당');
    assert.equal(s.monthlyMealChecks(a.id,'2024-02')[0].total,5000);assert.equal(s.monthlyMealChecks(a.id,'2024-02')[0].count,1);assert.equal(s.monthlyMealChecks(b.id,'2024-02').length,0);assert.equal(s.monthlyMealChecks(a.id,'2024-03').length,0);assert.throws(()=>s.monthlyMealChecks(a.id,'2024-13'),/월/);
    assert.throws(()=>s.deleteMealCheck(b.id,row.id),/현장/);s.deleteMealCheck(a.id,row.id);assert.equal(s.mealChecks(a.id,input.date).length,0);
  }finally{s.close();}
});

test('조식 시험 기록은 출역을 검증하고 식사 단가를 월 합계에 포함한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:site.id,workerId:worker.id,date:'2024-02-29',kind:'breakfast',restaurantId:restaurant.id};
    assert.throws(()=>s.saveMealCheck(input),/출역자/);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:input.date,present:true});s.saveMealCheck(input);
    assert.equal(s.mealChecks(site.id,input.date)[0].kind,'breakfast');assert.equal(s.mealChecks(site.id,input.date)[0].price,5000);assert.equal(s.monthlyMealChecks(site.id,'2024-02')[0].total,5000);
  }finally{s.close();}
});

test('근로자별 월간 식대는 현장과 월을 제한하고 과거 단가를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),day='2024-02-29';
    s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});s.saveMealCheck({siteId:site.id,workerId:worker.id,date:day,kind:'breakfast',restaurantId:restaurant.id});
    s.saveRestaurant({siteId:site.id,name:'다른 이름',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:false});
    const rows=s.workerMonthlyMealChecks(site.id,worker.id,'2024-02');assert.equal(rows.length,1);assert.equal(rows[0].date,day);assert.equal(rows[0].restaurant_name,'가상 식당');assert.equal(rows[0].price,5000);
    assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-03'),[]);assert.throws(()=>s.workerMonthlyMealChecks(other.id,worker.id,'2024-02'),/현장/);assert.throws(()=>s.workerMonthlyMealChecks(site.id,worker.id,'2024-13'),/월/);
  }finally{s.close();}
});

test('월간 식대 일괄 변경은 출역일만 대상으로 기존 단가와 다른 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:site.id,workerId:worker.id,month:'2024-02',kind:'lunch',present:true,restaurantId:restaurant.id};
    for(const date of ['2024-02-01','2024-02-02','2024-03-01'])s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});
    s.saveMealCheck({siteId:site.id,workerId:worker.id,date:'2024-02-01',kind:'lunch',restaurantId:restaurant.id});s.saveRestaurant({siteId:site.id,name:'변경 식당',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);
    assert.equal(s.setWorkerMonthlyMeals(input),1);assert.equal(s.setWorkerMonthlyMeals(input),0);assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-02').map(x=>x.price),[5000,7000]);
    assert.throws(()=>s.setWorkerMonthlyMeals({...input,siteId:other.id}),/현장/);assert.throws(()=>s.setWorkerMonthlyMeals({...input,restaurantId:999}),/식당/);assert.throws(()=>s.setWorkerMonthlyMeals({...input,present:'true'}),/선택/);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-01',present:false});assert.equal(s.setWorkerMonthlyMeals({...input,present:false}),1);assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-02').map(x=>x.date),['2024-02-01']);
    assert.equal(s.workerMonthlyMealChecks(site.id,worker.id,'2024-03').length,0);
  }finally{s.close();}
});

test('식대 부가세는 기록 시점에 보존하고 간식은 미기록으로 둔다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),input={siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'},restaurant=s.saveRestaurant(input);
    s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:restaurant.id},{kind:'snack',restaurantId:restaurant.id}]);s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-01',present:true});s.saveRestaurant({...input,tax:'700'},restaurant.id);s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-02',present:true});
    assert.deepEqual(s.mealChecks(site.id,'2026-10-01').map(r=>[r.kind,r.tax_snapshot]),[['lunch',500],['snack',null]]);assert.deepEqual(s.mealChecks(site.id,'2026-10-02').map(r=>[r.kind,r.tax_snapshot]),[['lunch',700],['snack',null]]);
    assert.equal(s.setWorkerMonthlyMeals({siteId:site.id,workerId:worker.id,month:'2026-10',kind:'breakfast',present:true,restaurantId:restaurant.id}),2);s.saveMealCheck({siteId:site.id,workerId:worker.id,date:'2026-10-01',kind:'dinner',restaurantId:restaurant.id});
    const rows=s.workerMonthlyMealChecks(site.id,worker.id,'2026-10');assert.ok(rows.filter(r=>r.kind==='breakfast'||r.kind==='dinner').every(r=>r.tax_snapshot===700));const groups=s.mealStatement(site.id,'2026-10').groups;assert.deepEqual(groups.filter(g=>g.kind==='lunch').map(g=>[g.tax_snapshot,g.total_with_tax]),[[500,5500],[700,5700]]);assert.equal(groups.find(g=>g.kind==='snack').total_with_tax,null);
  }finally{s.close();}
});

test('이전 식대 기록은 부가세 열 추가 후 미기록으로 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meal-tax-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'});s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-01',present:true});s.saveMealCheck({siteId:site.id,workerId:worker.id,date:'2026-10-01',kind:'lunch',restaurantId:restaurant.id});s.db.exec('ALTER TABLE meal_checks DROP COLUMN tax_snapshot');s.close();s=new Store(file);const row=s.mealChecks(site.id,'2026-10-01')[0];assert.equal(row.price,5000);assert.equal(row.tax_snapshot,null);assert.equal(s.mealStatement(site.id,'2026-10').groups[0].total_with_tax,null);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('월간 식대 명세서는 현장과 월을 제한하고 기록 단가별 수량을 집계한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'});
    for(const date of ['2024-02-01','2024-02-02','2024-03-01']){if(date==='2024-02-02')s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'7000',snackPrice:'1000',tax:'0'},restaurant.id);s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});s.saveMealCheck({siteId:site.id,workerId:worker.id,date,kind:'lunch',restaurantId:restaurant.id});}
    const report=s.mealStatement(site.id,'2024-02');assert.equal(report.site.name,'가상 현장');assert.equal(report.rows.length,2);assert.deepEqual(report.groups.map(g=>[g.price,g.quantity,g.total]),[[5000,1,5000],[7000,1,7000]]);assert.deepEqual(s.mealStatement(other.id,'2024-02').rows,[]);assert.equal(s.mealStatement(site.id,'2024-03').rows.length,1);assert.throws(()=>s.mealStatement(site.id,'2024-13'),/월/);assert.throws(()=>s.mealStatement(999,'2024-02'),/현장/);
  }finally{s.close();}
});

test('직영 출역의 자동 식대는 현장별 설정을 적용하고 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 직영',category:'직영',company:'가상 회사',occupation:'목공'}),external=s.createWorker({siteId:site.id,name:'가상 외주',category:'외주',company:'가상 회사',occupation:'목공'}),meal=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),snack=s.saveRestaurant({siteId:site.id,name:'가상 매점',mealPrice:'4000',snackPrice:'2000',tax:'0'}),config=[{kind:'lunch',restaurantId:meal.id},{kind:'snack',restaurantId:snack.id}];
    s.saveMealDefaults(site.id,config);assert.equal(s.mealDefaults(other.id).length,0);assert.throws(()=>s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:999}]),/식당/);assert.throws(()=>s.saveMealDefaults(site.id,[config[0],config[0]]),/설정/);assert.equal(s.mealDefaults(site.id).length,2);
    const day='2024-02-29';s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});let rows=s.mealChecks(site.id,day);assert.deepEqual(rows.map(r=>r.price),[5000,2000]);
    s.setAttendance({siteId:site.id,workerId:external.id,date:day,present:true});assert.equal(s.mealChecks(site.id,day).length,2);
    s.deleteMealCheck(site.id,rows[0].id);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});s.recordWorkerLogin(worker.id,day);assert.equal(s.mealChecks(site.id,day).length,1);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:false});assert.equal(s.mealChecks(site.id,day).length,1);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});assert.equal(s.mealChecks(site.id,day).length,2);
    s.recordWorkerLogin(worker.id,'2024-03-01');assert.equal(s.mealChecks(site.id,'2024-03-01').length,2);s.saveMealDefaults(site.id,[]);s.recordWorkerLogin(worker.id,'2024-03-02');assert.equal(s.mealChecks(site.id,'2024-03-02').length,0);
  }finally{s.close();}
});

test('현장관리자 자동 식대는 직영 설정과 분리되고 현장별로 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-manager-meal-')),path=join(dir,'test.sqlite');let s=new Store(path);
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,name,category)=>s.createWorker({siteId,name,category,company:'가상 업체',occupation:'가상 직종'}),manager=make(site.id,'가상 관리자','현장관리자'),worker=make(site.id,'가상 직영','직영'),external=make(site.id,'가상 외주','외주'),foreign=make(other.id,'다른 관리자','현장관리자'),meal=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),otherMeal=s.saveRestaurant({siteId:other.id,name:'다른 식당',mealPrice:'6000',snackPrice:'1000',tax:'600'});
    s.saveMealDefaults(site.id,[{kind:'snack',restaurantId:meal.id}]);s.saveMealDefaults(site.id,[{kind:'breakfast',restaurantId:meal.id},{kind:'lunch',restaurantId:meal.id}],'manager');
    assert.throws(()=>s.saveMealDefaults(site.id,[{kind:'snack',restaurantId:meal.id}],'manager'),/식사/);assert.throws(()=>s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:otherMeal.id}],'manager'),/식당/);assert.throws(()=>s.mealDefaults(site.id,'invalid'),/구분/);
    const date='2024-02-29';for(const workerId of [manager.id,worker.id,external.id,foreign.id])s.setAttendance({siteId:workerId===foreign.id?other.id:site.id,workerId,date,present:true});
    assert.deepEqual(s.mealChecks(site.id,date).filter(row=>row.worker_id===manager.id).map(row=>row.kind).sort(),['breakfast','lunch']);assert.deepEqual(s.mealChecks(site.id,date).filter(row=>row.worker_id===worker.id).map(row=>row.kind),['snack']);assert.equal(s.mealChecks(site.id,date).filter(row=>row.worker_id===external.id).length,0);assert.equal(s.mealChecks(other.id,date).length,0);
    s.saveMealDefaults(site.id,[],'manager');assert.equal(s.mealChecks(site.id,date).filter(row=>row.worker_id===manager.id).length,2);assert.equal(s.mealDefaults(site.id).length,1);
    s.saveMealDefaults(site.id,[{kind:'dinner',restaurantId:meal.id}],'manager');s.close();s=new Store(path);s.recordWorkerLogin(manager.id,'2024-03-01');assert.deepEqual(s.mealChecks(site.id,'2024-03-01').map(row=>row.kind),['dinner']);assert.equal(s.mealDefaults(site.id,'manager')[0].kind,'dinner');
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('자동 식대 설정과 기록은 데이터베이스를 다시 열어도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-meal-')),path=join(dir,'test.sqlite');try{
    let s=new Store(path),site,worker;try{site=s.createSite({name:'가상 현장'});worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});const restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'});s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:restaurant.id}]);}finally{s.close();}
    s=new Store(path);try{s.recordWorkerLogin(worker.id,'2024-02-29');assert.equal(s.mealChecks(site.id,'2024-02-29')[0].price,5000);}finally{s.close();}
    s=new Store(path);try{assert.equal(s.mealDefaults(site.id)[0].kind,'lunch');assert.equal(s.mealChecks(site.id,'2024-02-29').length,1);}finally{s.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('보호구 시험 지급은 현장·월별로 집계하고 기록 당시 출입자 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),input={siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'안전모',quantity:'2'};
    s.addPpeIssue(input);s.addPpeIssue({...input,quantity:'1'});s.addPpeIssue({...input,date:'2024-03-01',item:'안전화'});s.updateWorker(worker.id,{siteId:site.id,name:'변경 이름',category:'외주',company:'변경 회사',occupation:'전기'});
    const report=s.ppeIssues(site.id,'2024-02');assert.equal(report.rows.length,2);assert.deepEqual(report.totals.map(r=>[r.item,r.quantity]),[['안전모',3]]);assert.equal(report.rows[0].worker.name,'가상 근로자');assert.equal(report.rows[0].worker.company,'가상 회사');
    assert.equal(s.workerPpeIssues(site.id,worker.id).length,3);assert.throws(()=>s.workerPpeIssues(other.id,worker.id),/현장/);
    assert.equal(s.ppeIssues(other.id,'2024-02').rows.length,0);assert.equal(s.ppeIssues(site.id,'2024-03').rows.length,1);assert.throws(()=>s.addPpeIssue({...input,siteId:other.id}),/현장/);for(const quantity of ['0','-1','1.2',true,'10001'])assert.throws(()=>s.addPpeIssue({...input,quantity}),/수량/);assert.throws(()=>s.ppeIssues(site.id,'2024-13'),/월/);
  }finally{s.close();}
});

test('이전 가상 신고에 접수 상태를 추가하고 조치 이력을 임의로 만들지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-hazards-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);old.exec("CREATE TABLE hazard_reports(id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,reporter TEXT NOT NULL,photo BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO hazard_reports(id,site_id,title,body,reporter) VALUES(1,1,'가상 신고','가상 내용','가상 신고자')");old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const row=s.db.prepare('SELECT status,response FROM hazard_reports WHERE id=1').get();assert.equal(row.status,'received');assert.equal(row.response,'');}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('보호구 지급 수정과 삭제는 현장을 제한하고 당시 근로자 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),input={siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'가상 안전모',quantity:'2'},id=s.addPpeIssue(input);
    s.updateWorker(worker.id,{siteId:site.id,name:'변경 이름',category:'외주',company:'변경 회사',occupation:'전기'});
    assert.throws(()=>s.updatePpeIssue(id,{...input,siteId:other.id}),/현장/);assert.throws(()=>s.updatePpeIssue(id,{...input,quantity:'0'}),/수량/);assert.throws(()=>s.updatePpeIssue(id,{...input,date:'2024-02-30'}),/날짜/);
    assert.equal(s.ppeIssues(site.id,'2024-02').rows[0].quantity,2);
    s.updatePpeIssue(id,{...input,date:'2024-03-01',item:'가상 안전화',quantity:'3'});assert.equal(s.ppeIssues(site.id,'2024-02').rows.length,0);
    const row=s.ppeIssues(site.id,'2024-03').rows[0];assert.equal(row.quantity,3);assert.equal(row.worker.name,'가상 근로자');assert.equal(row.worker.company,'가상 회사');assert.equal(s.workerPpeIssues(site.id,worker.id)[0].item,'가상 안전화');
    assert.throws(()=>s.deletePpeIssue(other.id,id),/현장/);assert.equal(s.workerPpeIssues(site.id,worker.id).length,1);s.deletePpeIssue(site.id,id);assert.deepEqual(s.ppeIssues(site.id,'2024-03').rows,[]);assert.throws(()=>s.deletePpeIssue(site.id,id),/현장/);
  }finally{s.close();}
});

test('자료실 공개와 첨부 접근은 현장과 공개 상태를 지키고 재시작 후에도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-articles-')),path=join(dir,'test.sqlite');let s;
  try{
    s=new Store(path);const a=s.createSite({name:'가상 현장 A'}),b=s.createSite({name:'가상 현장 B'}),add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),one=add(a.id),two=add(a.id),other=add(b.id);
    const input={siteId:a.id,category:'안전·보건',title:'가상 공개 자료',body:'가상 내용',visible:true},article=s.saveSiteArticle(input),file=s.addArticleFile(a.id,article.id,'가상.txt',Buffer.from('가상 파일'));
    const privateArticle=s.saveSiteArticle({...input,title:'가상 비공개',visible:false}),privateFile=s.addArticleFile(a.id,privateArticle.id,'비공개.txt',Buffer.from('비공개'));
    const foreign=s.saveSiteArticle({...input,siteId:b.id,title:'다른 현장 자료'}),foreignFile=s.addArticleFile(b.id,foreign.id,'다른.txt',Buffer.from('다른 파일'));s.close();
    s=new Store(path);for(const worker of [one,two]){assert.deepEqual(s.workerArticles(worker.id).map(row=>row.id),[article.id]);assert.equal(Buffer.from(s.workerArticleFile(worker.id,article.id,file).data).toString(),'가상 파일');assert.equal(s.workerArticleFile(worker.id,privateArticle.id,privateFile),null);assert.equal(s.workerArticleFile(worker.id,foreign.id,foreignFile),null);}
    assert.deepEqual(s.workerArticles(other.id).map(row=>row.id),[foreign.id]);assert.equal(s.workerArticleFile(other.id,article.id,file),null);
    assert.throws(()=>s.saveSiteArticle({...input,siteId:b.id},article.id),/현장/);s.saveSiteArticle({...input,visible:false},article.id);assert.equal(s.workerArticleFile(one.id,article.id,file),null);assert.deepEqual(s.workerArticles(two.id),[]);s.close();
    s=new Store(path);assert.equal(s.workerArticleFile(one.id,article.id,file),null);assert.equal(Buffer.from(s.articleFile(a.id,article.id,file).data).toString(),'가상 파일');
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('출입자 시험 서류는 현장과 출입자별로 분리하고 첨부를 검증한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),bytes=Buffer.from('가상 문서');
    const id=s.addWorkerFile(site.id,worker.id,'training','시험.txt',bytes);assert.equal(s.workerFiles(site.id,worker.id)[0].category,'training');assert.deepEqual(Buffer.from(s.workerFile(site.id,worker.id,id).data),bytes);
    assert.throws(()=>s.workerFiles(other.id,worker.id),/현장/);assert.equal(s.workerFile(other.id,worker.id,id),null);assert.throws(()=>s.deleteWorkerFile(other.id,worker.id,id),/첨부/);
    assert.throws(()=>s.addWorkerFile(site.id,worker.id,'invalid','시험.txt',bytes),/종류/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','../x',bytes),/이름/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','시험.txt',Buffer.alloc(0)),/파일/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','시험.txt',Buffer.alloc(2*1024*1024+1)),/파일/);
    assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','x\\y',bytes),/이름/);
    s.deleteWorkerFile(site.id,worker.id,id);assert.equal(s.workerFiles(site.id,worker.id).length,0);
  }finally{s.close();}
});

test('식당 시험 설정은 현장별로 저장하며 잘못된 수정을 거절한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={siteId:a.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'600'},restaurant=s.saveRestaurant(input);
    assert.equal(s.restaurants(a.id)[0].meal_price,5000);assert.equal(s.restaurants(b.id).length,0);
    assert.throws(()=>s.saveRestaurant({...input,siteId:b.id},restaurant.id),/현장/);assert.throws(()=>s.saveRestaurant({...input,mealPrice:'-1'},restaurant.id),/식비/);
    assert.equal(s.restaurants(a.id)[0].meal_price,5000);assert.equal(s.saveRestaurant({...input,name:'수정 식당'},restaurant.id).name,'수정 식당');
  }finally{s.close();}
});

test('가상 공지는 지정 현장과 날짜에 게시되고 이력을 원자적으로 기록한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),one=worker(a.id),other=worker(b.id),input={siteId:a.id,type:'notice',title:'가상 공지',body:'가상 내용',date:'2026-10-30'},doc=s.createDocument(input);
    assert.deepEqual(s.workerNotices(one.id,'2026-10-30'),[]);assert.equal(s.publishNotice(doc.id).status,'approved');assert.deepEqual(s.events(doc.id).map(e=>e.action),['publish']);
    assert.deepEqual(s.workerNotices(one.id,'2026-10-30').map(d=>d.id),[doc.id]);assert.deepEqual(s.workerNotices(one.id,'2026-10-29'),[]);assert.deepEqual(s.workerNotices(other.id,'2026-10-30'),[]);assert.throws(()=>s.publishNotice(doc.id),/임시저장/);
    const empty=s.createDocument({...input,body:''});assert.throws(()=>s.publishNotice(empty.id),/내용/);const tbm=s.createDocument({...input,type:'tbm'});assert.throws(()=>s.publishNotice(tbm.id),/공지/);
    const reviewer=s.createReviewer({siteId:a.id,loginId:'notice_review',name:'가상 결재자',password:'virtual-password-123'}),reviewed=s.createDocument(input);s.setApprovalLine(reviewed.id,[reviewer.id]);assert.throws(()=>s.publishNotice(reviewed.id),/결재선/);assert.equal(s.document(reviewed.id).status,'draft');
    const failing=s.createDocument(input);s.db.exec("CREATE TRIGGER fail_notice_publish BEFORE INSERT ON events WHEN NEW.action='publish' BEGIN SELECT RAISE(ABORT,'시험 오류'); END");assert.throws(()=>s.publishNotice(failing.id),/시험 오류/);assert.equal(s.document(failing.id).status,'draft');assert.deepEqual(s.events(failing.id),[]);
  }finally{s.close();}
});

test('이전 공지 첨부는 같은 현장의 게시 문서에서 원자적으로 복사한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,date,type='notice')=>s.createDocument({siteId,type,title:'가상 공지',date,body:'가상 내용'}),source=make(site.id,'2026-10-28'),target=make(site.id,'2026-10-29'),foreign=make(other.id,'2026-10-28'),future=make(site.id,'2026-10-30'),draft=make(site.id,'2026-10-27');
    s.addAttachment(source.id,'첫 번째.txt',Buffer.from('첫 내용'));s.addAttachment(source.id,'두 번째.txt',Buffer.from('둘 내용'));s.addAttachment(foreign.id,'다른.txt',Buffer.from('다른 내용'));for(const d of [source,foreign,future])s.publishNotice(d.id);
    for(const d of [foreign,future,draft,target])assert.throws(()=>s.copyNoticeAttachments(target.id,d.id),/이전 게시/);
    assert.throws(()=>s.copyNoticeAttachments(target.id,'1'),/이전 게시/);assert.deepEqual(s.attachments(target.id),[]);
    s.db.exec("CREATE TRIGGER fail_copy BEFORE INSERT ON attachments WHEN NEW.name='두 번째.txt' BEGIN SELECT RAISE(ABORT,'복사 실패'); END");assert.throws(()=>s.copyNoticeAttachments(target.id,source.id),/복사 실패/);assert.deepEqual(s.attachments(target.id),[]);s.db.exec('DROP TRIGGER fail_copy');
    assert.equal(s.copyNoticeAttachments(target.id,source.id).copied,2);const copied=s.attachments(target.id);assert.deepEqual(copied.map(f=>f.name),['첫 번째.txt','두 번째.txt']);assert.equal(Buffer.from(s.attachment(copied[0].id).data).toString(),'첫 내용');assert.equal(s.attachments(source.id).length,2);
    for(let i=0;i<17;i++)s.addAttachment(target.id,`가상${i}.txt`,Buffer.from('가상'));assert.throws(()=>s.copyNoticeAttachments(target.id,source.id),/20개/);assert.equal(s.attachments(target.id).length,19);s.publishNotice(target.id);assert.throws(()=>s.copyNoticeAttachments(target.id,source.id),/수정 가능한/);
  }finally{s.close();}
});

test('공지 확인 명단은 공지일 출역 당시의 직종을 표시한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'},worker=s.createWorker(input),doc=s.createDocument({siteId:site.id,type:'notice',title:'가상 공지',date:'2026-10-29',body:'가상 내용'}),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    s.setAttendance({siteId:site.id,workerId:worker.id,date:doc.date,present:true});s.publishNotice(doc.id);s.confirmWorkerNotice(worker.id,doc.id,signature,doc.date);s.updateWorker(worker.id,{...input,occupation:'전기'});
    assert.equal(s.noticeReads(doc.id)[0].attendance_occupation,'목공');s.db.prepare('UPDATE attendance SET occupation_snapshot=NULL WHERE worker_id=? AND date=?').run(worker.id,doc.date);assert.equal(s.noticeReads(doc.id)[0].attendance_occupation,null);
  }finally{s.close();}
});

test('주간 활동은 7일과 현장을 제한하고 문서·가상 확인을 날짜별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:a.id,workerId:worker.id,date:'2024-02-29',present:true});const add=(siteId,date,type)=>s.createDocument({siteId,date,type,title:'가상 문서'}),notice=add(a.id,'2024-02-29','notice'),tbm=add(a.id,'2024-03-01','tbm');add(b.id,'2024-02-29','notice');for(const doc of [notice,tbm]){s.transition(doc.id,'submit');s.transition(doc.id,'approve');}const png=new PNG({width:1,height:1});png.data[3]=255;s.confirmWorkerNotice(worker.id,notice.id,`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,'2024-02-29');s.confirmWorkerTraining(worker.id,tbm.id,'2024-03-01',true);const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows.length,7);assert.equal(rows[6].date,'2024-03-04');const leap=rows.find(r=>r.date==='2024-02-29');assert.equal(leap.attendance,1);assert.equal(leap.documents.notice,1);assert.equal(leap.noticeReads,1);assert.equal(rows.find(r=>r.date==='2024-03-01').trainingChecks,1);assert.equal(s.weeklyActivity(b.id,'2024-02-27').find(r=>r.date==='2024-02-29').noticeReads,0);assert.throws(()=>s.weeklyActivity(a.id,'2024-02-30'),/날짜/);}finally{s.close();}
});

test('주간 출역은 기록 당시 구분과 직종별 인일을 나눈다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-29',present:true});
    s.updateWorker(worker.id,{siteId:site.id,name:'가상 근로자',category:'외주',company:'가상 회사',occupation:'전기'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-03-01',present:true});
    const rows=s.weeklyActivity(site.id,'2024-02-27');assert.deepEqual(rows[2].attendanceCategories,[{label:'직영',days:1}]);assert.deepEqual(rows[2].attendanceOccupations,[{label:'목공',days:1}]);assert.deepEqual(rows[3].attendanceCategories,[{label:'외주',days:1}]);assert.deepEqual(rows[3].attendanceOccupations,[{label:'전기',days:1}]);
    for(const [group,key] of [['category','attendanceCategories'],['occupation','attendanceOccupations']]){const totals=new Map();for(const row of rows)for(const item of row[key])totals.set(item.label,(totals.get(item.label)||0)+item.days);assert.deepEqual(s.attendanceReport(site.id,rows[0].date,rows.at(-1).date,group).map(item=>[item.label,item.days]).sort(),[...totals].sort());}
    s.db.prepare("UPDATE attendance SET category_snapshot=NULL,occupation_snapshot=NULL WHERE date='2024-02-29'").run();assert.equal(s.weeklyActivity(site.id,'2024-02-27')[2].attendanceCategories[0].label,'기록 없음');
  }finally{s.close();}
});

test('주간 위험 신고 건수는 현장과 현지 날짜로 제한된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={title:'가상 위험',body:'가상 내용',reporter:'가상 신고자'};
    const one=s.createHazardReport(a.id,input),other=s.createHazardReport(b.id,input),outside=s.createHazardReport(a.id,input);
    const set=s.db.prepare("UPDATE hazard_reports SET created_at=datetime(?,'utc') WHERE id=?");
    set.run('2024-02-29 12:00:00',one);set.run('2024-02-29 12:00:00',other);set.run('2024-03-06 12:00:00',outside);
    const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows[2].hazardReports,1);assert.equal(rows.reduce((sum,row)=>sum+row.hazardReports,0),1);assert.equal(s.weeklyActivity(b.id,'2024-02-27')[2].hazardReports,1);
  }finally{s.close();}
});

test('주간 활동은 TBM과 교육의 승인 문서별 확인을 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    for(const type of ['tbm','education']){const d=s.createDocument({siteId:site.id,date:'2024-02-29',type,title:'가상 교육'});s.transition(d.id,'submit');s.transition(d.id,'approve');s.confirmWorkerTraining(worker.id,d.id,'2024-02-29',true);}
    const day=s.weeklyActivity(site.id,'2024-02-27')[2];assert.deepEqual(day.trainingByType,{tbm:1,education:1});assert.equal(day.trainingChecks,2);assert.deepEqual(s.weeklyActivity(site.id,'2024-03-01')[0].trainingByType,{tbm:0,education:0});
  }finally{s.close();}
});

test('주간 활동의 자가점검은 현장과 날짜별로 분리된다',()=>{
  const s=new Store(':memory:');
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    s.createWorkerSelfCheck(worker.id,'2024-02-29',{equipment:true,sober:true,exercise:true,briefing:true},signature);
    s.saveManagerCheck(a.id,'2024-02-29',Array.from({length:3},()=>({answer:'O',note:''})),signature);
    s.saveManagerCheck(b.id,'2024-02-29',Array.from({length:3},()=>({answer:'O',note:''})),signature);
    const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows[2].workerChecks,1);assert.equal(rows[2].managerChecks,1);assert.equal(rows[1].workerChecks,0);assert.equal(s.weeklyActivity(b.id,'2024-02-27')[2].workerChecks,0);
  }finally{s.close();}
});

test('관리자 시험 휴무는 점검과 구분되고 같은 날짜에 중복 저장되지 않는다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),date='2024-02-29',image=new PNG({width:1,height:1});image.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(image).toString('base64')}`,answers=Array.from({length:3},()=>({answer:'O',note:''}));
    s.saveManagerDayOff(a.id,date);assert.equal(s.managerChecks(a.id)[0].kind,'day_off');assert.equal(s.managerChecks(a.id)[0].answers,null);assert.throws(()=>s.saveManagerDayOff(a.id,date),/이미/);assert.throws(()=>s.saveManagerCheck(a.id,date,answers,signature),/이미/);s.saveManagerCheck(b.id,date,answers,signature);assert.throws(()=>s.saveManagerDayOff(b.id,date),/이미/);assert.throws(()=>s.saveManagerDayOff(999,date),/현장/);assert.throws(()=>s.saveManagerDayOff(a.id,'2024-02-30'),/날짜/);
    const day=s.weeklyActivity(a.id,'2024-02-27')[2];assert.equal(day.managerChecks,0);assert.equal(day.managerDaysOff,1);assert.equal(s.weeklyActivity(b.id,'2024-02-27')[2].managerDaysOff,0);
  }finally{s.close();}
});

test('근로자 자가점검 답변은 새 기록에만 보존하고 이전 기록을 추정하지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-self-check-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 작업자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`,answers={equipment:true,sober:true,exercise:true,briefing:true};
    s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature) VALUES(?,?,?)').run(worker.id,'2026-10-28',bytes);s.db.exec('ALTER TABLE worker_self_checks DROP COLUMN answers');s.close();s=new Store(file);
    assert.equal(s.siteSelfChecks(site.id,'2026-10-28')[0].answers,null);s.createWorkerSelfCheck(worker.id,'2026-10-28',answers,signature);assert.equal(s.siteSelfChecks(site.id,'2026-10-28')[0].answers,null);
    assert.throws(()=>s.createWorkerSelfCheck(worker.id,'2026-10-29',{...answers,sober:false},signature),/네 항목/);s.createWorkerSelfCheck(worker.id,'2026-10-29',{...answers,extra:'무시'},signature);s.close();s=new Store(file);
    assert.deepEqual(s.siteSelfChecks(site.id,'2026-10-29')[0].answers,answers);assert.deepEqual(s.siteSelfChecks(other.id,'2026-10-29'),[]);assert.deepEqual(Buffer.from(s.selfCheckSignature(site.id,worker.id,'2026-10-29')),bytes);assert.equal(s.selfCheckSignature(other.id,worker.id,'2026-10-29'),null);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('근로자 안전활동은 현장과 본인별로 종류를 구분해 조회한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 A'}),otherSite=s.createSite({name:'가상 B'}),make=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),worker=make(site.id),other=make(site.id),foreign=make(otherSite.id),date='2026-10-29',png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    const add=(type,title,details={})=>s.createDocument({siteId:site.id,type,title,date,details}),approve=doc=>{s.transition(doc.id,'submit');s.transition(doc.id,'approve');};
    const tbm=add('tbm','가상 교육');approve(tbm);s.confirmWorkerTraining(worker.id,tbm.id,date,true);s.confirmDailyTraining(worker.id,date,['tbm'],true,signature);
    const notice=add('notice','가상 공지');approve(notice);s.confirmWorkerNotice(worker.id,notice.id,signature,date);s.createWorkerSelfCheck(worker.id,date,{equipment:true,sober:true,exercise:true,briefing:true},signature);s.createWorkerHazardReport(worker.id,{title:'가상 신고',body:'가상 내용'});
    const risk=add('risk','가상 평가');s.saveRiskActivity(risk.id,{kind:'meeting',date,place:'',host:'',participants:'',content:'가상',workerIds:[worker.id]});
    const plan=add('work_plan','가상 계획',{workers:[{workerId:worker.id,role:'운전원',training:'',qualification:''}]});approve(plan);
    const company=s.createCompany({siteId:site.id,name:'가상 업체',trade:'가상 공종'}),instruction=add('instruction','가상 지시',{companyId:company.id,recipientId:worker.id});approve(instruction);
    const rows=s.workerActivities(site.id,worker.id).items;assert.deepEqual([...new Set(rows.map(row=>row.kind))].sort(),['tbm','notice','checklist','hazard','risk','work_plan','instruction'].sort());assert.equal(rows.filter(row=>row.kind==='tbm').length,2);assert.equal(rows.find(row=>row.kind==='risk').detail,'시험 활동의 선택 명단');for(const [kind,doc] of [['notice',notice],['risk',risk],['work_plan',plan],['instruction',instruction]])assert.equal(rows.find(row=>row.kind===kind).document_id,doc.id);assert.equal(rows.find(row=>row.kind==='checklist').document_id,null);assert.equal(rows.find(row=>row.kind==='checklist').has_signature,1);assert.equal(rows.find(row=>row.kind==='tbm'&&row.title==='당일 종류별 확인').document_id,null);assert.equal(s.workerActivities(site.id,other.id).items.length,0);assert.equal(s.workerActivities(otherSite.id,foreign.id).items.length,0);assert.throws(()=>s.workerActivities(otherSite.id,worker.id),/현장/);assert.throws(()=>s.workerActivities(site.id,worker.id,['invalid']),/조건/);assert.throws(()=>s.workerActivities(site.id,worker.id,[],-1),/조건/);assert.deepEqual(s.workerActivities(site.id,worker.id,['notice']).items.map(row=>row.title),['가상 공지']);
    s.db.prepare('INSERT INTO worker_self_checks(worker_id,date) VALUES(?,?)').run(worker.id,'2026-10-28');assert.deepEqual(s.workerActivities(site.id,worker.id,['checklist']).items.map(row=>[row.date,row.has_signature]),[['2026-10-29',1],['2026-10-28',0]]);assert.equal(s.selfCheckSignature(site.id,worker.id,'2026-10-28'),null);assert.equal(s.selfCheckSignature(otherSite.id,worker.id,date),null);
    for(let i=0;i<105;i++){const day=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);s.confirmDailyTraining(worker.id,day,['education'],true);}const first=s.workerActivities(site.id,worker.id,['education']);assert.equal(first.items.length,100);assert.equal(first.nextOffset,100);const second=s.workerActivities(site.id,worker.id,['education'],first.nextOffset);assert.equal(second.items.length,5);assert.equal(second.nextOffset,null);assert.equal(new Set([...first.items,...second.items].map(row=>row.date)).size,105);
  }finally{s.close();}
});

test('교육 통계는 확인된 승인 문서만 현장·기간·근로자·종류별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),other=s.createWorker({siteId:b.id,name:'다른 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),add=(siteId,date,kind)=>s.createDocument({siteId,type:'education',title:'가상 교육',date,details:{kind}});for(const [siteId,w,date,kind] of [[a.id,worker,'2026-10-28','regular'],[a.id,worker,'2026-10-29','regular'],[a.id,worker,'2026-10-29','special'],[b.id,other,'2026-10-29','regular']]){const d=add(siteId,date,kind);s.transition(d.id,'submit');s.transition(d.id,'approve');s.confirmWorkerTraining(w.id,d.id,date,true);}add(a.id,'2026-10-29','regular');s.confirmDailyTraining(worker.id,'2026-10-29',['education'],true);s.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,equipment,profile) VALUES(?,?,?,?)').run(worker.id,'demo-v1','[]',JSON.stringify({birthDate:'1990-01-02'}));const rows=s.educationReport(a.id,'2026-10-01','2026-10-31');assert.equal(rows[0].birth_date,'1990-01-02');assert.equal(s.educationReport(b.id,'2026-10-01','2026-10-31')[0].birth_date,null);assert.deepEqual(rows.map(r=>[r.kind,r.count]),[['regular',2],['special',1]]);assert.deepEqual(rows[0].documents.map(d=>d.date).sort(),['2026-10-28','2026-10-29']);assert.equal(s.educationReport(a.id,'2026-10-29','2026-10-29').find(r=>r.kind==='regular').count,1);assert.throws(()=>s.educationReport(a.id,'2026-11-01','2026-10-01'),/시작일/);}finally{s.close();}
});

test('체크리스트 첨부가 변경되면 해당 문서의 시험 서명만 삭제한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29'},doc=s.createDocument(input),other=s.createDocument(input),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;s.saveChecklistSignature(doc.id,signature);s.saveChecklistSignature(other.id,signature);assert.throws(()=>s.addAttachment(doc.id,'../잘못된 파일',Buffer.from('가상')),/이름/);assert.ok(s.checklistSignature(doc.id));const id=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));assert.equal(s.checklistSignature(doc.id),null);assert.ok(s.checklistSignature(other.id));s.saveChecklistSignature(doc.id,signature);s.deleteAttachment(id);assert.equal(s.checklistSignature(doc.id),null);assert.ok(s.checklistSignature(other.id));}finally{s.close();}
});

test('체크리스트 시험 서명은 문서별로 저장되고 내용 수정 시 지워진다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29',details:{kind:'rain',answers:Array.from({length:7},()=>({answer:'O',note:''}))}},doc=s.createDocument(input),other=s.createDocument({...input,type:'tbm'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;assert.throws(()=>s.saveChecklistSignature(other.id,signature),/체크리스트/);assert.throws(()=>s.saveChecklistSignature(doc.id,'invalid'),/서명/);s.saveChecklistSignature(doc.id,signature);assert.deepEqual(Buffer.from(s.checklistSignature(doc.id).signature),bytes);s.updateDocument(doc.id,{...input,title:'수정된 점검'});assert.equal(s.checklistSignature(doc.id),null);s.saveChecklistSignature(doc.id,signature);s.transition(doc.id,'submit');assert.throws(()=>s.saveChecklistSignature(doc.id,signature),/체크리스트/);}finally{s.close();}
});

test('13시와 18시 시험 점검은 필수 답변과 해당없음 범위를 검증한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'});for(const [kind,length,required,na] of [['afternoon',7,6,4],['evening',10,9,4]]){const answers=Array.from({length},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29',details:{kind,answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);for(let i=0;i<required;i++)answers[i].answer=kind==='afternoon'&&i===0?'가상 인원':'O';answers[na].answer='해당없음';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');} }finally{s.close();}
});

test('07시 시험 체크리스트는 필수 인원과 선택 항목을 확인한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 일일 점검',date:'2026-10-29',details:{kind:'morning',answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);for(const i of [1,2,3,4,6])answers[i].answer='O';answers[0].answer='가상 공정 3명';answers[7].answer='가상 조치';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.equal(JSON.parse(s.document(doc.id).details).answers[7].answer,'가상 조치');}finally{s.close();}
});

test('07시 점검 사진은 해당 항목에 연결되고 점검 종류 변경을 보호한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2041-01-01',details:{kind:'morning',answers}},doc=s.createDocument(input),other=s.createDocument({...input,details:{kind:'rain',answers:answers.slice(0,7)}}),image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image);
    assert.throws(()=>s.addAttachment(other.id,'사진.png',bytes,'morning_hazard_photo'),/첨부 구분/);assert.throws(()=>s.addAttachment(doc.id,'사진.png',Buffer.from('bad'),'morning_hazard_photo'),/PNG/);
    const file=s.addAttachment(doc.id,'가상.png',bytes,'morning_hazard_photo');assert.equal(s.attachments(doc.id)[0].category,'morning_hazard_photo');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'rain',answers:answers.slice(0,7)}}),/사진/);assert.equal(JSON.parse(s.document(doc.id).details).kind,'morning');assert.deepEqual(Buffer.from(s.attachment(file).data),bytes);
    for(const i of [1,2,3,4,6])answers[i].answer='O';answers[0].answer='가상 공정';s.updateDocument(doc.id,input);s.transition(doc.id,'submit');assert.throws(()=>s.deleteAttachment(file),/첨부파일/);assert.equal(s.attachments(doc.id)[0].category,'morning_hazard_photo');
  }finally{s.close();}
});

test('우천시 시험 체크리스트는 필수 답변을 확인하고 이전 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:7},(_,i)=>({answer:i===0?'':'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 우천 점검',date:'2026-10-29',details:{kind:'rain',answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'rain',answers:answers.map((a,i)=>i===1?{...a,answer:'해당없음'}:a)}}),/답변/);answers[0].answer='X';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.equal(JSON.parse(s.document(doc.id).details).answers[0].answer,'X');}finally{s.close();}
});

test('강풍 대비 시험 점검은 아홉 판정과 첨부를 저장하고 제출 전 답변을 확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 기상 점검',date:'2026-10-29',details:{kind:'wind',answers}};
    answers[8].answer='';const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'wind',answers:answers.slice(0,8)}}),/문항/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'wind',answers:answers.map((a,i)=>i===0?{...a,answer:'알 수 없음'}:a)}}),/답변/);
    answers[0]={answer:'해당없음',note:' 가상 비고 '};answers[8].answer='X';s.updateDocument(doc.id,input);s.addAttachment(doc.id,'가상 사진.txt',Buffer.from('가상 첨부'));
    assert.equal(JSON.parse(s.document(doc.id).details).answers[0].note,'가상 비고');assert.equal(s.attachments(doc.id).length,1);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.throws(()=>s.updateDocument(doc.id,input),/수정/);
  }finally{s.close();}
});

test('계절별 시험 점검은 문항과 선택지를 검증하고 모든 답변을 요구한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    for(const [kind,length] of [['thaw',15],['heat',8],['cold',10]]){
      const answers=Array.from({length},()=>({answer:'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 계절 점검',date:'2041-01-01',details:{kind,answers}};
      answers[length-1].answer='';const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.slice(1)}}),/문항/);
      if(kind==='heat')for(const i of [0,1,3,4])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.map((a,j)=>j===i?{...a,answer:'해당없음'}:a)}}),/답변/);
      for(const i of kind==='heat'?[2,5,6,7]:[0,length-1])answers[i].answer='해당없음';
      s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.deepEqual(JSON.parse(s.document(doc.id).details).answers,answers);
    }
  }finally{s.close();}
});

test('기상·전기·화재 시험 점검은 문항 수와 판정 및 제출 조건을 확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    for(const [kind,length] of [['wet_season',6],['heavy_rain',11],['electrical',12],['fire',5],['formwork',7],['falling',8],['confined',4],['excavation',8]]){
      const answers=Array.from({length},()=>({answer:'해당없음',note:'가상 비고'}));if(kind==='heavy_rain')answers[0].answer='O';answers[length-1].answer='';
      const input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2041-01-01',details:{kind,answers}},doc=s.createDocument(input);
      assert.throws(()=>s.transition(doc.id,'submit'),/필수/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.slice(1)}}),/문항/);
      if(kind==='heavy_rain')assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.map((a,i)=>i===0?{...a,answer:'해당없음'}:a)}}),/답변/);
      answers[length-1].answer='X';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.deepEqual(JSON.parse(s.document(doc.id).details).answers,answers);
    }
  }finally{s.close();}
});

test('반기 시험 점검은 기본 정보와 일곱 판정 및 개선 내용을 검증한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:11},(_,i)=>({answer:[0,1,2,10].includes(i)?'가상 내용':'예',note:' 가상 비고 '})),input={siteId:site.id,type:'checklist',title:'가상 반기 점검',date:'2041-01-01',details:{kind:'semiannual',answers}},doc=s.createDocument(input);
    for(let i=0;i<11;i++){const changed=answers.map((a,j)=>j===i?{...a,answer:''}:a);s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:changed}});assert.throws(()=>s.transition(doc.id,'submit'),/필수/);}
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:answers.slice(1)}}),/문항/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:answers.map((a,i)=>i===3?{...a,answer:'O'}:a)}}),/답변/);
    answers[3].answer='아니오';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');const saved=JSON.parse(s.document(doc.id).details);assert.equal(saved.answers[3].answer,'아니오');assert.equal(saved.answers[0].note,'가상 비고');
  }finally{s.close();}
});

test('공유 기본 서류는 승인 뒤에만 다른 현장 목록에 표시한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={siteId:a.id,type:'basic',title:'공유 시험 서류',date:'2026-10-28',details:{category:'가상 분류',shared:true}},doc=s.createDocument(input),file=s.addAttachment(doc.id,'시험.txt',Buffer.from('가상 자료'));
    const found=()=>s.documents(b.id,'basic','시험');assert.equal(found().length,0);assert.equal(s.documents(a.id,'basic').length,1);s.transition(doc.id,'submit');assert.equal(found().length,0);s.transition(doc.id,'approve');assert.deepEqual(found().map(row=>row.id),[doc.id]);assert.equal(s.documents(b.id,'basic','','2026-10-29','2026-10-30').length,0);assert.equal(s.documents(b.id,'tbm').length,0);assert.throws(()=>s.documents(999,'basic'),/현장/);assert.deepEqual(Buffer.from(s.attachment(file).data),Buffer.from('가상 자료'));
    const local=s.createDocument({...input,title:'현장 전용',details:{category:'가상 분류',shared:false}});s.transition(local.id,'submit');s.transition(local.id,'approve');assert.deepEqual(s.documents(b.id,'basic').map(row=>row.id),[doc.id]);assert.throws(()=>s.createDocument({...input,details:{shared:'true'}}),/공유/);
  }finally{s.close();}
});

test('기본 서류 분류를 현장별로 저장하고 검색한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 현장 A'}),b=s.createSite({name:'가상 현장 B'}),input={siteId:a.id,type:'basic',title:'가상 서류',date:'2026-10-29',details:{category:'안전·보건 조직도'}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).category,'안전·보건 조직도');assert.equal(s.documents(a.id,'basic','조직도').length,1);assert.equal(s.documents(b.id,'basic','조직도').length,0);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{category:'가'.repeat(201)}}),/분류/);assert.equal(JSON.parse(s.document(doc.id).details).category,'안전·보건 조직도');}finally{s.close();}
});

test('안전 업무 일지 출역 수는 저장 시점에 보존되고 날짜 변경 시 다시 계산한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});const input={siteId:site.id,type:'safety_log',title:'가상 일지',date:'2026-10-29',details:{attendanceSnapshot:{present:999}}};const doc=s.createDocument(input),snapshot=JSON.parse(doc.details).attendanceSnapshot;assert.equal(snapshot.present,1);s.setAttendance({siteId:site.id,workerId:worker.id,date:input.date,present:false});assert.deepEqual(JSON.parse(s.updateDocument(doc.id,input).details).attendanceSnapshot,snapshot);assert.equal(JSON.parse(s.updateDocument(doc.id,{...input,date:'2026-10-30'}).details).attendanceSnapshot.present,0);}finally{s.close();}
});

test('안전 업무 일지는 현장과 날짜에 맞는 가상 자료를 조회한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-29',present:true});for(const [siteId,date,type] of [[a.id,'2026-10-29','notice'],[a.id,'2026-10-28','tbm'],[b.id,'2026-10-29','patrol']])s.createDocument({siteId,date,type,title:'가상 문서'});const sources=s.safetyLogSources(a.id,'2026-10-29');assert.equal(sources.present,1);assert.deepEqual(sources.documents.map(d=>d.type),['notice']);const input={siteId:a.id,type:'safety_log',date:'2026-10-29',title:'시험 일지',details:{todayWork:'가상 작업',inspectionKind:'장비점검'}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).todayWork,'가상 작업');assert.throws(()=>s.updateDocument(doc.id,{...input,details:{inspectionKind:'알 수 없음'}}),/종류/);assert.equal(JSON.parse(s.document(doc.id).details).inspectionKind,'장비점검');}finally{s.close();}
});

test('순회 점검 판정과 개선 지시를 저장하고 잘못된 판정을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-10-29',details:{instruction:'가상 지시',items:[{name:'가상 항목',result:'X',note:'가상 개선'}]}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).items[0].note,'가상 개선');assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{...input.details.items[0],result:'미확인'}]}}),/순회 점검/);assert.equal(JSON.parse(s.document(doc.id).details).items[0].result,'X');}finally{s.close();}
});

test('안전 점검 일지는 복수 점검과 활동을 보존하고 잘못된 시간을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'inspection',title:'시험 점검',date:'2026-10-29',details:{meeting:'가상 회의',instruction:'가상 지시',rows:[{inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'가상 상태',action:'가상 조치'},{inspector:'다른 점검자',hazard:'가상 상태 2'}]}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).rows.length,2);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,rows:[{...input.details.rows[0],timeTo:'09:03'}]}}),/점검시간/);assert.equal(JSON.parse(s.document(doc.id).details).instruction,'가상 지시');}finally{s.close();}
});

test('이전 안전 점검 조회는 현장과 작성일을 제한하고 현재 문서를 제외한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),add=(siteId,date,type,title)=>s.createDocument({siteId,date,type,title,details:type==='inspection'?{meeting:'가상 회의',rows:[{inspector:'가상 점검자',hazard:'가상 상태'}]}:{}}),old=add(site.id,'2026-10-27','inspection','이전 점검'),recent=add(site.id,'2026-10-28','inspection','최근 점검');add(site.id,'2026-10-29','inspection','당일 점검');add(site.id,'2026-10-26','patrol','다른 문서');add(other.id,'2026-10-28','inspection','다른 현장');
    const rows=s.previousInspections(site.id,'2026-10-29');assert.deepEqual(rows.map(row=>row.id),[recent.id,old.id]);assert.equal(JSON.parse(rows[0].details).meeting,'가상 회의');assert.deepEqual(s.previousInspections(site.id,'2026-10-29',recent.id).map(row=>row.id),[old.id]);assert.deepEqual(s.previousInspections(site.id,'2026-10-27'),[]);assert.throws(()=>s.previousInspections(site.id,'2026-02-30'),/날짜/);
  }finally{s.close();}
});

test('합동 안전점검은 판정과 출역자를 검증하고 잘못된 수정을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});
    const input={siteId:site.id,type:'joint_inspection',title:'가상 점검',date:'2026-10-29',details:{improvements:'가상 보완',result:'가상 조치',workerIds:[worker.id],items:[{name:'가상 항목',result:'보완사항'}]}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).items[0].result,'보완사항');
    assert.equal(s.previousJointInspection(site.id,'2026-10-30').date,'2026-10-29');assert.equal(s.previousJointInspection(site.id,'2026-10-29'),null);assert.equal(s.previousJointInspection(s.createSite({name:'다른 현장'}).id,'2026-10-30'),null);assert.throws(()=>s.previousJointInspection(site.id,'2026-02-30'),/날짜/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{name:'가상 항목',result:'미확인'}]}}),/점검 항목/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,date:'2026-10-30'}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).workerSnapshot[0].id,worker.id);
  }finally{s.close();}
});

test('합동 점검은 가상 관리자를 근로자와 구분하고 선택 당시 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,name,category)=>s.createWorker({siteId,name,category,company:'가상 업체',occupation:'가상 직종'}),manager=make(site.id,'가상 관리자','현장관리자'),worker=make(site.id,'가상 근로자','직영'),foreign=make(other.id,'다른 관리자','현장관리자'),date='2026-10-29';
    s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});const input={siteId:site.id,type:'joint_inspection',title:'가상 점검',date,details:{managerIds:[manager.id],workerIds:[worker.id],items:[]}},doc=s.createDocument(input);let details=JSON.parse(doc.details);assert.equal(details.managerSnapshot[0].name,'가상 관리자');assert.equal(details.workerSnapshot[0].id,worker.id);
    assert.throws(()=>s.createDocument({...input,details:{...input.details,managerIds:[foreign.id]}}),/현장/);assert.throws(()=>s.createDocument({...input,details:{...input.details,managerIds:[worker.id]}}),/관리자/);assert.throws(()=>s.createDocument({...input,details:{...input.details,managerIds:[manager.id,manager.id]}}),/관리자/);
    s.updateWorker(manager.id,{siteId:site.id,name:'변경 이름',category:'직영',company:'변경 업체',occupation:'가상 직종'});s.updateDocument(doc.id,input);details=JSON.parse(s.document(doc.id).details);assert.equal(details.managerSnapshot[0].name,'가상 관리자');
    const {managerIds,...withoutManagers}=input.details;s.updateDocument(doc.id,{...input,details:withoutManagers});assert.equal(JSON.parse(s.document(doc.id).details).managerSnapshot[0].name,'가상 관리자');
    s.transition(doc.id,'submit');const submitted=s.document(doc.id),snapshot=s.approvalCycle(doc.id,submitted.approval_cycle_id);assert.equal(JSON.parse(snapshot.document.details).managerSnapshot[0].name,'가상 관리자');
  }finally{s.close();}
});

test('합동 점검 시험 서명은 변경 시 삭제되고 결재 요청 당시 사본이 보존된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'joint_inspection',title:'가상 점검',date:'2026-10-29',details:{items:[]}},doc=s.createDocument(input),other=s.createDocument(input),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    assert.throws(()=>s.saveJointSignature(doc.id,'invalid'),/서명/);s.saveJointSignature(doc.id,signature);s.saveJointSignature(other.id,signature);
    const file=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));assert.equal(s.jointSignature(doc.id),null);assert.ok(s.jointSignature(other.id));s.saveJointSignature(doc.id,signature);s.deleteAttachment(file);assert.equal(s.jointSignature(doc.id),null);
    s.saveJointSignature(doc.id,signature);s.updateDocument(doc.id,{...input,title:'수정된 점검'});assert.equal(s.jointSignature(doc.id),null);s.saveJointSignature(doc.id,signature);s.transition(doc.id,'submit');
    const submitted=s.document(doc.id),cycle=submitted.approval_cycle_id;assert.equal(s.reviewerPayload(submitted).linked.authorSignature,true);assert.deepEqual(Buffer.from(s.reviewerLinkedSignature(submitted,'author',0)),bytes);assert.throws(()=>s.saveJointSignature(doc.id,signature),/수정/);
    s.transition(doc.id,'withdraw');s.updateDocument(doc.id,input);assert.equal(s.jointSignature(doc.id),null);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'author-signature',0,0).data),bytes);s.transition(doc.id,'submit');assert.equal(s.reviewerPayload(s.document(doc.id)).linked.authorSignature,false);
  }finally{s.close();}
});

test('합동 점검 가상 예시 64개를 문서에 저장하고 판정을 수정한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),items=jointExamples('civil',0),input={siteId:site.id,type:'joint_inspection',title:'가상 점검',date:'2026-10-29',details:{items}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).items.length,64);
    items[0].result='보완사항';s.updateDocument(doc.id,input);const stored=JSON.parse(s.document(doc.id).details).items;assert.equal(stored[0].result,'보완사항');assert.equal(stored[1].result,'N/A');
    assert.deepEqual(JSON.parse(s.previousJointInspection(site.id,'2026-10-30').items),stored);
  }finally{s.close();}
});

test('노사협의체 회의 안건과 출역자를 현장별로 저장한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),foreign=s.createWorker({siteId:other.id,name:'다른 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});
    const input={siteId:site.id,type:'work_council',title:'가상 주제',date:'2026-10-29',details:{kind:'정기 회의',host:'가상 주관',decisions:'가상 의결',discussion:'가상 협의',workerIds:[worker.id],timeFrom:'09:00',timeTo:'10:00'}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).decisions,'가상 의결');assert.equal(JSON.parse(doc.details).workerSnapshot[0].id,worker.id);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,kind:'알 수 없음'}}),/종류/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,workerIds:[foreign.id]}}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).discussion,'가상 협의');
  }finally{s.close();}
});

test('회의 참가 시험 서명은 승인된 지정 근로자만 기록한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),worker=make(site.id,'가상 근로자'),stranger=make(site.id,'다른 근로자'),foreign=make(other.id,'다른 현장');
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    for(const type of ['work_council','safety_meeting']){
      const doc=s.createDocument({siteId:site.id,type,title:'가상 회의',body:'가상 내용',date:'2026-10-29',details:{...(type==='work_council'?{kind:'정기 회의',decisions:'가상 의결',discussion:'가상 협의'}:{}),remarks:'가상 비고',workerIds:[worker.id]}}),file=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 첨부'));assert.equal(s.workerMeetingAttachment(worker.id,doc.id,file),null);assert.throws(()=>s.confirmWorkerMeeting(worker.id,doc.id,signature),/승인/);s.transition(doc.id,'submit');s.transition(doc.id,'approve');
      assert.equal(s.workerMeetings(worker.id).find(row=>row.id===doc.id).body,'가상 내용');assert.deepEqual(s.workerMeetings(worker.id).find(row=>row.id===doc.id).files,[{id:Number(file),name:'가상.txt',size:Buffer.byteLength('가상 첨부')}]);assert.equal(Buffer.from(s.workerMeetingAttachment(worker.id,doc.id,file).data).toString(),'가상 첨부');assert.equal(s.workerMeetingAttachment(stranger.id,doc.id,file),null);assert.equal(s.workerMeetingAttachment(foreign.id,doc.id,file),null);assert.equal(s.workerMeetingAttachment(worker.id,doc.id,99999),null);assert.equal(s.workerMeetings(stranger.id).length,0);assert.equal(s.workerMeetings(foreign.id).length,0);assert.throws(()=>s.confirmWorkerMeeting(stranger.id,doc.id,signature),/승인/);assert.throws(()=>s.confirmWorkerMeeting(foreign.id,doc.id,signature),/승인/);assert.throws(()=>s.confirmWorkerMeeting(worker.id,doc.id,'invalid'),/서명/);
      const shown=s.workerMeetings(worker.id).find(row=>row.id===doc.id);assert.equal(shown.details.remarks,'가상 비고');assert.equal(shown.details.kind,type==='work_council'?'정기 회의':'');assert.equal(shown.details.discussion,type==='work_council'?'가상 협의':'');assert.equal(shown.details.workerSnapshot,undefined);
      s.confirmWorkerMeeting(worker.id,doc.id,signature);s.confirmWorkerMeeting(worker.id,doc.id,signature);assert.equal(s.meetingChecks(doc.id).length,1);assert.equal(s.meetingChecks(doc.id)[0].worker_id,worker.id);assert.deepEqual(Buffer.from(s.meetingWorkerSignature(doc.id,worker.id)),bytes);assert.equal(s.meetingWorkerSignature(doc.id,stranger.id),null);assert.ok(s.workerMeetings(worker.id).find(row=>row.id===doc.id).created_at);
    }
  }finally{s.close();}
});

test('회의 작성자 시험 서명은 문서 변경 시 초기화하고 결재 요청 때 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    for(const type of ['work_council','safety_meeting']){
      const input={siteId:site.id,type,title:'가상 회의',date:'2026-10-29',details:type==='work_council'?{kind:'정기 회의'}:{}},doc=s.createDocument(input);assert.throws(()=>s.saveMeetingSignature(doc.id,'invalid'),/서명/);
      s.saveMeetingSignature(doc.id,signature);assert.deepEqual(Buffer.from(s.meetingSignature(doc.id).signature),bytes);const file=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));assert.equal(s.meetingSignature(doc.id),null);
      s.saveMeetingSignature(doc.id,signature);s.deleteAttachment(file);assert.equal(s.meetingSignature(doc.id),null);s.saveMeetingSignature(doc.id,signature);s.updateDocument(doc.id,input);assert.equal(s.meetingSignature(doc.id),null);
      s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');const frozen=s.document(doc.id),cycle=frozen.approval_cycle_id;assert.equal(s.reviewerPayload(frozen).linked.authorSignature,true);assert.deepEqual(Buffer.from(s.reviewerLinkedSignature(frozen,'author',0)),bytes);assert.throws(()=>s.saveMeetingSignature(doc.id,signature),/수정/);
      s.transition(doc.id,'withdraw');s.updateDocument(doc.id,input);assert.equal(s.meetingSignature(doc.id),null);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'author-signature',0,0).data),bytes);s.transition(doc.id,'submit');assert.equal(s.reviewerPayload(s.document(doc.id)).linked.authorSignature,false);
    }
    const other=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29'});assert.throws(()=>s.saveMeetingSignature(other.id,signature),/회의/);
  }finally{s.close();}
});

test('회의 사용자 측 관리자 선택은 현장과 당시 명부를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,name,category='현장관리자')=>s.createWorker({siteId,name,category,company:'가상 업체',occupation:'가상 직종'}),manager=make(site.id,'가상 관리자'),foreign=make(other.id,'다른 현장 관리자'),worker=make(site.id,'가상 근로자','직영');
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});
    for(const type of ['work_council','safety_meeting']){
      const input={siteId:site.id,type,title:'가상 회의',date:'2026-10-29',details:{...(type==='work_council'?{kind:'정기 회의'}:{}),managerIds:[manager.id],workerIds:[worker.id],employerParticipants:['직접 입력']}};
      const doc=s.createDocument(input),stored=JSON.parse(doc.details);assert.equal(stored.managerSnapshot[0].name,'가상 관리자');assert.deepEqual(stored.employerParticipants,['직접 입력']);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,managerIds:[foreign.id]}}),/현장관리자/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,managerIds:[worker.id]}}),/참석자/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,managerIds:[manager.id,manager.id]}}),/참석자/);
      s.updateWorker(manager.id,{siteId:site.id,name:'이름 변경',category:'직영',company:'변경 업체',occupation:'변경 직종'});s.updateDocument(doc.id,input);assert.equal(JSON.parse(s.document(doc.id).details).managerSnapshot[0].name,'가상 관리자');s.updateWorker(manager.id,{siteId:site.id,name:'가상 관리자',category:'현장관리자',company:'가상 업체',occupation:'가상 직종'});
      const {managerIds,...withoutManagers}=input.details;s.updateDocument(doc.id,{...input,details:withoutManagers});assert.equal(JSON.parse(s.document(doc.id).details).managerSnapshot[0].id,manager.id);
      s.updateDocument(doc.id,{...input,details:{...input.details,managerIds:[]}});assert.deepEqual(JSON.parse(s.document(doc.id).details).managerSnapshot,[]);
    }
  }finally{s.close();}
});

test('회의별 사용자 측 가상 참석자는 입력을 검증하고 저장한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    for(const type of ['work_council','safety_meeting']){
      const input={siteId:site.id,type,title:'가상 회의',date:'2026-10-29',details:{...(type==='work_council'?{kind:'정기 회의'}:{}),employerParticipants:['  가상 담당자  ','가상 관리자']}};
      const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details).employerParticipants,['가상 담당자','가상 관리자']);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,employerParticipants:['가'.repeat(201)]}}),/참석자/);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,employerParticipants:'가상 담당자'}}),/참석자/);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,employerParticipants:Array(101).fill('가상')}}),/참석자/);
      assert.deepEqual(JSON.parse(s.document(doc.id).details).employerParticipants,['가상 담당자','가상 관리자']);
    }
  }finally{s.close();}
});

test('안전간담회는 해당 날짜의 출역자를 선택하고 기존 참석자 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),input={siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'};
    const worker=s.createWorker(input),foreign=s.createWorker({...input,siteId:other.id});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-28',present:true});
    const meeting={siteId:site.id,type:'safety_meeting',title:'가상 회의',date:'2026-10-28',details:{place:'가상 장소',timeFrom:'23:55',timeTo:'24:00',workerIds:[worker.id]}};
    const doc=s.createDocument(meeting);assert.equal(JSON.parse(doc.details).workerSnapshot[0].name,'가상 근로자');
    assert.throws(()=>s.createDocument({...meeting,details:{...meeting.details,workerIds:[foreign.id]}}),/출역자/);
    assert.throws(()=>s.createDocument({...meeting,details:{...meeting.details,timeFrom:'23:56'}}),/회의시간/);
    s.updateWorker(worker.id,{...input,name:'수정된 이름'});s.setAttendance({siteId:site.id,workerId:worker.id,date:meeting.date,present:false});
    assert.equal(JSON.parse(s.updateDocument(doc.id,meeting).details).workerSnapshot[0].name,'가상 근로자');
    assert.throws(()=>s.updateDocument(doc.id,{...meeting,date:'2026-10-29'}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).workerSnapshot[0].name,'가상 근로자');
  }finally{s.close();}
});

test('장비는 선택한 현장에 저장되고 다른 현장에 표시되지 않는다',()=>{
  const s=new Store(':memory:');
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const item=s.createEquipment({siteId:a.id,kind:'굴착기',model:'가상 모델',capacity:'가상 용량',manufacturer:'가상 제조사',registration:'가상 번호'});
    assert.equal(s.equipment(a.id)[0].id,item.id);assert.deepEqual(s.equipment(b.id),[]);
    const bytes=Buffer.from('가상 증빙'),file=s.addEquipmentAttachment(a.id,item.id,'insurance','가상.txt',bytes);
    assert.equal(s.equipmentAttachments(a.id,item.id)[0].category,'insurance');assert.deepEqual(Buffer.from(s.equipmentAttachment(a.id,item.id,file).data),bytes);
    assert.equal(s.equipmentAttachment(b.id,item.id,file),null);assert.throws(()=>s.addEquipmentAttachment(b.id,item.id,'insurance','가상.txt',bytes),/현장/);
    assert.throws(()=>s.addEquipmentAttachment(a.id,item.id,'bad','가상.txt',bytes),/종류/);assert.throws(()=>s.addEquipmentAttachment(a.id,item.id,'other','../가상.txt',bytes),/이름/);
    s.deleteEquipmentAttachment(a.id,item.id,file);assert.equal(s.equipmentAttachments(a.id,item.id).length,0);
    const input={siteId:a.id,kind:'굴착기',model:'가상 모델',capacity:'가상',manufacturer:'가상',registration:'가상',owner:'가상 소유주',insuranceFrom:'2026-01-01',insuranceTo:'2026-12-31',inspectionFrom:'2026-02-01',inspectionTo:'2026-08-01'};
    assert.equal(JSON.parse(s.updateEquipment(item.id,input).details).owner,'가상 소유주');
    assert.throws(()=>s.updateEquipment(item.id,{...input,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateEquipment(item.id,{...input,insuranceTo:'2025-01-01'}),/기간/);
    assert.equal(JSON.parse(s.equipment(a.id)[0].details).insuranceTo,'2026-12-31');
    assert.throws(()=>s.createEquipment({siteId:999,kind:'굴착기',model:'모델',capacity:'',manufacturer:'',registration:''}),/현장/);
    assert.throws(()=>s.createEquipment({siteId:a.id,kind:'',model:'모델',capacity:'',manufacturer:'',registration:''}),/장비/);
  }finally{s.close();}
});

test('작업장소의 현장과 지형을 검증하고 같은 현장 계획서에 연결한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'가상 보강',obstacles:'',protection:'가상 보호'};
    const place=s.createWorkPlace({siteId:a.id,name:'가상 장소',work:area,route:area});assert.equal(s.workPlaces(b.id).length,0);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:{...area,ground:'알 수 없음'},route:area}),/지형/);
    const detailed={...area,reinforcementChoices:['철판설치','지반개량'],workerProtection:['유도자 배치','라바콘'],workerProtectionExtra:'추가 시설'};
    const saved=s.createWorkPlace({siteId:a.id,name:'상세 가상 장소',work:detailed,route:detailed,additional:[{label:'가상 항목',value:'가상 내용'}]});
    assert.deepEqual(JSON.parse(saved.details).work.workerProtection,detailed.workerProtection);
    assert.deepEqual(JSON.parse(saved.details).additional,[{label:'가상 항목',value:'가상 내용'}]);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:area,route:area,additional:[{label:'',value:'내용'}]}),/추가정보/);
    assert.equal(JSON.parse(saved.details).route.workerProtectionExtra,'추가 시설');
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:{...area,obstacleChoices:['미확인']},route:area}),/선택 항목/);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:area,route:{...area,equipmentProtection:['신호수 배치']}}),/선택 항목/);
    const png=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addWorkPlacePhoto(a.id,place.id,'가상.png',png);
    assert.equal(s.workPlacePhotos(a.id,place.id).length,1);assert.deepEqual(Buffer.from(s.workPlacePhoto(a.id,place.id,photoId).data),png);
    assert.equal(s.workPlacePhoto(b.id,place.id,photoId),null);assert.throws(()=>s.workPlacePhotos(b.id,place.id),/현장/);
    assert.throws(()=>s.addWorkPlacePhoto(a.id,place.id,'가상.png',Buffer.from('not image')),/PNG/);
    assert.throws(()=>s.deleteWorkPlacePhoto(b.id,place.id,photoId),/사진/);s.deleteWorkPlacePhoto(a.id,place.id,photoId);assert.equal(s.workPlacePhotos(a.id,place.id).length,0);
    const base={siteId:a.id,type:'work_plan',title:'가상 계획',date:'2026-10-28'};
    assert.equal(JSON.parse(s.createDocument({...base,details:{workPlaceId:place.id}}).details).workPlaceId,place.id);
    assert.throws(()=>s.createDocument({...base,siteId:b.id,details:{workPlaceId:place.id}}),/현장/);
  }finally{s.close();}
});

test('줄걸이와 체결장구를 현장별로 저장하고 입력을 검증한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const input={siteId:a.id,category:'줄걸이',kind:'가상 와이어',name:'가상 장구',standards:['가상 규격 1','가상 규격 2'],additional:[{label:'항목',value:'내용'}],spec:'가상 제원'};
    const item=s.createRigging(input);assert.deepEqual(JSON.parse(item.details).standards,input.standards);assert.equal(s.rigging(a.id).length,1);assert.equal(s.rigging(b.id).length,0);
    const photo=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addRiggingPhoto(a.id,item.id,'가상.png',photo);
    assert.deepEqual(Buffer.from(s.riggingPhoto(a.id,item.id,photoId).data),photo);assert.equal(s.riggingPhoto(b.id,item.id,photoId),null);
    assert.throws(()=>s.addRiggingPhoto(a.id,item.id,'가상.png',Buffer.from('bad')),/PNG/);assert.throws(()=>s.deleteRiggingPhoto(b.id,item.id,photoId),/사진/);
    s.deleteRiggingPhoto(a.id,item.id,photoId);assert.equal(s.riggingPhotos(a.id,item.id).length,0);
    assert.equal(s.createRigging({...input,name:'수정된 장구'},item.id).name,'수정된 장구');
    assert.throws(()=>s.createRigging({...input,siteId:b.id},item.id),/현장/);
    assert.throws(()=>s.createRigging({...input,standards:['']},item.id),/규격/);assert.equal(s.rigging(a.id)[0].name,'수정된 장구');
    assert.throws(()=>s.createRigging({...input,category:'기타'}),/구분/);assert.throws(()=>s.createRigging({...input,siteId:999}),/현장/);assert.throws(()=>s.createRigging({...input,standards:['']}),/규격/);
    const plan={siteId:a.id,type:'work_plan',title:'가상 작업',date:'2026-10-29',details:{riggingIds:[item.id]}};
    const doc=s.createDocument(plan);assert.deepEqual(JSON.parse(doc.details).riggingIds,[item.id]);
    assert.throws(()=>s.createRigging(input,item.id),/연결된 장구/);
    assert.throws(()=>s.createDocument({...plan,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...plan,details:{riggingIds:[item.id,item.id]}}),/장구/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).riggingIds,[item.id]);
  }finally{s.close();}
});

test('협력사는 현장별로 등록·수정되고 다른 현장에서 수정할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const company=s.createCompany({siteId:a.id,name:'가상 협력사',trade:'토목'});
    assert.equal(s.companies(a.id).length,1);
    assert.equal(s.companies(b.id).length,0);
    assert.throws(()=>s.updateCompany(company.id,{siteId:b.id,name:'변경',trade:'건축'}),/현장/);
    assert.throws(()=>s.createCompany({siteId:a.id,name:'',trade:'토목'}),/회사명/);
    assert.equal(s.updateCompany(company.id,{siteId:a.id,name:'가상 협력사',trade:'건축'}).trade,'건축');
    assert.equal(s.companies(a.id)[0].name,'가상 협력사');
  } finally {s.close();}
});

test('안전관리비는 정수 원 단위로 계산하고 현장과 월별로 합산한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={siteId:a.id,category:'2',date:'2026-10-20',description:'가상 시설',note:'',unitPrice:'1200',quantity:'1.250',unit:'개'};
    assert.equal(s.createSafetyCost(input).amount,'1500');s.createSafetyCost({...input,date:'2026-10-21',unitPrice:'999999999000',quantity:'99999999.999'});
    const cost=s.createSafetyCost({...input,siteId:b.id});s.createSafetyCost({...input,date:'2026-11-01'});
    const png=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addSafetyCostPhoto(b.id,cost.id,'가상.png',png);
    assert.equal(s.safetyCostPhoto(a.id,cost.id,photoId),null);assert.throws(()=>s.addSafetyCostPhoto(b.id,cost.id,'가상.png',Buffer.from('bad')),/PNG/);
    const result=s.safetyCosts(a.id,'2026-10');assert.equal(result.rows.length,2);assert.equal(result.total,(1500n+999999999000n*99999999999n/1000n).toString());
    assert.equal(s.safetyCosts(b.id,'2026-10').total,'1500');assert.throws(()=>s.createSafetyCost({...input,unitPrice:'1',quantity:'0.5'}),/원 단위/);
    assert.throws(()=>s.createSafetyCost({...input,category:'10'}),/항목/);assert.throws(()=>s.safetyCosts(a.id,'2026-13'),/월/);
    const reportInput={siteId:b.id,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1500',progress:'50'};
    const doc=s.createSafetyCostReport(reportInput),details=JSON.parse(doc.details);assert.equal(details.total,'1500');assert.equal(details.categoryTotals[1],'1500');
    const reportPhoto=s.safetyCostReportPhotos(doc.id)[0];s.deleteSafetyCostPhoto(b.id,cost.id,photoId);assert.deepEqual(Buffer.from(s.safetyCostReportPhoto(doc.id,reportPhoto.id).data),png);
    s.createSafetyCost({...input,siteId:b.id});assert.equal(s.safetyCosts(b.id,'2026-10').total,'3000');assert.equal(JSON.parse(s.document(doc.id).details).total,'1500');
    assert.throws(()=>s.updateDocument(doc.id,{siteId:b.id,type:'cost',date:'2026-10-29',title:'변경'}),/보존/);
    assert.throws(()=>s.createSafetyCostReport({...reportInput,month:'2026-09'}),/사용내역/);assert.throws(()=>s.createSafetyCostReport({...reportInput,progress:'101'}),/공정률/);
  }finally{s.close();}
});

test('작업지시서의 수신 협력사는 현장별로 검증되고 이름이 보존된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),company=s.createCompany({siteId:a.id,name:'가상 협력사',trade:'가상 공종'});
    const input={siteId:a.id,type:'instruction',title:'가상 지시',date:'2026-10-29',body:'시험 지시사항',details:{companyId:company.id,recipient:'가상 담당자',companyName:'위조'}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).companyName,'가상 협력사');
    const worker=s.createWorker({siteId:a.id,name:'가상 출입자',category:'가상',company:'가상 협력사',occupation:'가상 직종'}),other=s.createWorker({siteId:a.id,name:'다른 소속',category:'가상',company:'다른 업체',occupation:'가상 직종'});
    const linked=s.createDocument({...input,details:{companyId:company.id,recipientId:worker.id,recipient:'위조'}});assert.equal(JSON.parse(linked.details).recipient,'가상 출입자');
    assert.equal(s.workerInstructions(worker.id).length,0);s.transition(linked.id,'submit');s.transition(linked.id,'approve');
    assert.equal(s.workerInstructions(other.id).length,0);assert.throws(()=>s.respondInstruction(other.id,linked.id,{date:'2026-10-30',content:'가상 조치'}),/지정/);
    assert.throws(()=>s.workerInstructionAttachments(other.id,linked.id),/지정/);
    assert.equal(s.respondInstruction(worker.id,linked.id,{date:'2026-10-30',content:'가상 조치',actor:'위조'}).actor,'가상 출입자');assert.equal(s.instructionResult(linked.id).source,'worker');
    assert.throws(()=>s.addWorkerInstructionPhoto(other.id,linked.id,'before','가상.png',Buffer.from('89504e470d0a1a0a','hex')),/본인/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:company.id,recipientId:other.id}}),/담당자/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:0,recipientId:worker.id}}),/협력사/);
    s.updateWorker(worker.id,{siteId:a.id,name:'수정된 출입자',category:'가상',company:'가상 협력사',occupation:'가상 직종'});assert.equal(JSON.parse(s.document(linked.id).details).recipient,'가상 출입자');
    const result={date:'2026-10-30',actor:'가상 담당자',content:'시험 조치'};
    assert.equal(s.instructionResult(doc.id),null);assert.throws(()=>s.addInstructionResult(doc.id,result),/승인/);
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');assert.equal(s.addInstructionResult(doc.id,result).content,'시험 조치');
    assert.throws(()=>s.addInstructionResult(doc.id,{...result,content:'덮어쓰기'}),/이미/);assert.equal(s.instructionResult(doc.id).content,'시험 조치');
    assert.throws(()=>s.createDocument({...input,siteId:b.id}),/현장/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:-1}}),/협력사/);
    s.updateCompany(company.id,{siteId:a.id,name:'변경 협력사',trade:'가상 공종'});assert.equal(JSON.parse(s.document(doc.id).details).companyName,'가상 협력사');
  }finally{s.close();}
});

test('현장과 출입자를 분리하고 문서 결재 이력을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 현장 A'}), b=s.createSite({name:'가상 현장 B'});
    s.createWorker({siteId:a.id,name:'시험 사용자',category:'직영',company:'가상 회사',occupation:'보통인부'});
    assert.equal(s.workers(a.id,'시험').length,1); assert.equal(s.workers(b.id).length,0);
    const d=s.createDocument({siteId:a.id,type:'tbm',title:'작업 전 회의',date:'2026-10-28',body:'안전 확인'});
    assert.equal(s.documents(b.id).length,0); assert.equal(s.documents(a.id,'tbm','회의').length,1);
    assert.throws(()=>s.transition(d.id,'approve'),/현재 상태/);
    assert.equal(s.transition(d.id,'submit').status,'pending');
    assert.throws(()=>s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-28'}),/수정/);
    assert.equal(s.transition(d.id,'reject').status,'rejected');
    assert.equal(s.transition(d.id,'revise').status,'draft');
    assert.equal(s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-29',body:'수정'}).title,'변경');
    assert.throws(()=>s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-29',body:'x'.repeat(20001)}),/20,000자/);
    assert.equal(s.document(d.id).body,'수정');
    assert.equal(s.events(d.id).length,3);
    assert.throws(()=>s.createDocument({siteId:a.id,type:'tbm',title:'x',date:'2026-02-30'}),/날짜/);
    const invite=s.createInvitation(a.id);
    assert.equal(s.invitation(invite.token).name,'가상 현장 A');
    const oldAccess=s.siteAccessKey(a.id),newAccess=s.rotateSiteAccess(a.id);assert.notEqual(oldAccess,newAccess);assert.equal(s.siteFromAccess(oldAccess),null);assert.equal(s.invitation(invite.token).id,a.id);
    const input={name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'기타',loginId:'worker1',password:'virtual-password-123'};
    assert.throws(()=>s.join(invite.token,input),/확인/);
    assert.throws(()=>s.join(invite.token,{...input,acknowledged:'true'}),/확인/);
    assert.equal(s.workers(a.id).length,1);
    const joined=s.join(invite.token,{...input,acknowledged:true});assert.equal(s.joinAcknowledgement(a.id,joined.id).profile,null);
    assert.equal(s.authenticateWorker(invite.token,'worker1','virtual-password-123').name,'가상 근로자');
    assert.equal(s.authenticateWorker(invite.token,'worker1','wrong-password'),null);
    assert.throws(()=>s.join(invite.token,{...input,acknowledged:true}),/아이디/);
    assert.equal(s.workers(a.id).length,2);
    assert.equal(s.db.prepare('SELECT notice_version FROM join_acknowledgements').get().notice_version,'demo-v1');
    assert.throws(()=>s.join('invalid',{name:'x'}),/만료/);
    const another=s.createInvitation(b.id);
    assert.equal(s.revokeInvitations(a.id),1);
    assert.equal(s.invitation(invite.token),null);
    assert.equal(s.invitation(another.token).id,b.id);
  } finally {s.close();}
});

test('문서 작성 시험 권한은 현장과 작성자를 제한하며 취소 후 권한을 재검사한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),invite=s.createInvitation(a.id),make=id=>s.join(invite.token,{name:id,category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:id,password:'virtual-password-123',acknowledged:true}),one=make('author_one'),two=make('author_two'),company=s.createCompany({siteId:a.id,name:'가상 업체',trade:'가상 공종'}),other=s.createCompany({siteId:b.id,name:'다른 업체',trade:'가상 공종'}),input={siteId:b.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{items:[{task:'가상 작업',contractorId:company.id}]}};
    assert.throws(()=>s.createWorkerDocument(a.id,one.id,input),/권한/);s.setWorkerPermissions(a.id,one.id,['risk','work_plan']);s.setWorkerPermissions(a.id,two.id,['risk']);assert.deepEqual(s.workerDocumentOptions(a.id,one.id,'risk').companies.map(c=>c.id),[company.id]);assert.throws(()=>s.createWorkerDocument(a.id,one.id,{...input,details:{items:[{contractorId:other.id}]}}),/현장/);
    const doc=s.createWorkerDocument(a.id,one.id,input);assert.equal(doc.site_id,a.id);assert.equal(JSON.parse(doc.details).items[0].contractor,'가상 업체');assert.deepEqual(s.workerDocuments(a.id,two.id),[]);assert.throws(()=>s.workerDocument(a.id,two.id,doc.id),/본인/);assert.throws(()=>s.updateWorkerDocument(a.id,two.id,doc.id,input),/본인/);assert.throws(()=>s.workerDocument(b.id,one.id,doc.id),/현장/);
    const plan=s.createWorkerDocument(a.id,one.id,{type:'work_plan',title:'가상 계획',date:'2026-10-29'});assert.equal(plan.type,'work_plan');s.updateWorkerDocument(a.id,one.id,doc.id,{...input,type:'work_plan',title:'수정 평가'});assert.equal(s.document(doc.id).type,'risk');s.transitionWorkerDocument(a.id,one.id,doc.id,'submit');assert.throws(()=>s.updateWorkerDocument(a.id,one.id,doc.id,input),/수정/);assert.throws(()=>s.transitionWorkerDocument(a.id,one.id,doc.id,'approve'),/허용/);s.transitionWorkerDocument(a.id,one.id,doc.id,'withdraw');
    s.setWorkerPermissions(a.id,one.id,['work_plan']);assert.throws(()=>s.workerDocument(a.id,one.id,doc.id),/권한/);assert.equal(s.workerDocuments(a.id,one.id).length,1);assert.throws(()=>s.createWorkerDocument(a.id,one.id,input),/권한/);
    s.db.exec("CREATE TRIGGER fail_author BEFORE INSERT ON worker_authored_documents BEGIN SELECT RAISE(ABORT,'작성자 기록 오류'); END");const before=s.documents(a.id,'work_plan').length;assert.throws(()=>s.createWorkerDocument(a.id,one.id,{type:'work_plan',title:'오류',date:'2026-10-29'}),/작성자 기록 오류/);assert.equal(s.documents(a.id,'work_plan').length,before);
  }finally{s.close();}
});

test('출역 관리 시험 권한은 현장과 계정에 한정되고 변경 이력을 원자적으로 남긴다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-delegated-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),invite=s.createInvitation(a.id),actor=s.join(invite.token,{name:'가상 담당',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'delegated_worker',password:'virtual-password-123',acknowledged:true}),make=siteId=>s.createWorker({siteId,name:'가상 대상',category:'직영',company:'가상 업체',occupation:'가상 직종'}),target=make(a.id),foreign=make(b.id),date='2026-10-29';
    assert.deepEqual(s.workerPermissions(a.id,actor.id),[]);assert.throws(()=>s.delegatedAttendance(a.id,actor.id,date),/권한/);assert.throws(()=>s.setWorkerPermissions(a.id,target.id,['attendance']),/계정/);assert.throws(()=>s.setWorkerPermissions(b.id,actor.id,['attendance']),/현장/);assert.throws(()=>s.setWorkerPermissions(a.id,actor.id,['unknown']),/권한/);
    s.setWorkerPermissions(a.id,actor.id,['attendance']);assert.throws(()=>s.setDelegatedAttendance(a.id,actor.id,{workerId:foreign.id,date,present:true}),/현장/);s.setDelegatedAttendance(a.id,actor.id,{workerId:target.id,date:` ${date} `,present:true});assert.equal(s.attendance(a.id,date).find(row=>row.id===target.id).source,'delegated');assert.equal(s.delegatedAttendance(a.id,actor.id,date).find(row=>row.id===target.id).present,1);assert.equal('daily_rate' in s.delegatedAttendance(a.id,actor.id,date)[0],false);
    s.db.exec("CREATE TRIGGER fail_delegated_event BEFORE INSERT ON delegated_attendance_events BEGIN SELECT RAISE(ABORT,'기록 시험 오류'); END");assert.throws(()=>s.setDelegatedAttendance(a.id,actor.id,{workerId:target.id,date,present:false}),/기록 시험 오류/);assert.equal(s.attendance(a.id,date).find(row=>row.id===target.id).present,1);s.db.exec('DROP TRIGGER fail_delegated_event');s.close();s=new Store(file);
    assert.deepEqual(s.workerPermissions(a.id,actor.id),['attendance']);assert.equal(s.delegatedAttendanceEvents(a.id,date)[0].actor_name,'가상 담당');assert.deepEqual(s.delegatedAttendanceEvents(b.id,date),[]);s.setWorkerPermissions(a.id,actor.id,[]);assert.throws(()=>s.setDelegatedAttendance(a.id,actor.id,{workerId:target.id,date,present:false}),/권한/);assert.equal(s.attendance(a.id,date).find(row=>row.id===target.id).present,1);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('현장별 휴일과 작업 종료는 독립적으로 접속과 자동 출역을 차단한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-blocks-')),file=join(dir,'data.sqlite');let s=new Store(file);
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=make(a.id),two=make(b.id),date='2026-10-29';
    s.setWorkerAccessBlock(a.id,date,'holiday',true);s.setWorkerAccessBlock(a.id,date,'ended',true);assert.equal(s.workerAccessBlocked(a.id,date),true);assert.equal(s.workerAccessBlocked(b.id,date),false);assert.throws(()=>s.recordWorkerLogin(one.id,date),/차단/);assert.deepEqual(s.workerAttendance(one.id,'2026-10'),[]);s.recordWorkerLogin(two.id,date);assert.deepEqual(s.workerAttendance(two.id,'2026-10'),[date]);
    s.setAttendance({siteId:a.id,workerId:one.id,date,present:true});s.setWorkerAccessBlock(a.id,date,'holiday',false);assert.equal(s.workerAccessBlocked(a.id,date),true);s.close();s=new Store(file);
    assert.deepEqual(s.workerAccessBlocks(a.id,'2026-10').map(row=>row.kind),['ended']);assert.throws(()=>s.recordWorkerLogin(one.id,date),/차단/);s.setWorkerAccessBlock(a.id,date,'ended',false);s.recordWorkerLogin(one.id,date);assert.equal(s.attendance(a.id,date)[0].source,'manual');assert.equal(s.workerAccessBlocked(a.id,date),false);
    for(const args of [[a.id,'2026-02-30','holiday',true],[a.id,date,'invalid',true],[a.id,date,'holiday','true'],[999999,date,'holiday',true]])assert.throws(()=>s.setWorkerAccessBlock(...args));assert.throws(()=>s.workerAccessBlocks(a.id,'2026-13'),/월/);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('근로자 재접속은 날짜별 출역을 추가하고 수동 변경을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.recordWorkerLogin(worker.id,'2026-10-29');s.recordWorkerLogin(worker.id,'2026-10-30');s.recordWorkerLogin(worker.id,'2026-10-30');
    assert.deepEqual(s.workerAttendance(worker.id,'2026-10'),['2026-10-29','2026-10-30']);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-30',present:false});s.recordWorkerLogin(worker.id,'2026-10-30');
    const row=s.attendance(site.id,'2026-10-30').find(item=>item.id===worker.id);assert.equal(row.present,0);assert.equal(row.source,'manual');
  }finally{s.close();}
});

test('시험 암호 재설정은 현장과 계정을 검증하고 새 해시와 솔트를 저장한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공',loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true}),read=()=>s.db.prepare('SELECT salt,password_hash FROM worker_accounts WHERE worker_id=?').get(worker.id),before=read();
    assert.throws(()=>s.resetWorkerPassword(other.id,worker.id,'replacement-password-123'),/현장/);assert.throws(()=>s.resetWorkerPassword(site.id,worker.id,'short'),/암호/);assert.deepEqual(Buffer.from(read().password_hash),Buffer.from(before.password_hash));
    s.resetWorkerPassword(site.id,worker.id,'replacement-password-123');const after=read();assert.notDeepEqual(Buffer.from(after.salt),Buffer.from(before.salt));assert.notDeepEqual(Buffer.from(after.password_hash),Buffer.from(before.password_hash));assert.equal(s.authenticateWorker(invite.token,'virtual_worker','virtual-password-123'),null);assert.equal(s.authenticateWorker(invite.token,'virtual_worker','replacement-password-123').id,worker.id);
  }finally{s.close();}
});

test('현장 QR 가입은 현장별로 열고 만료 또는 중지 시 차단된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 현장 A'}),b=s.createSite({name:'가상 현장 B'}),key=s.ensureSiteAccess(a.id),otherKey=s.ensureSiteAccess(b.id),input={name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'기타',loginId:'demo_worker',password:'virtual-password-123',acknowledged:true};
    assert.throws(()=>s.join(null,{...input,siteKey:key}),/중지|만료/);
    assert.ok(s.openSiteRegistration(a.id)>Date.now());assert.equal(s.siteRegistrationOpen(b.id),false);
    assert.throws(()=>s.join(null,{...input,siteKey:otherKey}),/중지|만료/);
    const joined=s.join(null,{...input,siteKey:key});assert.equal(joined.site_id,a.id);
    const newKey=s.rotateSiteAccess(a.id);assert.throws(()=>s.join(null,{...input,siteKey:key,loginId:'another'}),/만료/);assert.equal(s.siteRegistrationOpen(a.id),true);
    s.db.prepare('UPDATE site_registration SET expires_at=? WHERE site_id=?').run(Date.now()-1,a.id);assert.throws(()=>s.join(null,{...input,siteKey:newKey,loginId:'another'}),/중지|만료/);
    s.openSiteRegistration(a.id);s.revokeInvitations(a.id);assert.equal(s.siteRegistrationOpen(a.id),false);assert.throws(()=>s.join(null,{...input,siteKey:newKey,loginId:'another'}),/중지|만료/);
  }finally{s.close();}
});

test('저장한 현장과 가입 정보가 서버 재시작 후 유지되고 만료 링크는 거절한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-'));
  const path=join(dir,'test.sqlite');
  try {
    let s=new Store(path);
    const site=s.createSite({name:'지속성 시험 현장'});
    const invite=s.createInvitation(site.id);
    const access=s.siteAccessKey(site.id);assert.equal(s.ensureSiteAccess(site.id),access);
    s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'기타',loginId:'worker1',password:'virtual-password-123',acknowledged:true});
    s.close();
    s=new Store(path);
    try {
      assert.equal(s.sites()[0].name,'지속성 시험 현장');
      assert.equal(s.workers(site.id)[0].name,'가상 근로자');
      assert.equal(s.authenticateWorker(invite.token,'worker1','virtual-password-123').name,'가상 근로자');
      assert.equal(s.db.prepare('SELECT notice_version FROM join_acknowledgements').get().notice_version,'demo-v1');
      assert.equal(s.invitation(invite.token).id,site.id);
      s.db.prepare('UPDATE invitations SET expires_at=0').run();
      assert.equal(s.invitation(invite.token),null);
      assert.equal(s.siteAccessKey(site.id),access);assert.equal(s.siteFromAccess(access).id,site.id);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',access).name,'가상 근로자');assert.equal(s.authenticateWorker(null,'worker1','wrong-password',access),null);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123','invalid'),null);
      const other=s.createSite({name:'다른 시험 현장'}),otherKey=s.ensureSiteAccess(other.id),replacement=s.rotateSiteAccess(site.id);
      assert.notEqual(replacement,access);assert.equal(s.siteFromAccess(access),null);assert.equal(s.siteFromAccess(replacement).id,site.id);assert.equal(s.siteFromAccess(otherKey).id,other.id);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',replacement).name,'가상 근로자');assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',access),null);
      assert.throws(()=>s.join(invite.token,{name:'늦은 가입'}),/만료/);
      assert.equal(s.workers(site.id).length,1);
    } finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('작업일보의 구조화된 항목을 저장하고 수정하며 공정률을 검증한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const input={siteId:site.id,type:'daily_report',title:'가상 일보',date:'2026-10-28',body:'메모',details:{weather:'맑음',progress:'25.5',todayWork:'배근',tomorrowWork:'거푸집',labor:'목공 2',equipment:'크레인 1',materials:'철근',remarks:'확인'}};
    const doc=s.createDocument(input);
    assert.equal(JSON.parse(doc.details).todayWork,'배근');
    const updated=s.updateDocument(doc.id,{...input,details:{...input.details,progress:'30'}});
    assert.equal(JSON.parse(updated.details).progress,'30');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{progress:'101'}}),/공정률/);
    assert.equal(JSON.parse(s.document(doc.id).details).progress,'30');
    const rows={labor:[{name:'목공',quantity:'2명'},{name:'철근공',quantity:'3명'}],equipment:[{name:'크레인',quantity:'1대'}],materials:[]};
    const withRows=s.updateDocument(doc.id,{...input,details:{...input.details,...rows}});
    assert.deepEqual(JSON.parse(withRows.details).labor,rows.labor);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{labor:[{name:'',quantity:'2명'}]}}),/인력/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).labor,rows.labor);
  } finally {s.close();}
});

test('이전 위험성평가는 현장, 날짜, 종류, 척도와 결재 상태를 제한한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=(siteId,date,kind,scale)=>s.createDocument({siteId,date,type:'risk',title:'가상 평가',details:{kind,scale,items:[{hazard:'가상 위험'}]}});
    const match=add(a.id,'2026-10-27','regular','3x3');s.transition(match.id,'submit');
    const draft=add(a.id,'2026-10-27','regular','3x3');
    const wrong=add(a.id,'2026-10-27','regular','5x4');s.transition(wrong.id,'submit');
    const later=add(a.id,'2026-10-30','regular','3x3');s.transition(later.id,'submit');
    const elsewhere=add(b.id,'2026-10-27','regular','3x3');s.transition(elsewhere.id,'submit');
    assert.deepEqual(s.previousRiskAssessments(a.id,'2026-10-28','regular','3x3',draft.id).map(d=>d.id),[match.id]);
    assert.deepEqual(s.previousRiskAssessments(a.id,'2026-10-28','regular','3x3',match.id),[]);
    assert.throws(()=>s.previousRiskAssessments(a.id,'2026-10-28','','3x3',0),/선택/);
  } finally {s.close();}
});

test('위험성평가 반려 의견은 필수이며 처리 이력에 보존된다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'});
    const doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-28'});
    s.transition(doc.id,'submit');
    assert.throws(()=>s.transition(doc.id,'reject','  '),/반려 의견/);
    assert.equal(s.document(doc.id).status,'pending');
    assert.throws(()=>s.transition(doc.id,'reject','x'.repeat(2001)),/의견/);
    s.transition(doc.id,'reject','가상 검토 의견');
    assert.equal(s.events(doc.id).at(-1).opinion,'가상 검토 의견');
    s.transition(doc.id,'revise');s.transition(doc.id,'submit');s.transition(doc.id,'approve','가상 승인 의견');
    assert.equal(s.events(doc.id).at(-1).opinion,'가상 승인 의견');
  } finally {s.close();}
});

test('TBM 작성자 시험 서명은 수정 시 지워지고 결재 요청 당시 사본이 보존된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'tbm',title:'가상 TBM',date:'2026-10-29'},doc=s.createDocument(input),other=s.createDocument(input),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    assert.throws(()=>s.saveTbmSignature(doc.id,'invalid'),/서명/);s.saveTbmSignature(doc.id,signature);s.saveTbmSignature(other.id,signature);
    const file=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));assert.equal(s.tbmSignature(doc.id),null);assert.ok(s.tbmSignature(other.id));
    s.saveTbmSignature(doc.id,signature);s.deleteAttachment(file);assert.equal(s.tbmSignature(doc.id),null);
    s.saveTbmSignature(doc.id,signature);s.setTrainingTargets(doc.id,[]);assert.equal(s.tbmSignature(doc.id),null);
    s.saveTbmSignature(doc.id,signature);s.updateDocument(doc.id,{...input,title:'수정된 TBM'});assert.equal(s.tbmSignature(doc.id),null);
    const reviewer=s.createReviewer({siteId:site.id,loginId:'tbm_author_review',name:'가상 결재자',password:'virtual-password-123'});s.setApprovalLine(doc.id,[reviewer.id]);s.saveTbmSignature(doc.id,signature);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;assert.equal(s.reviewerPayload(s.document(doc.id)).linked.authorSignature,true);assert.deepEqual(Buffer.from(s.reviewerLinkedSignature(s.document(doc.id),'author',0)),bytes);assert.throws(()=>s.saveTbmSignature(doc.id,signature),/수정 가능한/);
    s.transition(doc.id,'withdraw');s.updateDocument(doc.id,input);assert.equal(s.tbmSignature(doc.id),null);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'author-signature',0,0).data),bytes);s.transition(doc.id,'submit');assert.equal(s.reviewerPayload(s.document(doc.id)).linked.authorSignature,false);assert.equal(s.reviewerLinkedSignature(s.document(doc.id),'author',0),null);
  }finally{s.close();}
});

test('TBM의 작업 내용과 위험요인을 분리해 저장하고 잘못된 수정은 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'tbm',title:'가상 TBM',date:'2026-10-29',body:'시험 교육 내용',details:{weather:'맑음',instructor:'가상 관리자',work:'가상 작업',hazards:'가상 위험과 대책'}};
    const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details),input.details);
    s.updateDocument(doc.id,{...input,details:{...input.details,work:'수정한 작업'}});
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,hazards:'x'.repeat(4001)}}),/TBM/);
    assert.equal(JSON.parse(s.document(doc.id).details).work,'수정한 작업');
    const legacy=s.createDocument({...input,details:undefined});assert.equal(JSON.parse(legacy.details).hazards,'');
  } finally {s.close();}
});

test('교육 종류와 출력용 교육대상을 저장하고 기타 교육명을 검증한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'education',title:'가상 교육',date:'2026-10-28',details:{kind:'other',otherTitle:'가상 교육명',audience:'가상 근로자'}};
    const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details),input.details);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'other',otherTitle:'',audience:'가상'}}),/교육명/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'unknown'}}),/종류/);
    assert.equal(JSON.parse(s.document(doc.id).details).otherTitle,'가상 교육명');
  } finally {s.close();}
});

test('작업허가서의 위험작업과 기간을 저장하고 잘못된 수정은 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),details={kinds:['화기작업','밀폐공간작업'],company:'가상 업체',personnel:'3',periodFrom:'2026-10-29',periodTo:'2026-10-29',timeFrom:'07:00',timeTo:'16:30',place:'가상 장소',work:'가상 작업'};
    const input={siteId:site.id,type:'permit',title:'가상 허가서',date:'2026-10-29',details},doc=s.createDocument(input);
    assert.deepEqual(JSON.parse(doc.details),details);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,kinds:['미확인']}}),/위험작업/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,timeFrom:'18:00'}}),/작업시간/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,periodTo:'2026-10-28'}}),/작업기간/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details),details);
  }finally{s.close();}
});

test('허가서의 사전 조치 시험 점검은 문서별로 저장하고 잘못된 수정을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'},doc=s.createDocument(base),other=s.createDocument(base),nonPermit=s.createDocument({...base,type:'tbm'});
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');const input={date:'2041-01-02',items:[{name:'가상 보호 상태',result:'pass',action:''},{name:'가상 시정',result:'fail',action:'시험 조치'}]},id=s.savePermitCheck(doc.id,input);
    assert.deepEqual(s.permitChecks(doc.id)[0].items,input.items);assert.deepEqual(s.permitChecks(other.id),[]);assert.throws(()=>s.savePermitCheck(nonPermit.id,input),/허가서/);
    assert.throws(()=>s.savePermitCheck(doc.id,{...input,items:[{name:'가상 항목',result:'',action:''}]}),/점검 결과/);assert.deepEqual(s.permitChecks(doc.id)[0].items,input.items);
    assert.throws(()=>s.savePermitCheck(doc.id,{...input,items:[]},id),/항목/);assert.throws(()=>s.savePermitCheck(doc.id,{...input,items:[{name:'가상',result:'pass',action:'기존 조치'}]},id),/비워/);assert.throws(()=>s.savePermitCheck(other.id,input,id),/찾을 수/);assert.deepEqual(s.permitChecks(doc.id)[0].items,input.items);
    const changed={...input,items:[{name:'수정 항목',result:'fail',action:'보완 예정'}]};s.savePermitCheck(doc.id,changed,id);assert.deepEqual(s.permitChecks(doc.id)[0].items,changed.items);assert.throws(()=>s.deletePermitCheck(other.id,id),/찾을 수/);s.deletePermitCheck(doc.id,id);assert.deepEqual(s.permitChecks(doc.id),[]);
  }finally{s.close();}
});

test('시험 허가 연장은 기간과 서명을 검증하고 문서별로 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'},doc=s.createDocument(base),other=s.createDocument(base),nonPermit=s.createDocument({...base,type:'tbm'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`,input={dateFrom:'2041-01-01',dateTo:'2041-01-02',timeFrom:'07:15',timeTo:'16:45',signature};
    const id=s.savePermitExtension(doc.id,input);assert.deepEqual(Buffer.from(s.permitExtensionSignature(doc.id,id)),bytes);assert.deepEqual(s.permitExtensions(other.id),[]);assert.equal(s.permitExtensionSignature(other.id,id),null);assert.throws(()=>s.savePermitExtension(nonPermit.id,input),/허가서/);
    for(const bad of [{...input,dateTo:'2040-12-31'},{...input,dateTo:input.dateFrom,timeFrom:'17:00',timeTo:'08:00'},{...input,timeTo:''},{...input,timeFrom:'25:00'},{...input,signature:'invalid'}])assert.throws(()=>s.savePermitExtension(doc.id,bad,id));
    assert.equal(s.permitExtensions(doc.id)[0].time_from,'07:15');assert.deepEqual(Buffer.from(s.permitExtensionSignature(doc.id,id)),bytes);assert.throws(()=>s.savePermitExtension(other.id,input,id),/찾을 수/);
    s.savePermitExtension(doc.id,{...input,timeFrom:'',timeTo:''},id);assert.equal(s.permitExtensions(doc.id)[0].time_from,'');assert.throws(()=>s.deletePermitExtension(other.id,id),/찾을 수/);s.deletePermitExtension(doc.id,id);assert.equal(s.permitExtensionSignature(doc.id,id),null);
  }finally{s.close();}
});

test('허가서 시험 점검은 데이터베이스를 다시 열어도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-check-'));let s;try{
    const path=join(dir,'test.sqlite');s=new Store(path);const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'}),items=[{name:'가상 점검',result:'fail',action:'가상 조치'}];s.savePermitCheck(doc.id,{date:'2041-01-02',items});const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,extensionId=s.savePermitExtension(doc.id,{dateFrom:'2041-01-03',dateTo:'2041-01-04',signature});s.close();s=null;
    s=new Store(path);assert.deepEqual(s.permitChecks(doc.id)[0].items,items);assert.equal(s.permitExtensions(doc.id)[0].date_to,'2041-01-04');assert.ok(s.permitExtensionSignature(doc.id,extensionId));
  }finally{if(s)s.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('재해 보고서의 가상 재해자와 발생 내용을 보존하고 잘못된 값을 거절한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),victims=[{name:'가상 재해자',company:'가상 소속',occupation:'가상 직종',career:'가상 경력',outcome:'부상',treatment:'가상 치료'}];
    const input={siteId:site.id,type:'incident',title:'가상 보고',date:'2026-10-29',details:{severity:'경상',periodFrom:'2026-01-01',periodTo:'2026-12-31',progress:'20',location:'가상 장소',circumstances:'가상 경위',victims}};
    const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details).victims,victims);
    assert.equal(JSON.parse(doc.details).victims[0].joinedAt,undefined);
    const updated=s.updateDocument(doc.id,{...input,details:{...input.details,victims:[{...victims[0],joinedAt:'2026-01-01'}],inspections:[{name:'가상 점검',date:'2026-10-01'}]}});
    assert.equal(JSON.parse(updated.details).victims[0].joinedAt,'2026-01-01');assert.equal(JSON.parse(updated.details).inspections[0].name,'가상 점검');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,inspections:[{name:'가상 점검',date:'2026-02-30'}]}}),/날짜/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,progress:'101'}}),/공정률/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,victims:[{...victims[0],outcome:'미확인'}]}}),/재해자/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,periodTo:'2025-01-01'}}),/공사기간/);
    assert.equal(JSON.parse(s.document(doc.id).details).location,'가상 장소');assert.equal(JSON.parse(s.document(doc.id).details).inspections[0].date,'2026-10-01');
  }finally{s.close();}
});

test('교육 서명 표시는 설정된 대상자와 같은 현장·날짜·종류에 한정한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),otherSite=s.createSite({name:'다른 현장'}),add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),one=add(site.id),two=add(site.id),other=add(otherSite.id);
    const png=new PNG({width:1,height:1});png.data[3]=255;const signatureBytes=PNG.sync.write(png),signature=`data:image/png;base64,${signatureBytes.toString('base64')}`;
    for(const worker of [one,two,other])s.confirmDailyTraining(worker.id,'2026-10-29',['tbm'],true,signature);
    const doc=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29'});
    assert.deepEqual(s.trainingTargets(doc.id).signedWorkers.map(w=>w.id).sort(),[one.id,two.id].sort());assert.deepEqual(Buffer.from(s.documentTrainingSignature(doc.id,one.id)),signatureBytes);assert.equal(s.documentTrainingSignature(doc.id,other.id),null);
    s.setTrainingTargets(doc.id,[one.id]);assert.deepEqual(s.trainingTargets(doc.id).signedWorkers.map(w=>w.id),[one.id]);assert.equal(s.documentTrainingSignature(doc.id,two.id),null);
    s.setTrainingTargets(doc.id,[]);assert.deepEqual(s.trainingTargets(doc.id).signedWorkers,[]);assert.equal(s.documentTrainingSignature(doc.id,one.id),null);
    const later=s.createDocument({siteId:site.id,type:'tbm',title:'다음날',date:'2026-10-30'}),education=s.createDocument({siteId:site.id,type:'education',title:'다른 종류',date:'2026-10-29'});
    assert.deepEqual(s.trainingTargets(later.id).signedWorkers,[]);assert.deepEqual(s.trainingTargets(education.id).signedWorkers,[]);assert.equal(s.documentTrainingSignature(later.id,one.id),null);assert.equal(s.documentTrainingSignature(education.id,one.id),null);
  }finally{s.close();}
});

test('교육 대상 묶음에는 해당 날짜 출역 당시의 직종과 소속이 제공된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),input={siteId:site.id,name:'가상 근로자',category:'직영',company:'이전 소속',occupation:'목공'},worker=s.createWorker(input),absent=s.createWorker({...input,name:'미출역자'}),foreign=s.createWorker({...input,siteId:other.id,name:'다른 현장'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-28',present:true});s.setAttendance({siteId:other.id,workerId:foreign.id,date:'2026-10-28',present:true});s.updateWorker(worker.id,{...input,company:'새 소속',occupation:'전기'});
    const doc=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-28'}),workers=s.trainingTargets(doc.id).workers,row=workers.find(w=>w.id===worker.id);
    assert.equal(row.present,1);assert.equal(row.attendance_company,'이전 소속');assert.equal(row.attendance_occupation,'목공');assert.equal(workers.find(w=>w.id===absent.id).present,0);assert.equal(workers.some(w=>w.id===foreign.id),false);
    const later=s.createDocument({siteId:site.id,type:'tbm',title:'다음날',date:'2026-10-29'});assert.equal(s.trainingTargets(later.id).workers.find(w=>w.id===worker.id).present,0);
  }finally{s.close();}
});

test('교육 대상은 현장별로 제한되고 결재 요청 후 변경할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const one=add(a.id),two=add(a.id),other=add(b.id);
    const doc=s.createDocument({siteId:a.id,type:'education',title:'가상 교육',date:'2026-10-28'});
    assert.equal(s.trainingTargets(doc.id).configured,false);
    s.setTrainingTargets(doc.id,[one.id]);
    assert.throws(()=>s.setTrainingTargets(doc.id,[other.id]),/현장/);
    assert.deepEqual(s.trainingTargets(doc.id).workers.filter(w=>w.selected).map(w=>w.id),[one.id]);
    s.transition(doc.id,'submit');assert.throws(()=>s.setTrainingTargets(doc.id,[two.id]),/수정/);s.transition(doc.id,'approve');
    assert.equal(s.workerTraining(one.id,'2026-10-28').length,1);
    assert.equal(s.workerTraining(two.id,'2026-10-28').length,0);
    assert.throws(()=>s.confirmWorkerTraining(two.id,doc.id,'2026-10-28'),/교육 문서/);
    assert.throws(()=>s.confirmWorkerTraining(one.id,doc.id,'2026-10-28',false),/권리/);assert.equal(s.trainingChecks(doc.id).length,0);
    s.confirmWorkerTraining(one.id,doc.id,'2026-10-28',true);assert.equal(s.trainingChecks(doc.id)[0].rights_ack,'demo-v1');
  } finally {s.close();}
});

test('교육 참가 확인은 현장과 날짜 및 교육 종류에 맞는 대상자에게만 표시한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const one=add(a.id),other=add(b.id);
    assert.throws(()=>s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],false),/권리/);
    assert.throws(()=>s.confirmDailyTraining(one.id,'2026-10-28',['tbm','tbm'],true),/교육 종류/);
    s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],true);s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],true);
    assert.equal(s.dailyTraining(one.id,'2026-10-28').length,1);
    const doc=(siteId,date,type)=>s.createDocument({siteId,date,type,title:'가상 문서'});
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-28','tbm').id).workers[0].daily_confirmed,1);
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-29','tbm').id).workers[0].daily_confirmed,0);
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-28','education').id).workers[0].daily_confirmed,0);
    const otherTargets=s.trainingTargets(doc(b.id,'2026-10-28','tbm').id).workers;
    assert.equal(otherTargets.length,1);assert.equal(otherTargets[0].id,other.id);assert.equal(otherTargets[0].daily_confirmed,0);
  } finally {s.close();}
});

test('가상 작업계획서 복사는 출처와 연결을 유지하고 결재·첨부를 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),asset=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''}),worker=s.createWorker({siteId:site.id,name:'가상 작업자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),source=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',body:'가상 작업',details:{equipmentIds:[asset.id],periodFrom:'2026-10-30',periodTo:'2026-11-01',workers:[{workerId:worker.id,role:'운전원',training:'가상 교육',qualification:'가상 자격'}]}});
    s.addAttachment(source.id,'가상.txt',Buffer.from('가상'));s.addEquipmentCheck(source.id,{equipmentId:asset.id,date:'2026-10-30',items:[{name:'가상 점검',result:'적정'}]});s.transition(source.id,'submit');
    const input={siteId:site.id,title:'가상 복사본',date:'2026-11-02'},copy=s.copyWorkPlan(source.id,input),details=JSON.parse(copy.details);assert.equal(copy.status,'draft');assert.equal(copy.copied_from,source.id);assert.equal(copy.body,'가상 작업');assert.equal(details.periodFrom,'2026-10-30');assert.deepEqual(details.equipmentIds,[asset.id]);assert.equal(details.workers[0].workerId,worker.id);assert.deepEqual(s.attachments(copy.id),[]);assert.deepEqual(s.equipmentChecks(copy.id),[]);assert.deepEqual(s.approvalLine(copy.id),[]);assert.deepEqual(s.events(copy.id),[]);assert.equal(s.documents(site.id,'work_plan').find(row=>row.id===copy.id).copied_from,source.id);assert.equal(s.document(source.id).status,'pending');
    assert.throws(()=>s.copyWorkPlan(source.id,{...input,siteId:other.id}),/같은 현장/);assert.throws(()=>s.copyWorkPlan(source.id,{...input,date:'2026-02-30'}),/날짜/);const wrong=s.createDocument({siteId:site.id,type:'tbm',title:'다른 유형',date:'2026-10-29'});assert.throws(()=>s.copyWorkPlan(wrong.id,input),/계획서/);
    const count=s.documents(site.id,'work_plan').length;s.db.exec("CREATE TRIGGER fail_work_plan_copy BEFORE INSERT ON work_plan_copies BEGIN SELECT RAISE(ABORT,'복사 시험 실패'); END");assert.throws(()=>s.copyWorkPlan(source.id,input),/복사 시험 실패/);assert.equal(s.documents(site.id,'work_plan').length,count);
  }finally{s.close();}
});

test('장비 점검자 시험 서명은 점검별로 저장하고 결재 당시 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),asset=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''}),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',details:{equipmentIds:[asset.id]}}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`,check={equipmentId:asset.id,date:'2026-10-29',items:[{name:'가상 항목',result:'적정'}]};
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,inspector:'가상 점검자'}),/함께/);assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,signature}),/함께/);assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,inspector:'가상 점검자',signature:'invalid'}),/서명/);assert.equal(s.equipmentChecks(doc.id).length,0);
    const unsigned=s.addEquipmentCheck(doc.id,check),signed=s.addEquipmentCheck(doc.id,{...check,date:'2026-10-30',inspector:' 가상 점검자 ',signature});assert.equal(s.equipmentChecks(doc.id).find(row=>row.id===unsigned).has_signature,0);assert.equal(s.equipmentChecks(doc.id).find(row=>row.id===signed).inspector,'가상 점검자');assert.deepEqual(Buffer.from(s.equipmentCheckSignature(doc.id,signed)),bytes);assert.equal(s.equipmentCheckSignature(doc.id,unsigned),null);assert.equal(s.equipmentCheckSignature(99999,signed),null);
    s.transition(doc.id,'submit');const frozen=s.document(doc.id),cycle=frozen.approval_cycle_id;assert.deepEqual(Buffer.from(s.reviewerLinkedSignature(frozen,'equipment-check',signed)),bytes);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'equipment-check-signature',signed,0).data),bytes);assert.equal(s.reviewerLinkedSignature(frozen,'equipment-check',unsigned),null);
    const later=s.addEquipmentCheck(doc.id,{...check,date:'2026-10-31',inspector:'다른 점검자',signature});assert.equal(s.reviewerLinkedSignature(frozen,'equipment-check',later),null);assert.equal(s.reviewerPayload(frozen).linked.checks.some(row=>row.id===later),false);
  }finally{s.close();}
});

test('작업계획서의 기본 항목을 저장하고 잘못된 작업기간은 기존 값을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),details={consultedAt:'2026-10-20',periodFrom:'2026-10-21',periodTo:'2026-10-25',company:'가상 업체',personnel:'3명',place:'가상 장소',equipment:'가상 장비',hazards:'가상 위험',measures:'가상 대책'};
    const doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-20',details});
    assert.deepEqual(JSON.parse(s.document(doc.id).details),details);
    const asset=s.createEquipment({siteId:site.id,kind:'굴착기',model:'가상 모델',capacity:'',manufacturer:'',registration:''});
    const other=s.createSite({name:'다른 현장'}),otherAsset=s.createEquipment({siteId:other.id,kind:'굴착기',model:'다른 모델',capacity:'',manufacturer:'',registration:''});
    const base={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-20'};
    const timed=s.createDocument({...base,details:{...details,workKinds:['차량계 건설기계','중량물 취급'],timeFrom:'07:00',timeTo:'16:30'}});
    assert.deepEqual(JSON.parse(timed.details).workKinds,['차량계 건설기계','중량물 취급']);assert.equal(JSON.parse(timed.details).timeTo,'16:30');
    assert.throws(()=>s.createDocument({...base,details:{...details,workKinds:['미확인']}}),/작업구분/);
    assert.throws(()=>s.createDocument({...base,details:{...details,timeFrom:'24:30',timeTo:'16:00'}}),/작업시간/);
    assert.throws(()=>s.createDocument({...base,details:{...details,periodTo:details.periodFrom,timeFrom:'17:00',timeTo:'08:00'}}),/작업시간/);
    assert.throws(()=>s.createDocument({...base,details:{...details,timeFrom:'07:00',timeTo:''}}),/작업시간/);
    assert.throws(()=>s.updateDocument(doc.id,{...base,details:{...details,equipmentIds:[otherAsset.id]}}),/현장/);
    assert.throws(()=>s.createDocument({...base,details:{...details,equipmentIds:[asset.id,asset.id]}}),/장비/);
    s.updateDocument(doc.id,{...base,details:{...details,equipmentIds:[asset.id]}});
    assert.deepEqual(JSON.parse(s.document(doc.id).details).equipmentIds,[asset.id]);
    const check={equipmentId:asset.id,date:'2026-10-22',items:[{name:'가상 점검',result:'부적정'}]};
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,items:[{name:'가상 점검',result:''}]}),/판정/);assert.deepEqual(s.equipmentChecks(doc.id),[]);
    s.addEquipmentCheck(doc.id,check);assert.deepEqual(JSON.parse(s.equipmentChecks(doc.id)[0].items),check.items);
    assert.throws(()=>s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정',date:'2026-10-20',details:{...details,periodTo:'2026-10-19'}}),/작업기간/);
    s.updateEquipment(asset.id,{siteId:site.id,kind:'굴착기',model:'수정 모델',capacity:'',manufacturer:'',registration:''});
    assert.equal(JSON.parse(s.equipmentChecks(doc.id)[0].equipment_snapshot).model,'가상 모델');
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');s.addEquipmentCheck(doc.id,{...check,date:'2026-10-23'});
    assert.equal(JSON.parse(s.equipmentChecks(doc.id)[0].equipment_snapshot).model,'수정 모델');
    assert.throws(()=>s.addEquipmentCheck(doc.id,check),/이미/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,date:'2026-10-30'}),/작업기간/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,equipmentId:otherAsset.id}),/장비/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,date:'2026-10-23',items:[{name:'가상',result:'모름'}]}),/판정/);
    assert.throws(()=>s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정',date:'2026-10-20',details:{...details,periodTo:'2026-10-19'}}),/수정/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).equipmentIds,[asset.id]);
  } finally {s.close();}
});

test('결재 요청한 계획서는 장비 수정 후에도 요청 당시 장비 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,kind:'굴착기',model:'이전 모델',capacity:'',manufacturer:'',registration:''};
    const item=s.createEquipment(input),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',details:{equipmentIds:[item.id],equipmentSnapshot:[{id:item.id,model:'위조'}]}});
    assert.equal(JSON.parse(doc.details).equipmentSnapshot,undefined);
    s.transition(doc.id,'submit');s.updateEquipment(item.id,{...input,model:'수정 모델'});
    assert.equal(JSON.parse(s.document(doc.id).details).equipmentSnapshot[0].model,'이전 모델');
    assert.equal(s.equipment(site.id)[0].model,'수정 모델');
    s.transition(doc.id,'reject','가상 반려');s.transition(doc.id,'revise');s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정 계획',date:'2026-10-29',details:{equipmentIds:[item.id]}});s.transition(doc.id,'submit');
    assert.equal(JSON.parse(s.document(doc.id).details).equipmentSnapshot[0].model,'수정 모델');
  }finally{s.close();}
});

test('작업계획서의 역할별 작업자는 현장을 검증하고 당시 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 현장'}),b=s.createSite({name:'다른 현장'}),workerInput={siteId:a.id,name:'가상 작업자',category:'직영',company:'가상 업체',occupation:'운전원'};
    const worker=s.createWorker(workerInput),other=s.createWorker({...workerInput,siteId:b.id});
    const row={workerId:worker.id,role:'운전원',training:'가상 교육',qualification:'가상 자격',name:'위조'},input={siteId:a.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',details:{workers:[row]}};
    const doc=s.createDocument(input),saved=JSON.parse(doc.details).workers[0];assert.equal(saved.name,'가상 작업자');assert.equal(saved.company,'가상 업체');assert.equal(saved.training,'가상 교육');
    const route={...input,details:{...input.details,routeDescription:'가상 진입로\n가상 출구',workSequence:'1. 준비\n2. 작업'}};
    s.updateDocument(doc.id,route);assert.equal(JSON.parse(s.document(doc.id).details).workSequence,'1. 준비\n2. 작업');
    assert.throws(()=>s.updateDocument(doc.id,{...route,details:{...route.details,workSequence:'가'.repeat(4001)}}),/작업순서/);
    assert.equal(JSON.parse(s.document(doc.id).details).routeDescription,'가상 진입로\n가상 출구');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,workerId:other.id}]}}),/현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,role:'알 수 없음'}]}}),/작업자/);
    s.updateWorker(worker.id,{...workerInput,name:'변경된 이름'});s.transition(doc.id,'submit');assert.equal(JSON.parse(s.document(doc.id).details).workers[0].name,'가상 작업자');
  }finally{s.close();}
});

test('승인된 위험요인의 개선 정보는 후속 수정해도 결재 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'improve_review',name:'가상 결재자',password:'virtual-password-123'});
    const doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{items:[{task:'첫 작업',dueDate:'2026-10-30',responsible:'기존 담당'},{task:'둘째 작업'}]}}),update={siteId:site.id,index:0,dueDate:'2026-11-01',completionDate:'2026-11-02',responsible:'새 담당'};
    assert.throws(()=>s.updateRiskImprovement(doc.id,update),/승인/);s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;assert.throws(()=>s.updateRiskImprovement(doc.id,update),/승인/);
    const png=new PNG({width:1,height:1});png.data[3]=255;s.reviewerTransition(doc.id,reviewer.id,'approve','',`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`);
    for(const invalid of [{...update,siteId:other.id},{...update,index:2},{...update,index:'0'},{...update,dueDate:'2026-02-30'},{...update,responsible:'x'.repeat(2001)}])assert.throws(()=>s.updateRiskImprovement(doc.id,invalid));
    const result=JSON.parse(s.updateRiskImprovement(doc.id,{...update,task:'위조'}).details);assert.equal(result.items[0].task,'첫 작업');assert.equal(result.items[0].dueDate,'2026-11-01');assert.equal(result.items[0].completionDate,'2026-11-02');assert.equal(result.items[0].responsible,'새 담당');assert.equal(result.items[1].task,'둘째 작업');
    const captured=JSON.parse(s.approvalCycle(doc.id,cycle).document.details);assert.equal(captured.items[0].dueDate,'2026-10-30');assert.equal(captured.items[0].responsible,'기존 담당');
    const legacy=s.createDocument({siteId:site.id,type:'risk',title:'이전 평가',date:'2026-10-29',details:{task:'이전 형식'}});s.transition(legacy.id,'submit');s.transition(legacy.id,'approve');assert.equal(JSON.parse(s.updateRiskImprovement(legacy.id,{...update,index:0}).details).responsible,'새 담당');
  }finally{s.close();}
});

test('위험요인의 등록 협력사는 현장별로 검증되고 결재 당시 이름이 보존된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장 A'}),other=s.createSite({name:'가상 현장 B'}),company=s.createCompany({siteId:site.id,name:'가상 업체 A',trade:'가상 공종'}),foreign=s.createCompany({siteId:other.id,name:'다른 현장 업체',trade:'가상 공종'}),reviewer=s.createReviewer({siteId:site.id,loginId:'risk_company_review',name:'가상 결재자',password:'virtual-password-123'});
    const input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{scale:'3x3',items:[{contractorId:company.id,contractor:'위조된 이름',task:'작업 A'},{contractor:'직접 입력',task:'작업 B'}]}};
    const doc=s.createDocument(input),rows=JSON.parse(doc.details).items;assert.equal(rows[0].contractor,'가상 업체 A');assert.equal(rows[1].contractor,'직접 입력');
    for(const id of [foreign.id,999999])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{contractorId:id}]}}),/현장/);
    for(const id of [-1,0,'1',1.5])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{contractorId:id}]}}),/협력사/);
    assert.equal(JSON.parse(s.document(doc.id).details).items[0].contractor,'가상 업체 A');
    s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;
    s.updateCompany(company.id,{siteId:site.id,name:'이름 변경',trade:'가상 공종'});
    assert.equal(JSON.parse(s.reviewerPayload(s.document(doc.id)).document.details).items[0].contractor,'가상 업체 A');assert.equal(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).items[0].contractor,'가상 업체 A');
    s.transition(doc.id,'withdraw');assert.equal(JSON.parse(s.updateDocument(doc.id,input).details).items[0].contractor,'이름 변경');
    assert.equal(JSON.parse(s.createDocument({...input,details:{contractorId:company.id,task:'이전 형식'}}).details).contractor,'이름 변경');
  }finally{s.close();}
});

test('위험요인의 가상 공정과 협력사는 저장과 결재 요청에서 보존된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'risk_process_review',name:'가상 결재자',password:'virtual-password-123'}),input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{scale:'3x3',items:[{processName:'공정 A',contractor:'가상 업체 A',task:'가상 작업 A'},{processName:'공정 A',contractor:'가상 업체 B',task:'가상 작업 B'},{task:'이전 형태'}]}};
    const doc=s.createDocument(input),items=JSON.parse(doc.details).items;assert.equal(items[0].processName,'공정 A');assert.equal(items[1].contractor,'가상 업체 B');assert.equal(items[2].processName,undefined);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{processName:'x'.repeat(2001)}]}}),/위험성평가/);assert.equal(JSON.parse(s.document(doc.id).details).items[0].contractor,'가상 업체 A');
    s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const captured=s.reviewerPayload(s.document(doc.id));assert.equal(JSON.parse(captured.document.details).items[1].contractor,'가상 업체 B');
  }finally{s.close();}
});

test('위험요인별 시험 검토 의견은 분리 저장되고 결재 요청 당시 보존된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'risk_opinion_review',name:'가상 결재자',password:'virtual-password-123'}),input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{kind:'regular',scale:'3x3',items:[{task:'가상 작업 A',hazard:'위험 A',supervisorOpinion:'감독 의견',safetyOpinion:'안전 의견',healthOpinion:'보건 의견',managerOpinion:'소장 의견'},{task:'가상 작업 B',hazard:'위험 B',safetyOpinion:'다른 의견'}]}};
    const doc=s.createDocument(input),rows=JSON.parse(doc.details).items;assert.equal(rows[0].supervisorOpinion,'감독 의견');assert.equal(rows[0].managerOpinion,'소장 의견');assert.equal(rows[1].safetyOpinion,'다른 의견');assert.equal(rows[1].managerOpinion,undefined);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{...input.details.items[0],healthOpinion:'x'.repeat(2001)}]}}),/위험성평가/);assert.equal(JSON.parse(s.document(doc.id).details).items[0].healthOpinion,'보건 의견');
    s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,details:{...input.details,items:[{...input.details.items[0],safetyOpinion:'수정 의견'}]}});assert.equal(JSON.parse(s.document(doc.id).details).items[0].safetyOpinion,'수정 의견');assert.equal(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).items[0].safetyOpinion,'안전 의견');
  }finally{s.close();}
});

test('위험요인과 조치를 저장하고 유효하지 않은 수정은 기존 값을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const input={siteId:site.id,type:'risk',title:'가상 위험요인',date:'2026-10-28',details:{task:'가상 작업',hazard:'가상 위험',existingMeasures:'기존 조치',additionalMeasures:'추가 조치'}};
    const doc=s.createDocument(input);
    assert.equal(JSON.parse(doc.details).hazard,'가상 위험');
    assert.equal(JSON.parse(s.updateDocument(doc.id,{...input,details:{...input.details,additionalMeasures:'조치 변경'}}).details).additionalMeasures,'조치 변경');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{hazard:'x'.repeat(2001)}}),/위험성평가/);
    assert.equal(JSON.parse(s.document(doc.id).details).additionalMeasures,'조치 변경');
    const items=[{task:'작업 A',hazard:'위험 A',existingMeasures:'기존 A',additionalMeasures:'추가 A'},{task:'작업 B',hazard:'위험 B',existingMeasures:'',additionalMeasures:'추가 B'}];
    assert.deepEqual(JSON.parse(s.updateDocument(doc.id,{...input,details:{items}}).details).items,items);
    const classified=s.updateDocument(doc.id,{...input,details:{kind:'continuous',scale:'3x3',periodFrom:'2026-10-01',periodTo:'2026-10-31',items}});
    assert.equal(JSON.parse(classified.details).kind,'continuous');
    assert.equal(JSON.parse(classified.details).scale,'3x3');
    assert.equal(JSON.parse(classified.details).periodTo,'2026-10-31');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{periodFrom:'2026-11-01',periodTo:'2026-10-01',items}}),/관리기간/);
    assert.equal(JSON.parse(s.document(doc.id).details).periodFrom,'2026-10-01');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'unknown',items}}),/종류/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'invalid',items}}),/척도/);
    assert.equal(JSON.parse(s.document(doc.id).details).kind,'continuous');
    const detailed={...items[0],riskCategory:'기계적',riskType:'끼임',legalBasis:'가상 근거',dueDate:'2024-02-29',completionDate:'',responsible:'가상 담당자'};
    assert.deepEqual(JSON.parse(s.updateDocument(doc.id,{...input,details:{items:[detailed]}}).details).items[0],detailed);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{...detailed,dueDate:'2025-02-29'}]}}),/날짜/);
    assert.equal(JSON.parse(s.document(doc.id).details).items[0].dueDate,'2024-02-29');
    const levels={...detailed,grade:'',likelihood:'2',severity:'3'};s.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[levels]}});assert.equal(JSON.parse(s.document(doc.id).details).items[0].likelihood,'2');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[{...levels,likelihood:'4'}]}}),/척도/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[levels]}}),/척도/);
    s.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[{...detailed,grade:'상'}]}});assert.equal(JSON.parse(s.document(doc.id).details).items[0].grade,'상');
    s.updateDocument(doc.id,{...input,details:{items:[detailed]}});
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{hazard:'x'.repeat(2001)}]}}),/위험성평가/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).items,[detailed]);
  } finally {s.close();}
});

test('문서 검색은 현장·기간·유형을 지키고 상세 항목도 찾는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,date,type,title,details)=>s.createDocument({siteId,date,type,title,details});
    add(a.id,'2026-10-27','risk','첫 기록',{hazard:'가상 추락'});
    add(a.id,'2026-10-28','risk','두 번째 기록',{items:[{hazard:'가상 추락'}]});
    add(b.id,'2026-10-28','risk','다른 현장',{hazard:'가상 추락'});
    add(a.id,'2026-10-28','daily_report','다른 유형',{todayWork:'가상 추락'});
    assert.deepEqual(s.documents(a.id,'risk','가상 추락','2026-10-28','2026-10-28').map(d=>d.title),['두 번째 기록']);
    assert.equal(s.documents(a.id,'','가상 추락','2026-10-27','2026-10-28').length,3);
    assert.throws(()=>s.documents(a.id,'','','2026-10-29','2026-10-28'),/시작일/);
  } finally {s.close();}
});

test('위험성평가 시험 활동은 완료 후에도 문서별로 관리된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29'}),other=s.createDocument({siteId:site.id,type:'risk',title:'다른 평가',date:'2026-10-29'}),nonRisk=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29'});
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');
    const input={kind:'meeting',date:'2026-10-30',place:'가상 장소',host:'가상 주관자',participants:'가상 참석자',content:'가상 내용'},id=s.saveRiskActivity(doc.id,input);
    const worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),otherSite=s.createSite({name:'다른 현장'}),foreign=s.createWorker({siteId:otherSite.id,name:'다른 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
    s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id]},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,workerIds:[foreign.id]},id),/현장/);assert.throws(()=>s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id,worker.id]},id),/참석자/);
    s.updateWorker(worker.id,{siteId:site.id,name:'변경 이름',category:'직영',company:'가상 업체',occupation:'가상 직종'});s.saveRiskActivity(doc.id,input,id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id],content:'내용 수정'},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    s.saveRiskActivity(doc.id,{...input,workerIds:[]},id);s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id]},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'변경 이름');
    const bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addRiskActivityPhoto(doc.id,id,'가상.png',bytes);
    assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,photoId).data),bytes);assert.equal(s.riskActivityPhoto(other.id,id,photoId),null);
    assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'bad.png',Buffer.from('bad')),/PNG/);assert.throws(()=>s.riskActivityPhotos(other.id,id),/찾을 수/);
    assert.equal(s.riskActivities(doc.id)[0].host,'가상 주관자');assert.deepEqual(s.riskActivities(other.id),[]);
    assert.throws(()=>s.saveRiskActivity(other.id,input,id),/찾을 수/);assert.throws(()=>s.saveRiskActivity(nonRisk.id,input),/위험성평가/);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,date:'2026-02-30'},id),/날짜/);assert.equal(s.riskActivities(doc.id)[0].date,input.date);
    s.saveRiskActivity(doc.id,{...input,kind:'weekly',content:'수정'},id);assert.equal(s.riskActivities(doc.id)[0].kind,'weekly');
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,kind:'weekly',periodFrom:'2026-11-01',periodTo:'2026-10-01'},id),/관리기간/);
    s.saveRiskActivity(doc.id,{...input,kind:'weekly',periodFrom:'2026-10-01',periodTo:'2026-10-31',entryMode:'scan'},id);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'scan');
    const pdf=Buffer.from('%PDF-1.4\n가상 회의록'),minutes=s.addRiskActivityPhoto(doc.id,id,'시험.pdf',pdf,'minutes');assert.equal(s.riskActivityPhotos(doc.id,id).find(p=>p.id===minutes).purpose,'minutes');assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,minutes).data),pdf);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,kind:'weekly',entryMode:'manual'},id),/회의록 첨부/);assert.throws(()=>s.saveRiskActivity(doc.id,input,id),/회의록 첨부/);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'scan');assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,minutes).data),pdf);
    s.deleteRiskActivityPhoto(doc.id,id,minutes);s.saveRiskActivity(doc.id,{...input,kind:'weekly',entryMode:'manual'},id);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'manual');
    assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'시험.pdf',pdf),/PNG/);assert.throws(()=>s.saveRiskActivity(doc.id,{...input,entryMode:'scan'}),/방식/);
    assert.throws(()=>s.deleteRiskActivity(other.id,id),/찾을 수/);s.deleteRiskActivity(doc.id,id);assert.equal(s.riskActivities(doc.id).length,0);assert.equal(s.riskActivityPhoto(doc.id,id,photoId),null);
  }finally{s.close();}
});

test('같은 현장과 작성일 이전의 가장 최근 작업일보만 찾는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,date,title,type='daily_report')=>s.createDocument({siteId,date,title,type,body:title});
    add(a.id,'2026-10-25','이전 일보');
    add(a.id,'2026-10-27','가장 최근 일보');
    add(b.id,'2026-10-28','다른 현장');
    add(a.id,'2026-10-28','같은 날짜');
    add(a.id,'2026-10-29','다른 문서','tbm');
    assert.equal(s.previousDailyReport(a.id,'2026-10-28').body,'가장 최근 일보');
    assert.equal(s.previousDailyReport(a.id,'2026-10-25'),null);
    assert.equal(s.previousDailyReport(b.id,'2026-10-29').body,'다른 현장');
    assert.throws(()=>s.previousDailyReport(a.id,'2026-02-30'),/날짜/);
  } finally {s.close();}
});

test('작업일보는 같은 현장과 날짜의 TBM 및 교육 문서만 조회한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}), b=s.createSite({name:'시험 B'});
    const add=(siteId,date,type,title)=>s.createDocument({siteId,date,type,title,body:'시험 내용'});
    add(a.id,'2026-10-28','tbm','당일 TBM');add(a.id,'2026-10-28','education','당일 교육');
    add(a.id,'2026-10-27','tbm','다른 날짜');add(b.id,'2026-10-28','tbm','다른 현장');add(a.id,'2026-10-28','risk','다른 문서');
    assert.deepEqual(s.dailySourceDocuments(a.id,'2026-10-28').map(d=>d.title).sort(),['당일 TBM','당일 교육'].sort());
    assert.throws(()=>s.dailySourceDocuments(a.id,'2026-02-30'),/날짜/);
  } finally {s.close();}
});

test('첨부파일은 문서에 분리 저장하며 결재 요청 후 변경할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const create=title=>s.createDocument({siteId:site.id,type:'tbm',title,date:'2026-10-28'});
    const a=create('문서 A'),b=create('문서 B'),bytes=Buffer.from('가상 첨부 내용');
    const id=s.addAttachment(a.id,'가상 사진.txt',bytes);
    assert.equal(s.attachments(a.id)[0].category,'general');
    const plan=s.createDocument({siteId:site.id,type:'work_plan',title:'시험 계획',date:'2026-10-28'}),diagram=Buffer.from('89504e470d0a1a0a00000000','hex');
    const diagramId=s.addAttachment(plan.id,'계획도.png',diagram,'plan_diagram');assert.equal(s.attachments(plan.id)[0].category,'plan_diagram');assert.deepEqual(Buffer.from(s.attachment(diagramId).data),diagram);
    assert.throws(()=>s.addAttachment(a.id,'계획도.png',diagram,'plan_diagram'),/구분/);assert.throws(()=>s.addAttachment(plan.id,'계획도.png',bytes,'plan_diagram'),/PNG/);
    assert.equal(s.attachments(a.id)[0].name,'가상 사진.txt');assert.equal(s.attachments(b.id).length,0);
    assert.deepEqual(Buffer.from(s.attachment(id).data),bytes);
    assert.throws(()=>s.addAttachment(a.id,'../경로.txt',bytes),/이름/);
    assert.throws(()=>s.addAttachment(a.id,'큰 파일',Buffer.alloc(2*1024*1024+1)),/2MB/);
    s.transition(a.id,'submit');
    assert.throws(()=>s.deleteAttachment(id),/첨부파일/);
    assert.throws(()=>s.addAttachment(a.id,'추가.txt',bytes),/첨부/);
    s.transition(a.id,'withdraw');s.deleteAttachment(id);assert.equal(s.attachments(a.id).length,0);
  } finally {s.close();}
});

test('기존 데이터베이스에 작업일보 항목을 추가해도 기존 문서가 남는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-legacy-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE documents (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO documents(site_id,type,title,date,body) VALUES(1,'tbm','기존 문서','2026-10-28','기존 내용')");
    old.close();
    const s=new Store(path);
    try {assert.equal(s.document(1).body,'기존 내용');assert.deepEqual(JSON.parse(s.document(1).details),{});} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('이전 가상 노임의 알 수 없는 당시 소속은 채우지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-wage-legacy-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE sites (id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO sites(id,name) VALUES(1,'가상 현장'); CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers VALUES(1,1,'가상 근로자','직영','현재 소속','목공'); CREATE TABLE wage_records (site_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,month TEXT NOT NULL,gross INTEGER NOT NULL,deductions TEXT NOT NULL,PRIMARY KEY(worker_id,month))");
    old.prepare('INSERT INTO wage_records VALUES(?,?,?,?,?)').run(1,1,'2024-02',1000,JSON.stringify({income:100,local:10,health:20,care:3,pension:50,employment:5}));old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const row=s.wageRecords(1,'2024-02')[0];assert.equal(row.company,'기록 없음');assert.equal(row.name,'기록 없음');assert.equal(row.category,null);assert.equal(row.birth_date_snapshot,null);assert.equal(row.remark,null);assert.equal(row.net,812);assert.equal(s.wageRecords(1,'2024-02',{category:'직영'}).length,0);}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 출역 기록에 구분이 없어도 보존되고 다시 열 수 있다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-attendance-legacy-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE sites (id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO sites(id,name) VALUES(1,'가상 현장'); CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers VALUES(1,1,'가상 근로자','직영','가상 회사','목공'); CREATE TABLE attendance (worker_id INTEGER NOT NULL,date TEXT NOT NULL,present INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,company_snapshot TEXT,occupation_snapshot TEXT,source TEXT,PRIMARY KEY(worker_id,date)); INSERT INTO attendance(worker_id,date,present,company_snapshot,occupation_snapshot,source) VALUES(1,'2026-10-28',1,'가상 회사','목공','manual')");
    old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const row=s.attendanceReport(1,'2026-10-28','2026-10-28','category')[0];assert.equal(row.label,'기록 없음');assert.equal(row.days,1);assert.equal(s.attendanceReport(1,'2026-10-28','2026-10-28','company')[0].label,'가상 회사');const day=s.monthlyAttendance(1,'2026-10')[0].units[0];assert.equal(day.category,null);if(i===0){assert.equal(day.units_hundredths,null);assert.equal(day.daily_rate,null);s.setAttendanceUnits({siteId:1,workerId:1,date:'2026-10-28',units:'0.5'});s.setAttendanceDailyRate({siteId:1,workerId:1,date:'2026-10-28',dailyRate:'101'});}else{assert.equal(day.daily_rate,101);assert.equal(day.estimated_pay,51);}}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 장비 기록은 상세정보 추가 후에도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-equipment-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE equipment (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,kind TEXT NOT NULL,model TEXT NOT NULL,capacity TEXT NOT NULL,manufacturer TEXT NOT NULL,registration TEXT NOT NULL); INSERT INTO equipment VALUES(1,1,'가상 장비','가상 모델','','','')");old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const item=s.equipment(1)[0];assert.equal(item.kind,'가상 장비');assert.deepEqual(JSON.parse(item.details),{});}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 출입자의 알 수 없는 등록일을 임의로 채우지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-workers-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers(site_id,name,category,company,occupation) VALUES(1,'기존 출입자','직영','가상 회사','목공')");old.close();
    const s=new Store(path);
    try {assert.equal(s.workers(1)[0].created_date,null);assert.equal(s.workers(1,'',{from:'2026-01-01'}).length,0);} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('이전 결재 이력은 의견 항목 추가 후에도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-events-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE events (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL,action TEXT NOT NULL,from_status TEXT NOT NULL,to_status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO events(document_id,action,from_status,to_status) VALUES(1,'submit','draft','pending')");
    old.close();
    let s=new Store(path);
    try {assert.equal(s.events(1)[0].action,'submit');assert.equal(s.events(1)[0].opinion,'');} finally {s.close();}
    s=new Store(path);
    try {assert.equal(s.events(1).length,1);assert.equal(s.events(1)[0].to_status,'pending');} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('교육 문서별 서명은 기존 확인을 보존하고 같은 종류의 당일 서명과 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=id=>s.createWorker({siteId:id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'가상 직종'}),worker=make(site.id),stranger=make(site.id),foreign=make(other.id),doc=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29',body:'가상 교육 내용',details:{work:'가상 작업',hazards:'가상 위험'}}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    const file=s.addAttachment(doc.id,'가상 교육.txt',Buffer.from('가상 교육 자료'));assert.equal(s.workerTrainingAttachment(worker.id,doc.id,file,'2026-10-29'),null);s.setTrainingTargets(doc.id,[worker.id]);s.transition(doc.id,'submit');s.transition(doc.id,'approve');s.db.prepare("INSERT INTO worker_training_checks(worker_id,document_id,created_at,rights_ack) VALUES(?,?,'2026-10-29 09:00:00',NULL)").run(worker.id,doc.id);
    const visible=s.workerTraining(worker.id,'2026-10-29')[0];assert.equal(visible.body,'가상 교육 내용');assert.equal(visible.details.hazards,'가상 위험');assert.equal(visible.has_signature,0);assert.equal(s.workerTraining(stranger.id,'2026-10-29').length,0);assert.throws(()=>s.confirmWorkerTraining(foreign.id,doc.id,'2026-10-29',true,signature),/교육 문서/);assert.throws(()=>s.confirmWorkerTraining(worker.id,doc.id,'2026-10-29',false,signature),/권리/);assert.throws(()=>s.confirmWorkerTraining(worker.id,doc.id,'2026-10-29',true,'invalid'),/서명/);
    assert.deepEqual(visible.files,[{id:Number(file),name:'가상 교육.txt',size:Buffer.byteLength('가상 교육 자료')}]);assert.equal(Buffer.from(s.workerTrainingAttachment(worker.id,doc.id,file,'2026-10-29').data).toString(),'가상 교육 자료');assert.equal(s.workerTrainingAttachment(stranger.id,doc.id,file,'2026-10-29'),null);assert.equal(s.workerTrainingAttachment(foreign.id,doc.id,file,'2026-10-29'),null);assert.equal(s.workerTrainingAttachment(worker.id,doc.id,file,'2026-10-30'),null);assert.equal(s.workerTrainingAttachment(worker.id,doc.id,99999,'2026-10-29'),null);
    assert.equal(s.trainingCheckSignature(doc.id,worker.id),null);s.confirmWorkerTraining(worker.id,doc.id,'2026-10-29',true,signature);const checked=s.trainingChecks(doc.id)[0];assert.equal(checked.created_at,'2026-10-29 09:00:00');assert.equal(checked.rights_ack,'demo-v1');assert.equal(checked.has_signature,1);assert.deepEqual(Buffer.from(s.trainingCheckSignature(doc.id,worker.id)),bytes);assert.equal(s.documentTrainingSignature(doc.id,worker.id),null);assert.equal(s.trainingCheckSignature(doc.id,stranger.id),null);
  }finally{s.close();}
});

test('이전 교육 참가 기록에 확인되지 않은 권리 확인을 추가하지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-training-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE worker_training_checks (worker_id INTEGER NOT NULL,document_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,document_id)); INSERT INTO worker_training_checks(worker_id,document_id,created_at) VALUES(1,2,'2026-10-28 09:00:00')");
    old.close();
    for(let i=0;i<2;i++){
      const s=new Store(path);
      try {
        const row=s.db.prepare('SELECT worker_id,document_id,created_at,rights_ack,signature FROM worker_training_checks').get();
        assert.equal(row.worker_id,1);assert.equal(row.document_id,2);assert.equal(row.created_at,'2026-10-28 09:00:00');assert.equal(row.rights_ack,null);assert.equal(row.signature,null);
      } finally {s.close();}
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('현장과 날짜별 출역을 기록하고 다른 현장의 근로자 변경을 거절한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 현장 A'}),b=s.createSite({name:'시험 현장 B'});
    const worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:true});
    assert.equal(s.attendance(a.id,'2026-10-28')[0].present,1);
    assert.equal(s.attendance(a.id,'2026-10-29')[0].present,0);
    assert.equal(s.attendance(b.id,'2026-10-28').length,0);
    assert.throws(()=>s.setAttendance({siteId:b.id,workerId:worker.id,date:'2026-10-28',present:false}),/현장/);
    assert.throws(()=>s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-02-30',present:true}),/날짜/);
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:false});
    assert.equal(s.attendance(a.id,'2026-10-28')[0].present,0);
  } finally {s.close();}
});

test('월별 출역 정보 변경은 선택한 현장과 근로자의 출역일만 수정한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'기존 업체',occupation:'기존 직종'}),second=s.createWorker({siteId:site.id,name:'다른 근로자',category:'직영',company:'기존 업체',occupation:'기존 직종'});
    for(const [person,date] of [[worker,'2024-02-01'],[worker,'2024-02-02'],[worker,'2024-03-01'],[second,'2024-02-01']])s.setAttendance({siteId:site.id,workerId:person.id,date,present:true});
    s.saveWageRecord({siteId:site.id,workerId:worker.id,month:'2024-02',gross:'1000',deductions:{income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'}});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-02',present:false});
    const input={siteId:site.id,workerId:worker.id,month:'2024-02',company:'변경 업체',occupation:'변경 직종'};
    assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,siteId:other.id}),/현장/);assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,month:'2024-13'}),/월/);assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,occupation:' '}),/직종/);
    assert.equal(s.updateMonthlyAttendanceDetails(input),1);
    const monthly=s.monthlyAttendance(site.id,'2024-02'),record=monthly.find(w=>w.id===worker.id).units[0];assert.deepEqual([record.date,record.category,record.company,record.occupation],['2024-02-01','직영','변경 업체','변경 직종']);assert.equal(monthly.find(w=>w.id===second.id).units[0].company,'기존 업체');
    assert.equal(s.attendanceReport(site.id,'2024-02-01','2024-02-29','company').find(r=>r.label==='변경 업체').days,1);
    assert.equal(s.attendanceReport(site.id,'2024-03-01','2024-03-31','occupation')[0].label,'기존 직종');
    assert.equal(s.workers(site.id).find(w=>w.id===worker.id).company,'기존 업체');
    assert.equal(s.wageRecords(site.id,'2024-02')[0].gross,1000);assert.equal(s.wageRecords(site.id,'2024-02')[0].occupation,'기존 직종');
    assert.throws(()=>s.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2024-04',company:'변경'}),/출역/);
    assert.throws(()=>s.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2024-02'}),/항목/);
  }finally{s.close();}
});

test('월별 시험 일당은 선택한 근로자의 해당 월 출역일에만 적용된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 회사',occupation:'목공'}),worker=add(site.id,'가상 근로자'),second=add(site.id,'다른 근로자'),foreign=add(other.id,'다른 현장'),base={siteId:site.id,workerId:worker.id,month:'2024-02'};
    for(const [siteId,person,date] of [[site.id,worker,'2024-02-01'],[site.id,worker,'2024-02-02'],[site.id,worker,'2024-02-03'],[site.id,worker,'2024-03-01'],[site.id,second,'2024-02-01'],[other.id,foreign,'2024-02-01']])s.setAttendance({siteId,workerId:person.id,date,present:true});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-03',present:false});s.setAttendanceUnits({siteId:site.id,workerId:worker.id,date:'2024-02-01',units:'0.5'});s.saveWageRecord({...base,gross:'2000',deductions:{income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'}});
    for(const dailyRate of ['', '-1','1.1','1000000000',null,100])assert.throws(()=>s.updateMonthlyAttendanceDetails({...base,company:'바꾸면 안 됨',dailyRate}),/일당/);assert.equal(s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===worker.id).units[0].company,'가상 회사');
    assert.throws(()=>s.updateMonthlyAttendanceDetails({...base,siteId:other.id,dailyRate:'101'}),/현장/);assert.equal(s.updateMonthlyAttendanceDetails({...base,dailyRate:'101'}),2);let days=s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===worker.id).units;assert.deepEqual(days.map(day=>[day.daily_rate,day.estimated_pay]),[[101,51],[101,null]]);assert.equal(s.monthlyAttendance(site.id,'2024-03').find(row=>row.id===worker.id).units[0].daily_rate,null);assert.equal(s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===second.id).units[0].daily_rate,null);assert.equal(s.monthlyAttendance(other.id,'2024-02')[0].units[0].daily_rate,null);assert.equal(s.wageRecords(site.id,'2024-02')[0].gross,2000);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-03',present:true});days=s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===worker.id).units;assert.equal(days[2].daily_rate,null);assert.equal(s.updateMonthlyAttendanceDetails({...base,dailyRate:'0'}),3);assert.equal(s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===worker.id).units[0].estimated_pay,0);
  }finally{s.close();}
});

test('시험 공수는 현장과 출역일별로 수동 기록하고 미기록을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),date='2024-02-29',base={siteId:site.id,workerId:worker.id,date};
    assert.throws(()=>s.setAttendanceUnits({...base,units:'1'}),/출역/);s.recordWorkerLogin(worker.id,date);assert.equal(s.attendance(site.id,date)[0].units_hundredths,null);
    s.setAttendanceUnits({...base,units:'0.25'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);assert.deepEqual(s.workerAttendanceUnits(worker.id,'2024-02').map(row=>[row.date,row.units_hundredths]),[[date,25]]);
    for(const units of ['10','-1','1.001','1e0','9.999',null,1])assert.throws(()=>s.setAttendanceUnits({...base,units}),/공수/);assert.throws(()=>s.setAttendanceUnits({...base,siteId:other.id,units:'1'}),/현장/);assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);
    s.setAttendance({...base,present:false});assert.deepEqual(s.workerAttendanceUnits(worker.id,'2024-02'),[]);s.recordWorkerLogin(worker.id,date);assert.equal(s.attendance(site.id,date)[0].present,0);s.setAttendance({...base,present:true});assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);
    s.setAttendanceUnits({...base,units:'9.99'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,999);s.setAttendanceUnits({...base,units:'0'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,0);s.setAttendanceUnits({...base,units:''});assert.equal(s.attendance(site.id,date)[0].units_hundredths,null);
  }finally{s.close();}
});

test('일당과 공수의 시험 계산은 출역·현장을 제한하고 미기록 및 반올림을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),base={siteId:site.id,workerId:worker.id,date:'2024-02-29'};
    s.saveWageRecord({siteId:site.id,workerId:worker.id,month:'2024-02',gross:'2000',deductions:{income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'}});assert.throws(()=>s.setAttendanceDailyRate({...base,dailyRate:'101'}),/출역/);s.setAttendance({...base,present:true});
    for(const dailyRate of ['-1','1.1','1e3','1000000000',null,100])assert.throws(()=>s.setAttendanceDailyRate({...base,dailyRate}),/일당/);
    assert.throws(()=>s.setAttendanceDailyRate({...base,siteId:other.id,dailyRate:'101'}),/현장/);s.setAttendanceDailyRate({...base,dailyRate:'101'});
    const record=()=>s.monthlyAttendance(site.id,'2024-02')[0].units[0];assert.equal(record().estimated_pay,null);s.setAttendanceUnits({...base,units:'0.5'});assert.equal(record().estimated_pay,51);assert.equal(s.wageRecords(site.id,'2024-02')[0].gross,2000);
    s.setAttendanceUnits({...base,units:'0'});assert.equal(record().estimated_pay,0);s.setAttendanceDailyRate({...base,dailyRate:''});assert.equal(record().daily_rate,null);assert.equal(record().estimated_pay,null);
    s.setAttendanceDailyRate({...base,dailyRate:'0'});s.setAttendanceUnits({...base,units:'1'});assert.equal(record().estimated_pay,0);s.setAttendance({...base,present:false});assert.equal(s.monthlyAttendance(site.id,'2024-02')[0].units.length,0);s.setAttendance({...base,present:true});assert.equal(record().daily_rate,0);
  }finally{s.close();}
});

test('월별과 기간별 시험 공수 집계는 미기록과 0을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=add(site.id,'가상 1'),two=add(site.id,'가상 2'),foreign=add(other.id,'다른 근로자');
    for(const [siteId,worker,date] of [[site.id,one,'2024-02-01'],[site.id,one,'2024-02-02'],[site.id,two,'2024-02-02'],[other.id,foreign,'2024-02-02'],[site.id,one,'2024-03-01']])s.setAttendance({siteId,workerId:worker.id,date,present:true});
    for(const [siteId,worker,date,units] of [[site.id,one,'2024-02-01','0.25'],[site.id,two,'2024-02-02','0'],[other.id,foreign,'2024-02-02','9.99'],[site.id,one,'2024-03-01','8']])s.setAttendanceUnits({siteId,workerId:worker.id,date,units});
    const monthly=s.monthlyAttendance(site.id,'2024-02'),first=monthly.find(w=>w.id===one.id),second=monthly.find(w=>w.id===two.id);assert.deepEqual(first.units.map(row=>[row.date,row.units_hundredths]),[['2024-02-01',25],['2024-02-02',null]]);assert.equal(second.units[0].units_hundredths,0);
    const report=s.attendanceReport(site.id,'2024-02-01','2024-02-29','occupation')[0];assert.equal(report.days,3);assert.equal(report.units_hundredths,25);assert.equal(report.units_missing,1);
    const zero=s.attendanceReport(site.id,'2024-02-02','2024-02-02','worker').find(row=>row.label==='가상 2');assert.equal(zero.units_hundredths,0);assert.equal(zero.units_missing,0);const missing=s.attendanceReport(site.id,'2024-02-02','2024-02-02','worker').find(row=>row.label==='가상 1');assert.equal(missing.units_hundredths,null);assert.equal(missing.units_missing,1);
    s.setAttendance({siteId:site.id,workerId:one.id,date:'2024-02-01',present:false});assert.equal(s.attendanceReport(site.id,'2024-02-01','2024-02-29','occupation')[0].units_hundredths,0);
  }finally{s.close();}
});

test('월별 출역은 해당 현장과 월의 기존 일별 기록을 표시한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    const one=add(a.id),other=add(b.id);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-02-29',present:true});
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-03-01',present:true});
    s.setAttendance({siteId:b.id,workerId:other.id,date:'2024-02-01',present:true});
    assert.deepEqual(s.monthlyAttendance(a.id,'2024-02')[0].days,['2024-02-29']);
    assert.equal(s.monthlyAttendance(a.id,'2024-02').length,1);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-02-29',present:false});
    assert.deepEqual(s.monthlyAttendance(a.id,'2024-02')[0].days,[]);
    assert.throws(()=>s.monthlyAttendance(a.id,'2024-13'),/월/);
  } finally {s.close();}
});

test('전체 현장 출역 통계는 기간과 당시 근로 구분을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),empty=s.createSite({name:'가상 C'}),one=s.createWorker({siteId:a.id,name:'가상 1',category:'직영',company:'가상 업체',occupation:'가상 직종'}),two=s.createWorker({siteId:b.id,name:'가상 2',category:'외주',company:'가상 업체',occupation:'가상 직종'});
    for(const [site,worker,date] of [[a,one,'2026-10-01'],[a,one,'2026-10-02'],[b,two,'2026-10-01'],[b,two,'2026-11-01']])s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2026-10-02',present:false});
    s.updateWorker(one.id,{siteId:a.id,name:'가상 1',category:'외주',company:'가상 업체',occupation:'가상 직종'});
    const rows=s.attendanceSitesReport('2026-10-01','2026-10-31');assert.deepEqual(rows.find(row=>row.id===a.id).categories,[{label:'직영',days:1}]);assert.deepEqual(rows.find(row=>row.id===b.id).categories,[{label:'외주',days:1}]);assert.deepEqual(rows.find(row=>row.id===empty.id).categories,[]);
    assert.deepEqual(s.attendanceSitesReport('2026-10-02','2026-10-02').map(row=>row.categories),[[],[],[]]);assert.throws(()=>s.attendanceSitesReport('2026-10-02','2026-10-01'),/시작일/);assert.throws(()=>s.attendanceSitesReport('2026-02-30','2026-03-01'),/날짜/);
  }finally{s.close();}
});

test('출역 인일을 기간과 현장에 따라 근로자·직종·소속별로 집계한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,name,company,occupation)=>s.createWorker({siteId,name,category:'직영',company,occupation});
    const one=add(a.id,'동명이인','가상 회사 A','목공'),two=add(a.id,'동명이인','가상 회사 B','목공'),other=add(b.id,'다른 현장','가상 회사 A','목공');
    for(const [siteId,worker,date] of [[a.id,one,'2026-10-27'],[a.id,one,'2026-10-28'],[a.id,two,'2026-10-28'],[b.id,other,'2026-10-28']])s.setAttendance({siteId,workerId:worker.id,date,present:true});
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-27','2026-10-28','worker').map(r=>r.days).sort(),[1,2]);
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-28','occupation')[0].days,3);
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-28','2026-10-28','company').map(r=>r.days),[1,1]);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2026-10-28',present:false});
    assert.equal(s.attendanceReport(a.id,'2026-10-28','2026-10-28','occupation')[0].days,1);
    assert.throws(()=>s.attendanceReport(a.id,'2026-10-29','2026-10-28','worker'),/시작일/);
    assert.throws(()=>s.attendanceReport(a.id,'2026-10-27','2026-10-28','invalid'),/기준/);
  } finally {s.close();}
});

test('출입자 수정은 현장 경계를 지키고 과거 출역의 소속·직종을 바꾸지 않는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'이전 업체',occupation:'목공'});
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-27',present:true});
    const changed={siteId:a.id,name:'수정된 이름',category:'외주',company:'새 업체',occupation:'전기'};
    assert.throws(()=>s.updateWorker(worker.id,{...changed,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateWorker(worker.id,{...changed,name:''}),/이름/);
    assert.equal(s.workers(a.id)[0].name,'가상 근로자');
    s.updateWorker(worker.id,changed);
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:true});
    const report=s.attendanceReport(a.id,'2026-10-27','2026-10-28','company');
    assert.deepEqual(report.map(r=>[r.label,r.days]),[['새 업체',1],['이전 업체',1]]);
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-27','2026-10-28','category').map(r=>[r.label,r.days]),[['외주',1],['직영',1]]);
    s.recordWorkerLogin(worker.id,'2026-10-29');
    assert.equal(s.attendanceReport(a.id,'2026-10-29','2026-10-29','category')[0].label,'외주');
    assert.equal(s.attendance(a.id,'2026-10-27')[0].present,1);
    s.db.prepare("UPDATE attendance SET company_snapshot=NULL,occupation_snapshot=NULL,category_snapshot=NULL WHERE date='2026-10-27'").run();
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-27','company')[0].label,'기록 없음');
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-27','category')[0].label,'기록 없음');
  } finally {s.close();}
});
