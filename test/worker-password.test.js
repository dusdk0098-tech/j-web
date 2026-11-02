import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {WorkerSessions} from '../auth.js';
import {WorkerPassword} from '../worker-password.js';

const oldPassword='virtual-old-password',newPassword='virtual-new-password';
const input=(currentPassword=oldPassword)=>({currentPassword,newPassword,confirmPassword:newPassword});
function setup(s){
  const site=s.createSite({name:'가상 현장'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'가상 직종',loginId:'virtual_worker',password:oldPassword,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
  const sessions=new WorkerSessions(s.db),expires=Date.now()+600000;for(const key of ['a'.repeat(64),'b'.repeat(64)])sessions.set(key,{worker:{id:worker.id,site_id:site.id},expires});
  return {site,worker,sessions,siteKey:s.siteAccessKey(site.id)};
}

test('현재 암호를 확인하고 변경하면 기존 근로자 세션을 모두 종료한다',async()=>{
  const s=new Store(':memory:');try{
    const {site,worker,sessions,siteKey}=setup(s),passwords=new WorkerPassword(s.db);
    assert.throws(()=>passwords.change(worker.id,{...input(),confirmPassword:'다름'}),/암호/);
    assert.throws(()=>passwords.change(worker.id,input('틀린 암호')),e=>e.sessionStatus===403);assert.ok(sessions.get('a'.repeat(64)));
    let checks=0;await assert.rejects(passwords.changeAsync(worker.id,input(),()=>{if(++checks===2)throw Error('세션 만료');},'가상 주소'),/세션 만료/);assert.ok(sessions.get('b'.repeat(64)));
    const result=await passwords.changeAsync(worker.id,input(),()=>{},'가상 주소');assert.deepEqual(result,{siteId:site.id,loginId:'virtual_worker'});
    assert.equal(sessions.get('a'.repeat(64)),undefined);assert.equal(sessions.get('b'.repeat(64)),undefined);
    assert.equal(s.authenticateWorker(null,'virtual_worker',oldPassword,siteKey),null);assert.equal(s.authenticateWorker(null,'virtual_worker',newPassword,siteKey).id,worker.id);
  }finally{s.close();}
});

test('현재 암호 실패 제한은 인스턴스가 바뀌어도 유지되고 관리자 재설정이 해제한다',()=>{
  const s=new Store(':memory:');try{
    const {site,worker,siteKey}=setup(s);let now=1000000;const passwords=new WorkerPassword(s.db,()=>now);
    for(let i=0;i<10;i++)assert.throws(()=>passwords.change(worker.id,input('틀린 암호')),e=>e.sessionStatus===403);
    assert.throws(()=>new WorkerPassword(s.db,()=>now).change(worker.id,input()),e=>e.sessionStatus===429);
    s.resetWorkerPassword(site.id,worker.id,'virtual-admin-reset');assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_password_failures WHERE worker_id=?').get(worker.id).n,0);
    assert.equal(s.authenticateWorker(null,'virtual_worker','virtual-admin-reset',siteKey).id,worker.id);
    assert.deepEqual(passwords.change(worker.id,input('virtual-admin-reset')),{siteId:site.id,loginId:'virtual_worker'});
    for(let i=0;i<10;i++)assert.throws(()=>passwords.change(worker.id,{currentPassword:'틀린 암호',newPassword:oldPassword,confirmPassword:oldPassword}),e=>e.sessionStatus===403);
    now+=300001;assert.deepEqual(passwords.change(worker.id,{currentPassword:newPassword,newPassword:oldPassword,confirmPassword:oldPassword}),{siteId:site.id,loginId:'virtual_worker'});
  }finally{s.close();}
});

test('저장 실패는 암호와 기존 세션을 함께 보존한다',()=>{
  const s=new Store(':memory:');try{
    const {site,worker,sessions,siteKey}=setup(s),passwords=new WorkerPassword(s.db);s.db.exec("CREATE TRIGGER fail_worker_password BEFORE DELETE ON worker_sessions BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");
    assert.throws(()=>passwords.change(worker.id,input()),/가상 저장 실패/);assert.ok(sessions.get('a'.repeat(64)));assert.equal(s.authenticateWorker(null,'virtual_worker',oldPassword,siteKey).id,worker.id);assert.equal(s.authenticateWorker(null,'virtual_worker',newPassword,siteKey),null);
    s.db.exec("DROP TRIGGER fail_worker_password; CREATE TRIGGER fail_worker_limit BEFORE DELETE ON worker_password_failures BEGIN SELECT RAISE(ABORT,'가상 제한 삭제 실패'); END");s.db.prepare('INSERT INTO worker_password_failures(worker_id,attempted_at) VALUES(?,?)').run(worker.id,Date.now());
    assert.throws(()=>s.resetWorkerPassword(site.id,worker.id,'virtual-admin-reset'),/가상 제한 삭제 실패/);assert.ok(sessions.get('a'.repeat(64)));assert.equal(s.authenticateWorker(null,'virtual_worker',oldPassword,siteKey).id,worker.id);
  }finally{s.close();}
});
