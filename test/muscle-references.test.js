import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

const row={task:'가상 반복 작업',hazard:'가상 부담',selected:false,likelihood:'2',severity:'3',score:999};
test('참고자료는 가상 현장·척도별로 보존하고 잘못된 입력과 세션 취소를 원자적으로 거부한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),company=s.createCompany({siteId:a.id,name:'가상 업체',trade:'가상 공종'}),input={siteId:a.id,title:'가상 참고',scale:'3x3',items:[{...row,contractorId:company.id}]};
    const saved=s.saveMuscleReference(input);assert.equal(saved.items[0].score,6);assert.equal(saved.items[0].selected,false);assert.equal(saved.items[0].contractor,'가상 업체');
    assert.deepEqual(s.muscleReferences(b.id,'3x3'),[]);assert.deepEqual(s.muscleReferences(a.id,'5x4'),[]);
    const graded=s.saveMuscleReference({...input,scale:'three-level',items:[{task:'가상 작업',grade:'상',improvedGrade:'하',selected:true}]});assert.equal(graded.items[0].improvedGrade,'하');
    s.saveMuscleReference({...input,scale:'',items:[{task:'가상 작업',selected:true}]});
    s.saveMuscleReference({...input,scale:'5x4',items:[{...row,likelihood:'5',severity:'4'}]});
    for(const patch of [{siteId:b.id},{siteId:999999},{title:' '},{scale:'other'},{items:[]},{items:Array(101).fill(row)},{items:[{selected:true}]},{items:[{...row,selected:'true'}]},{items:[{...row,likelihood:'5'}]},{items:[{...row,hazard:'x'.repeat(2001)}]}])assert.throws(()=>s.saveMuscleReference({...input,...patch}));
    const deny=()=>{assert.equal(s.db.isTransaction,true);throw Error('세션 만료');};
    assert.throws(()=>s.saveMuscleReference(input,deny),/세션 만료/);assert.throws(()=>s.deleteMuscleReference(a.id,saved.id,deny),/세션 만료/);
    assert.throws(()=>s.deleteMuscleReference(b.id,saved.id),/현장/);assert.equal(s.muscleReferences(a.id,'3x3').length,1);
    const doc=s.createDocument({siteId:a.id,type:'risk',title:'가상 재사용',date:'2026-11-01',details:{scale:'3x3',musculoskeletalItems:saved.items}});assert.equal(JSON.parse(doc.details).musculoskeletalItems[0].score,6);
    const cycle=s.transition(doc.id,'submit').approval_cycle_id,details=s.document(doc.id).details;
    assert.deepEqual(s.deleteMuscleReference(a.id,saved.id),{ok:true});assert.deepEqual(s.muscleReferences(a.id,'3x3'),[]);
    assert.equal(s.document(doc.id).details,details);assert.equal(s.approvalCycle(doc.id,cycle).document.details,details);
  }finally{s.close();}
});

test('구형 DB 열기와 재시작 후 참고자료·기존 문서가 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-muscle-migration-')),path=join(dir,'test.sqlite');let s;
  try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 기존 문서',date:'2026-11-01'});s.db.exec('DROP TABLE muscle_references');s.close();
    s=new Store(path);assert.equal(s.document(doc.id).title,'가상 기존 문서');assert.deepEqual(s.muscleReferences(site.id,''),[]);const saved=s.saveMuscleReference({siteId:site.id,title:'가상 참고',scale:'3x3',items:[row]});s.close();
    s=new Store(path);assert.deepEqual(s.muscleReferences(site.id,'3x3'),[saved]);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP 관리자 CRUD와 근로자 현장·위험성평가 권한·읽기 전용을 적용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-muscle-http-'));const s=new Store(join(dir,'jweb.sqlite'));
  const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),invite=s.createInvitation(a.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'muscle_test',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
  s.saveMuscleReference({siteId:b.id,title:'다른 가상 현장',scale:'3x3',items:[row]});
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-123',JWEB_PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});
  try{
    const output=await once(child.stdout,'data');assert.match(String(output[0]),/J웹:/);
    const send=(path,method='GET',input,cookie='')=>fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'Content-Type':'application/json',cookie},body:input===undefined?undefined:JSON.stringify(input)});
    assert.equal((await send(`/api/muscle-references?siteId=${a.id}&scale=3x3`)).status,401);
    const login=await send('/api/login','POST',{password:'virtual-admin-123'}),admin=login.headers.get('set-cookie').split(';')[0];
    const posted=await send('/api/muscle-references','POST',{siteId:a.id,title:'가상 참고',scale:'3x3',items:[row]},admin);assert.equal(posted.status,201);const saved=await posted.json();assert.equal(saved.items[0].score,6);
    assert.deepEqual(await (await send(`/api/muscle-references?siteId=${a.id}&scale=3x3`,'GET',undefined,admin)).json(),[saved]);
    const workerLogin=await send('/api/worker/login','POST',{token:invite.token,loginId:'muscle_test',password:'virtual-password-123'});assert.equal(workerLogin.status,200);const cookie=workerLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/api/worker/muscle-references?scale=3x3','GET',undefined,cookie)).status,403);
    s.setWorkerPermissions(a.id,worker.id,['risk']);
    assert.deepEqual(await (await send(`/api/worker/muscle-references?scale=3x3&siteId=${b.id}`,'GET',undefined,cookie)).json(),[saved]);
    assert.equal((await send('/api/worker/muscle-references','POST',{siteId:a.id,title:'가상 쓰기',items:[row]},cookie)).status,401);
    assert.equal((await send(`/api/muscle-references/${saved.id}?siteId=${a.id}`,'DELETE',undefined,cookie)).status,401);
    assert.equal((await send(`/api/muscle-references/${saved.id}?siteId=${b.id}`,'DELETE',undefined,admin)).status,400);
    s.setWorkerPermissions(a.id,worker.id,[]);assert.equal((await send('/api/worker/muscle-references?scale=3x3','GET',undefined,cookie)).status,403);
    s.setWorkerPermissions(a.id,worker.id,['risk']);
    const connection=new DatabaseSync(join(dir,'jweb.sqlite')),list=s.muscleReferences.bind(s);
    try{s.muscleReferences=(...args)=>{const result=list(...args);connection.prepare('DELETE FROM worker_permissions WHERE worker_id=?').run(worker.id);return result;};assert.throws(()=>s.workerMuscleReferences(a.id,worker.id,'3x3'),error=>error.sessionStatus===403);}finally{s.muscleReferences=list;connection.close();}
    assert.deepEqual(await (await send(`/api/muscle-references/${saved.id}?siteId=${a.id}`,'DELETE',undefined,admin)).json(),{ok:true});
    assert.deepEqual(await (await send(`/api/muscle-references?siteId=${a.id}&scale=3x3`,'GET',undefined,admin)).json(),[]);
  }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}s.close();rmSync(dir,{recursive:true,force:true});}
});
