import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
const base={type:'office',title:'가상 업무',date:'2026-10-31',body:'가상 본문',details:{kind:'품의서'}};
function fixture(){
  const s=new Store(':memory:'),site=s.createSite({name:'가상 현장'}),outside=s.createSite({name:'다른 가상 현장'}),make=(id,name)=>s.createReviewer({siteId:id,loginId:name,name,password:'virtual-password-123'}),author=make(site.id,'edit_author'),reviewer=make(site.id,'edit_reviewer'),reference=make(site.id,'edit_reference'),other=make(outside.id,'edit_other');
  const source=s.createReviewerOfficeDocument(author.id,base),doc=s.createReviewerOfficeDocument(author.id,{...base,details:{kind:'품의서',referenceDocId:source.id},officeSetup:{reviewerIds:[reviewer.id],referenceIds:[reference.id],signature,referenceVersion:s.officeReferenceInfo(site.id,source.id).version}});
  const input=()=>({...base,siteId:site.id,title:'수정한 가상 업무',details:JSON.parse(s.document(doc.id).details),expectedEditVersion:s.document(doc.id).edit_version,officeEditSignature:{signature,version:s.officeEditSignatureVersion(s.document(doc.id)),referenceVersion:s.officeLinkedReferenceInfo(s.document(doc.id))?.version||null}});
  const snapshot=()=>JSON.stringify(['documents','office_document_authors','approval_steps','office_reference_recipients','meeting_signatures','office_reference_signature_versions'].map(table=>s.db.prepare(`SELECT * FROM ${table}`).all()));
  return {s,site,outside,author,reviewer,reference,other,source,doc,input,snapshot};
}

test('기존 업무 수정과 새 서명은 원자 저장하고 작성자·결재선·참조자·상태를 보존한다',()=>{
  const {s,site,author,reviewer,reference,source,doc,input}=fixture();try{
    const before=s.reviewerOfficeDetail(author.id,doc.id),saved=s.updateReviewerOfficeDocument(author.id,doc.id,input(),before.version),after=s.reviewerOfficeDetail(author.id,doc.id);
    assert.equal(saved.title,'수정한 가상 업무');assert.equal(saved.site_id,site.id);assert.equal(saved.status,'draft');assert.ok(saved.edit_version>before.document.edit_version);assert.equal(saved.edit_version,after.document.edit_version);assert.equal(after.hasSignature,true);assert.equal(after.signatureStale,false);assert.deepEqual(after.line,before.line);assert.deepEqual(after.references,before.references);assert.ok(s.reviewerOfficeDocuments(author.id).some(row=>row.id===doc.id));
    s.transition(doc.id,'submit');s.reviewerTransition(doc.id,reviewer.id,'reject','가상 반려');const rejected=s.document(doc.id);s.updateDocument(doc.id,input());assert.equal(s.document(doc.id).status,'rejected');assert.equal(s.document(doc.id).approval_cycle_id,rejected.approval_cycle_id);assert.equal(s.meetingSignature(doc.id)!==null,true);s.transition(doc.id,'revise');
    s.updateDocument(doc.id,{...input(),officeEditSignature:undefined});assert.equal(s.meetingSignature(doc.id),null);assert.deepEqual(s.approvalLine(doc.id).map(row=>row.reviewer_id),[reviewer.id]);assert.deepEqual(s.officeReferences(doc.id).map(row=>row.id),[reference.id]);
    s.updateDocument(doc.id,input());s.updateDocument(source.id,{...base,siteId:site.id,body:'참조 변경'});assert.equal(s.officeSignatureInfo(s.document(doc.id)).stale,true);
  }finally{s.close();}
});

test('내용·결재 준비·첨부 변경과 계정 중지 및 잘못된 서명은 기존 문서를 보존한다',()=>{
  const f=fixture(),{s,site,author,reviewer,reference,doc,input,snapshot}=f;try{
    for(const mutate of [()=>s.setApprovalLine(doc.id,[reference.id]),()=>s.setOfficeReferences(doc.id,[]),()=>s.addAttachment(doc.id,'가상.txt',Buffer.from('가상 파일')),()=>s.updateDocument(doc.id,{...input(),officeEditSignature:undefined}),()=>s.updateReviewer(site.id,reference.id,{active:false})]){
      const stale=input();mutate();const before=snapshot();assert.throws(()=>s.updateDocument(doc.id,stale),error=>error.sessionStatus===409);assert.equal(snapshot(),before);
    }
    s.updateReviewer(site.id,reference.id,{active:true});s.setApprovalLine(doc.id,[reviewer.id]);s.setOfficeReferences(doc.id,[reference.id]);
    for(const person of [author,reviewer,reference]){s.updateReviewer(site.id,person.id,{active:false});const before=snapshot();assert.throws(()=>s.updateDocument(doc.id,input()),/활성/);assert.equal(snapshot(),before);s.updateReviewer(site.id,person.id,{active:true});}
    for(const bad of [{...input(),siteId:f.outside.id},{...input(),type:'tbm'},{...input(),expectedEditVersion:undefined},{...input(),officeEditSignature:{...input().officeEditSignature,signature:'invalid'}},{...input(),officeEditSignature:{...input().officeEditSignature,referenceVersion:'old'}}]){const before=snapshot();assert.throws(()=>s.updateDocument(doc.id,bad));assert.equal(snapshot(),before);}
    const before=snapshot();assert.throws(()=>s.updateDocument(doc.id,input(),()=>{throw Object.assign(Error('인증 회수'),{sessionStatus:401});}),/인증 회수/);assert.equal(snapshot(),before);
    assert.throws(()=>s.updateReviewerOfficeDocument(f.other.id,doc.id,input(),s.reviewerOfficeDetail(author.id,doc.id).version));assert.equal(snapshot(),before);
    for(const table of ['meeting_signatures','office_reference_signature_versions']){s.db.exec(`CREATE TRIGGER fail_edit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END`);assert.throws(()=>s.updateDocument(doc.id,input()),/가상 저장 실패/);assert.equal(snapshot(),before);s.db.exec('DROP TRIGGER fail_edit');}
  }finally{s.close();}
});

test('참조 없는 업무도 결재선과 참조자 변경을 탐지하며 새 참조 연결을 서명한다',()=>{
  const {s,site,author,reviewer,source,input,doc}=fixture();try{
    s.updateDocument(doc.id,{...input(),details:{kind:'품의서',referenceDocId:0},officeEditSignature:undefined});const value=input();assert.equal(value.officeEditSignature.referenceVersion,null);s.updateDocument(doc.id,value);assert.ok(s.meetingSignature(doc.id));
    const stale=input();s.setApprovalLine(doc.id,[]);assert.throws(()=>s.updateDocument(doc.id,stale),error=>error.sessionStatus===409);assert.throws(()=>s.updateDocument(doc.id,input()),/활성/);s.setApprovalLine(doc.id,[reviewer.id]);
    const next=input();next.details.referenceDocId=source.id;next.officeEditSignature.referenceVersion=s.officeReferenceInfo(site.id,source.id).version;s.updateReviewerOfficeDocument(author.id,doc.id,next,s.reviewerOfficeDetail(author.id,doc.id).version);assert.equal(s.officeSignatureInfo(s.document(doc.id)).stale,false);
    s.transition(doc.id,'submit');const before=s.document(doc.id);assert.throws(()=>s.updateDocument(doc.id,input()),/임시저장/);assert.deepEqual(s.document(doc.id),before);
  }finally{s.close();}
});
