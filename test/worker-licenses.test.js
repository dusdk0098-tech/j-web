import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
const person=siteId=>({siteId,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종'});
const preserved=s=>Object.fromEntries(['worker_accounts','join_acknowledgements','worker_files','worker_sessions','worker_permissions'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all()]));

test('면허 생성·목록·수정·부분 빈 값·삭제·생략 보존·버전 경합',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input=person(site.id),w=s.createWorker({...input,licenses:[{name:' 가상 면허 ',number:' 가상-001 '},{name:'이름만'},{number:'번호만'},{name:' ',number:''}]});
    assert.deepEqual(w.licenses,[{name:'가상 면허',number:'가상-001'},{name:'이름만',number:''},{name:'',number:'번호만'}]);assert.deepEqual(s.workers(site.id)[0].licenses,w.licenses);
    const changed=s.updateWorker(w.id,{...input,version:w.version,licenses:[{name:'가상 면허',number:'수정 번호'}]});assert.notEqual(changed.version,w.version);
    assert.throws(()=>s.updateWorker(w.id,{...input,version:w.version,licenses:[]}),e=>e.sessionStatus===409);
    assert.throws(()=>s.convertWorkerRegistration(w.id,{siteId:site.id,version:w.version}),e=>e.sessionStatus===409);
    assert.throws(()=>s.previewWorkers(site.id,[{id:w.id,version:w.version}]),e=>e.sessionStatus===409);
    assert.deepEqual(s.previewWorkers(site.id,[{id:w.id,version:changed.version}]).workers[0].licenses,changed.licenses);
    assert.deepEqual(s.updateWorker(w.id,{...input,name:'구형 가상 수정'}).licenses,changed.licenses);
    assert.deepEqual(s.updateWorker(w.id,{...input,licenses:[]}).licenses,[]);
    assert.equal(s.updateWorker(w.id,{...input,licenses:Array.from({length:20},()=>({name:'가'.repeat(100),number:'0'.repeat(100)}))}).licenses.length,20);
  }finally{s.close();}
});

test('면허 형식·제한·현장·인증·DB 실패는 자기등록 및 계정·첨부를 원자적으로 보존',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 가상 현장'}),invite=s.createInvitation(site.id),input=person(site.id),credentials={...input,loginId:'virtual_license',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}},w=s.join(invite.token,{...credentials,licenses:[{name:'주입 면허'}]});
    assert.deepEqual(w.licenses,[]);assert.equal(w.version,s.workers(site.id)[0].version);
    s.addWorkerFile(site.id,w.id,'other','가상.txt',Buffer.from('가상 첨부'));s.setWorkerPermissions(site.id,w.id,['attendance']);
    const read=()=>s.workers(site.id)[0],initial=read(),before=preserved(s);
    for(const licenses of [null,{},'bad',[null],[[]],[{name:3}],[{number:null}],[{name:'가'.repeat(101)}],[{number:'0'.repeat(101)}],[{name:'가\n상'}],[{unexpected:'x'}],Array(21).fill({})]){
      assert.throws(()=>s.updateWorker(w.id,{...input,licenses}),/면허/);assert.deepEqual(read(),initial);assert.deepEqual(preserved(s),before);
      assert.throws(()=>s.createWorker({...input,licenses}),/면허/);assert.equal(s.workers(site.id).length,1);
    }
    assert.throws(()=>s.updateWorker(w.id,{...input,siteId:other.id,licenses:[]}),/현장/);
    assert.throws(()=>s.updateWorker(w.id,{...input,licenses:[]},()=>{throw Error('세션 만료');}),/세션/);
    s.db.exec("CREATE TRIGGER fail_licenses AFTER UPDATE ON workers BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    assert.throws(()=>s.updateWorker(w.id,{...input,name:'가상 변경',licenses:[{name:'가상 면허'}]}),/forced failure/);assert.deepEqual(read(),initial);assert.deepEqual(preserved(s),before);s.db.exec('DROP TRIGGER fail_licenses');
    const result=s.updateWorker(w.id,{...input,version:initial.version,licenses:[{name:'가상 면허'}]});assert.equal(result.registration_type,'general');assert.deepEqual(result.licenses,[{name:'가상 면허',number:''}]);assert.deepEqual(preserved(s),before);assert.equal(s.authenticateWorker(invite.token,credentials.loginId,credentials.password).id,w.id);
  }finally{s.close();}
});

test('과거 DB 이관은 기존 자료를 유지하며 면허 저장 후 재시작에도 보존',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-license-')),path=join(dir,'virtual.sqlite');let s=new Store(path);
  try{
    const site=s.createSite({name:'가상 현장'}),input=person(site.id),w=s.createWorker({...input,memo:'과거 가상 메모'});s.addWorkerFile(site.id,w.id,'other','가상.txt',Buffer.from('가상 첨부'));const before=preserved(s);
    s.db.exec('ALTER TABLE workers DROP COLUMN licenses_json');const old=s.db.prepare('SELECT * FROM workers').get();s.close();s=new Store(path);
    assert.deepEqual({...s.db.prepare('SELECT * FROM workers').get(),licenses_json:undefined},{...old,licenses_json:undefined});assert.deepEqual(s.workers(site.id)[0].licenses,[]);assert.deepEqual(preserved(s),before);
    const saved=s.updateWorker(w.id,{...input,licenses:[{name:'가상 면허',number:'가상-01'}]});s.close();s=new Store(path);assert.deepEqual(s.workers(site.id)[0].licenses,saved.licenses);assert.equal(s.workers(site.id)[0].memo,'과거 가상 메모');assert.deepEqual(preserved(s),before);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
