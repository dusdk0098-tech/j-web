import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {issueWorkerInvitationQr} from '../qr-issue.js';

const input=(name='가상 출입자')=>({name,loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
const worker=(s,siteId)=>s.createWorker({siteId,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종',memo:'가상 메모'});
const token=result=>new URL(result.link).searchParams.get('token');
const issue=(s,site,w,render=async()=> '가상 QR',authorize=()=>{})=>issueWorkerInvitationQr(s,site.id,w.id,w.version,'https://example.test',render,authorize);

test('개인 가입은 기존 출입자와 출역·첨부를 보존하며 한 번만 연결한다',async()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),w=worker(s,site.id);
    s.setAttendance({siteId:site.id,workerId:w.id,date:'2026-11-01',present:true});s.addWorkerFile(site.id,w.id,'other','가상.txt',Buffer.from('가상 첨부'));
    const before=s.workers(site.id)[0],invite=await issue(s,site,w),key=token(invite),record=s.invitation(key);
    assert.equal(record.worker_id,w.id);assert.ok(invite.expiresAt>Date.now());assert.ok(invite.expiresAt<=Date.now()+24*60*60*1000);
    assert.throws(()=>s.join(key,input('다른 가상 이름')),/출입자 정보/);assert.ok(s.invitation(key));
    const joined=s.join(key,input());assert.equal(joined.id,w.id);assert.deepEqual(s.workers(site.id).map(row=>row.id),[w.id]);
    const after=s.workers(site.id)[0];for(const field of ['name','category','company','occupation','memo','registration_type','version'])assert.equal(after[field],before[field]);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE worker_id=?').get(w.id).n,1);assert.equal(s.workerFiles(site.id,w.id).length,1);
    assert.equal(s.authenticateWorker(null,'virtual_worker','virtual-password-123',s.siteAccessKey(site.id)).id,w.id);
    assert.equal(s.invitation(key),null);assert.throws(()=>s.join(key,input()),/가입 링크/);
    await assert.rejects(issue(s,site,w),/이미 가입 기록/);
  }finally{s.close();}
});

test('같은 이름이 여러 명이어도 관리자가 지정한 출입자에게만 연결한다',async()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),first=worker(s,site.id),second=s.createWorker({siteId:site.id,name:first.name,category:'직영',company:'다른 가상 회사',occupation:'가상 직종'});
    const invite=await issue(s,site,second),joined=s.join(token(invite),input());assert.equal(joined.id,second.id);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_accounts WHERE worker_id=?').get(first.id).n,0);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_accounts WHERE worker_id=?').get(second.id).n,1);
  }finally{s.close();}
});

test('개인 QR 재발급·중지와 화면 생성 실패는 이전 유효 주소를 올바르게 처리한다',async()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),w=worker(s,site.id),first=await issue(s,site,w),old=token(first);
    await assert.rejects(issue(s,site,w,async()=>{throw Error('이미지 실패');}),/이미지 실패/);assert.ok(s.invitation(old));
    let checks=0;await assert.rejects(issue(s,site,w,async()=> '가상 QR',()=>{if(++checks===2)throw Error('권한 만료');}),/권한 만료/);assert.ok(s.invitation(old));
    const second=await issue(s,site,w);assert.equal(s.invitation(old),null);assert.ok(s.invitation(token(second)));
    let release;const pending=issue(s,site,w,()=>new Promise(resolve=>{release=resolve;}));s.revokeInvitations(site.id);release('가상 QR');assert.equal(await pending,null);
    assert.equal(s.invitation(token(second)),null);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE pending=1').get().n,0);
  }finally{s.close();}
});

test('출입자 정보의 변경과 복구, 초대 만료 후에는 이전 개인 주소를 사용할 수 없다',async()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),w=worker(s,site.id),first=await issue(s,site,w),old=token(first);
    s.updateWorker(w.id,{siteId:site.id,name:w.name,category:w.category,company:'변경된 가상 회사',occupation:w.occupation,memo:w.memo,version:w.version});
    const changed=s.workers(site.id)[0];s.updateWorker(w.id,{siteId:site.id,name:w.name,category:w.category,company:w.company,occupation:w.occupation,memo:w.memo,version:changed.version});
    assert.equal(s.invitation(old),null);assert.throws(()=>s.join(old,input()),/가입 링크/);
    const fresh=await issue(s,site,s.workers(site.id)[0]),key=token(fresh);s.db.prepare('UPDATE invitations SET expires_at=0 WHERE worker_id=?').run(w.id);
    assert.equal(s.invitation(key),null);assert.throws(()=>s.join(key,input()),/가입 링크/);
  }finally{s.close();}
});

test('현장·관리자 권한·수정 경합과 저장 실패는 개인 초대나 계정을 만들지 않는다',async()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 가상 현장'}),w=worker(s,site.id);
    await assert.rejects(issue(s,other,w),/출입자 정보/);
    await assert.rejects(issue(s,site,w,async()=> '가상 QR',()=>{throw Error('권한 만료');}),/권한 만료/);
    let release;const pending=issue(s,site,w,()=>new Promise(resolve=>{release=resolve;}));
    s.updateWorker(w.id,{siteId:site.id,name:w.name,category:w.category,company:'변경된 가상 회사',occupation:w.occupation,memo:w.memo,version:w.version});release('가상 QR');assert.equal(await pending,null);
    const current=s.workers(site.id)[0],invite=await issue(s,site,current),key=token(invite);
    s.db.exec("CREATE TRIGGER fail_worker_claim BEFORE INSERT ON join_acknowledgements BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");
    assert.throws(()=>s.join(key,input()),/가상 저장 실패/);assert.ok(s.invitation(key));assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_accounts').get().n,0);
    s.db.exec('DROP TRIGGER fail_worker_claim');assert.equal(s.join(key,input()).id,w.id);
  }finally{s.close();}
});
