import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { issueWorkerInvitationQr } from '../qr-issue.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('출입자 소속은 선택한 현장 업체만 연결하고 기존 확인값을 유지한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const a=store.createCompany({siteId:site.id,name:'같은 이름',trade:'공종 A'}),b=store.createCompany({siteId:site.id,name:'같은 이름',trade:'공종 B'}),foreign=store.createCompany({siteId:other.id,name:'다른 업체',trade:'공종'});
    const fields={siteId:site.id,name:'가상 근로자',category:'직영',company:'같은 이름',occupation:'가상 직종'};
    const old=store.createWorker(fields),linked=store.createWorker({...fields,companyId:a.id});
    assert.equal(old.company_id,null);assert.equal(linked.company_id,a.id);
    assert.throws(()=>store.createWorker({...fields,companyId:foreign.id}),/같은 현장/);
    assert.throws(()=>store.createWorker({...fields,companyId:String(a.id)}),/등록 협력사/);
    assert.throws(()=>store.updateWorker(linked.id,{...fields,company:'직접 입력',version:linked.version}),/새로고침/);
    const switched=store.updateWorker(linked.id,{...fields,companyId:b.id,version:linked.version});
    assert.equal(switched.company_id,b.id);assert.notEqual(switched.version,linked.version);
    assert.throws(()=>store.updateWorker(linked.id,{...fields,companyId:a.id,version:linked.version}),/변경/);
    const retained=store.updateWorker(switched.id,{...fields,version:switched.version});assert.equal(retained.company_id,b.id);
    assert.throws(()=>store.archiveCompany(b.id,{siteId:site.id,expectedName:b.name,expectedTrade:b.trade}),/사용 중/);
    const unlinked=store.updateWorker(retained.id,{...fields,company:'직접 입력',companyId:0,version:retained.version});assert.equal(unlinked.company_id,null);
    assert.equal(store.workers(site.id).find(row=>row.id===old.id).version,old.version);
  }finally{store.close();}
});

test('출역 당시의 소속 번호는 변경과 직접 입력에서 올바르게 보존된다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),a=store.createCompany({siteId:site.id,name:'가상 업체 A',trade:'공종'}),b=store.createCompany({siteId:site.id,name:'가상 업체 B',trade:'공종'}),fields={siteId:site.id,name:'가상 근로자',category:'직영',company:a.name,occupation:'가상 직종'};
    const worker=store.createWorker({...fields,companyId:a.id}),date='2026-10-02';
    store.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});
    const changed=store.updateWorker(worker.id,{...fields,company:b.name,companyId:b.id,version:worker.version});
    const doc=store.createDocument({siteId:site.id,type:'safety_meeting',title:'가상 회의',date,details:{workerIds:[worker.id]}});
    const details=JSON.parse(doc.details);assert.equal(details.workerSnapshot[0].companyId,a.id);assert.equal(details.workerSnapshot[0].company,a.name);
    store.recordWorkerLogin(worker.id,'2026-10-03');assert.equal(store.attendance(site.id,'2026-10-03')[0].attendance_company_id,b.id);
    store.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2026-10',company:'직접 변경'});
    assert.equal(store.attendance(site.id,date)[0].attendance_company_id,null);
    assert.equal(store.attendance(site.id,'2026-10-03')[0].attendance_company_id,null);
    assert.equal(JSON.parse(store.documents(site.id,'safety_meeting')[0].details).workerSnapshot[0].companyId,a.id);
    assert.equal(changed.company_id,b.id);
  }finally{store.close();}
});

test('가입에서 선택한 업체 번호가 로그인 출역과 간담회까지 전달된다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),a=store.createCompany({siteId:site.id,name:'같은 업체',trade:'A'}),b=store.createCompany({siteId:site.id,name:'같은 업체',trade:'B'}),token=store.createInvitation(site.id).token;
    const worker=store.join(token,{name:'가상 근로자',category:'직영',company:a.name,companyId:b.id,occupation:'가상 직종',loginId:'virtual_user',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    assert.equal(worker.company_id,b.id);const date='2026-10-02';store.recordWorkerLogin(worker.id,date);const doc=store.createDocument({siteId:site.id,type:'safety_meeting',title:'가상 회의',date,details:{workerIds:[worker.id]}});assert.equal(JSON.parse(doc.details).workerSnapshot[0].companyId,b.id);
  }finally{store.close();}
});

test('이전 DB의 개인 QR은 업체 번호 열을 추가한 뒤에도 사용된다',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-old-worker-')),file=join(dir,'jweb.sqlite');let store=new Store(file);
  try{
    const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),invite=await issueWorkerInvitationQr(store,site.id,worker.id,worker.version,'https://example.test',async()=> '가상 QR'),token=new URL(invite.link).searchParams.get('token');
    store.close();store=null;const old=new DatabaseSync(file);try{old.exec('ALTER TABLE workers DROP COLUMN company_id');}finally{old.close();}
    store=new Store(file);assert.equal(store.workers(site.id)[0].version,worker.version);
    const joined=store.join(token,{name:worker.name,loginId:'virtual_old',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});assert.equal(joined.id,worker.id);assert.equal(joined.company_id,null);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
