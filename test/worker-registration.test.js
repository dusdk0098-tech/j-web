import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {PNG} from 'pngjs';

const person=siteId=>({siteId,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종'});
function setup(s){
  const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 가상 현장'}),invite=s.createInvitation(site.id),png=new PNG({width:1,height:1});png.data[3]=255;
  const input={...person(site.id),loginId:'virtual_self',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'},signature:'data:image/png;base64,'+PNG.sync.write(png).toString('base64')};
  const worker=s.join(invite.token,input),general=s.createWorker({...person(site.id),registration_type:'self'});
  s.setWorkerPermissions(site.id,worker.id,['attendance']);
  s.db.prepare('INSERT INTO worker_sessions(token_hash,worker_id,expires,credential_hash) SELECT ?,worker_id,?,password_hash FROM worker_accounts WHERE worker_id=?').run('virtual-session',Date.now()+3600000,worker.id);
  s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-11-01',present:true});s.addWorkerFile(site.id,worker.id,'other','가상.txt',Buffer.from('가상 첨부'));
  return {site,other,invite,input,worker,general};
}
const preserved=s=>Object.fromEntries(['worker_accounts','join_acknowledgements','attendance','worker_files','worker_sessions','worker_permissions'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all()]));

test('등록 전환은 계정·가입 서명·출역·첨부를 보존하고 경합·현장·권한·실패를 검증한다',()=>{
  const s=new Store(':memory:');try{
    const {site,other,invite,input,worker,general}=setup(s),row=()=>s.workers(site.id).find(w=>w.id===worker.id),initial=row(),before=preserved(s);
    assert.equal(worker.registration_type,'self');assert.equal(general.registration_type,'general');
    assert.throws(()=>s.convertWorkerRegistration(worker.id,{siteId:other.id,version:initial.version}),/현장/);
    assert.throws(()=>s.convertWorkerRegistration(worker.id,{siteId:site.id}),e=>e.sessionStatus===409);
    assert.throws(()=>s.convertWorkerRegistration(worker.id,{siteId:site.id,version:initial.version},()=>{throw Error('세션 만료');}),/세션/);
    assert.throws(()=>s.updateWorker(worker.id,{...person(site.id),name:'',version:initial.version}),/이름/);
    s.db.exec("CREATE TRIGGER fail_registration BEFORE UPDATE ON workers BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    assert.throws(()=>s.convertWorkerRegistration(worker.id,{siteId:site.id,version:initial.version}),/forced failure/);
    assert.throws(()=>s.updateWorker(worker.id,{...person(site.id),name:'가상 변경',version:initial.version}),/forced failure/);
    assert.deepEqual(row(),initial);assert.deepEqual(preserved(s),before);s.db.exec('DROP TRIGGER fail_registration');
    const changed=s.convertWorkerRegistration(worker.id,{siteId:site.id,version:initial.version});assert.equal(changed.registration_type,'general');assert.notEqual(changed.version,initial.version);
    assert.throws(()=>s.convertWorkerRegistration(worker.id,{siteId:site.id,version:initial.version}),e=>e.sessionStatus===409);
    assert.throws(()=>s.updateWorker(worker.id,{...person(site.id),version:initial.version}),e=>e.sessionStatus===409);
    assert.deepEqual(preserved(s),before);assert.equal(s.authenticateWorker(invite.token,input.loginId,input.password).id,worker.id);
    assert.equal(s.convertWorkerRegistration(worker.id,{siteId:site.id,version:changed.version}).registration_type,'general');
    const second=s.join(invite.token,{...input,loginId:'virtual_second'});const secondBefore=preserved(s);
    const edited=s.updateWorker(second.id,{...person(site.id),name:'가상 구형 수정'});assert.equal(edited.registration_type,'general');assert.equal(edited.name,'가상 구형 수정');assert.deepEqual(preserved(s),secondBefore);
  }finally{s.close();}
});

test('기존 DB는 가입과 동일 현장 계정으로 한 번 이관하고 전환 후 재시작에도 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-registration-')),path=join(dir,'test.sqlite');let s=new Store(path);
  try{
    const {site,worker,general}=setup(s),before=preserved(s);
    const ambiguous=s.createWorker(person(site.id));s.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version) VALUES(?,?)').run(ambiguous.id,'demo-v1');
    s.db.exec('ALTER TABLE workers DROP COLUMN registration_type');s.close();s=new Store(path);
    let rows=s.workers(site.id);assert.equal(rows.find(w=>w.id===worker.id).registration_type,'self');assert.equal(rows.find(w=>w.id===general.id).registration_type,'general');assert.equal(rows.find(w=>w.id===ambiguous.id).registration_type,'general');
    for(const table of Object.keys(before))assert.deepEqual(preserved(s)[table].filter(row=>row.worker_id!==ambiguous.id),before[table]);
    s.convertWorkerRegistration(worker.id,{siteId:site.id,version:rows.find(w=>w.id===worker.id).version});s.close();s=new Store(path);assert.equal(s.workers(site.id).find(w=>w.id===worker.id).registration_type,'general');
    assert.equal(s.joinSignature(site.id,worker.id).length>0,true);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
