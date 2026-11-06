import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {fetchWithWorkerSession as fetch} from './helpers/worker-session-request.js';

const complete={kind:'regular',timeFrom:'09:00',timeTo:'10:00',educationPlace:'가상 교육장',educationMethod:'가상 강의',instructor:'가상 강사',textbook:'가상 교재'};
const input=details=>({type:'education',title:'가상 교육',date:'2026-11-01',details});
const required=['kind','timeFrom','timeTo','educationPlace','educationMethod','instructor','textbook'];

test('교육 제출은 저장된 필드의 누락·형식·공백을 검사하며 실패 시 상태·이벤트·결재 사본을 보존한다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'});
    const invalid=[...required.map(key=>{const details={...complete};delete details[key];return details;}),...required.map(key=>({...complete,[key]:'   '})),{...complete,timeFrom:'25:00'},{...complete,timeFrom:'11:00'},{...complete,instructor:7},{...complete,educationPlace:'가'.repeat(2001)}];
    for(const details of invalid){
      const doc=s.createDocument({siteId:site.id,...input({})});
      // 이전 저장 자료도 신규 결재 요청에서는 같은 규칙을 적용한다.
      s.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify(details),doc.id);
      const before=s.document(doc.id),events=s.events(doc.id),cycles=s.db.prepare('SELECT count(*) AS n FROM approval_cycles WHERE document_id=?').get(doc.id).n;
      assert.throws(()=>s.transition(doc.id,'submit'),/교육|사용교재/);
      assert.deepEqual(s.document(doc.id),before);assert.deepEqual(s.events(doc.id),events);
      assert.equal(s.db.prepare('SELECT count(*) AS n FROM approval_cycles WHERE document_id=?').get(doc.id).n,cycles);
    }
    for(const [timeFrom,timeTo] of [['09:00','10:00'],['09:00','09:00'],['23:00','24:00'],['24:00','24:00']]){
      const details={...complete,timeFrom,timeTo},doc=s.createDocument({siteId:site.id,...input(details)});
      assert.equal(s.transition(doc.id,'submit').status,'pending');
      assert.deepEqual(JSON.parse(s.approvalCycle(doc.id,s.document(doc.id).approval_cycle_id).document.details),details);
    }
  }finally{s.close();}
});

test('교육 임시저장과 기존 요청·완료 열람 및 이전 요청 승인·취소는 필수값 누락으로 막히지 않는다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const draft=s.createDocument({siteId:site.id,...input({})});assert.equal(draft.status,'draft');
    s.updateDocument(draft.id,{siteId:site.id,...input({educationPlace:'가상 장소'})});assert.equal(s.document(draft.id).status,'draft');
    for(const action of ['approve','withdraw']){
      const doc=s.createDocument({siteId:site.id,...input({})});s.db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(doc.id);
      assert.deepEqual(JSON.parse(s.document(doc.id).details),{});
      assert.equal(s.transition(doc.id,action).status,action==='approve'?'approved':'draft');
      if(action==='approve'){assert.ok(s.workerTraining(worker.id,'2026-11-01').some(row=>row.id===doc.id));assert.equal(s.document(doc.id).status,'approved');}
      else assert.throws(()=>s.transition(doc.id,'submit'),/교육시간/);
    }
    const tbm=s.createDocument({siteId:site.id,...input({}),type:'tbm'});assert.equal(s.transition(tbm.id,'submit').status,'pending');
  }finally{s.close();}
});

test('관리자·작성 허용 근로자 API는 각 누락을 차단하고 완성 제출·권한 회수·오래된 버전을 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-education-submit-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const call=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const person={token,name:'가상 근로자',category:'직영',occupation:'목공',loginId:'education_submit',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',person)).status,201);
    const login=await call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password}),cookie=login.headers.get('set-cookie').split(';')[0],worker=(await login.json()).worker;
    const grant=permissions=>call(`/api/workers/${worker.id}/permissions`,'PUT',{siteId:site.id,permissions},admin);
    assert.equal((await grant(['training'])).status,200);
    for(const [path,actor] of [['/api/documents',admin],['/api/worker/documents',cookie]]){
      for(const missing of ['kind','time','educationPlace','educationMethod','instructor','textbook']){
        const details={...complete};if(missing==='time'){details.timeFrom='';details.timeTo='';}else details[missing]=missing==='kind'?'':'   ';
        const created=await call(path,'POST',{siteId:site.id,...input(details)},actor);assert.equal(created.status,201);const doc=await created.json();assert.equal(doc.status,'draft');
        const rejected=await call(`${path}/${doc.id}/transition`,'POST',{action:'submit'},actor);assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/시험 결재 요청 전/);
        const saved=await (await call(`${path}/${doc.id}`,'GET',null,actor)).json();assert.equal(saved.status,'draft');assert.equal(saved.approval_cycle_id,null);assert.equal(saved.details,doc.details);
        const updated=await call(`${path}/${doc.id}`,'PUT',{siteId:site.id,...input(complete),expectedEditVersion:saved.edit_version},actor);assert.equal(updated.status,200);
        assert.equal((await call(`${path}/${doc.id}/transition`,'POST',{action:'submit',expectedEditVersion:saved.edit_version},actor)).status,409);
        const submitted=await call(`${path}/${doc.id}/transition`,'POST',{action:'submit'},actor);assert.equal(submitted.status,200);assert.equal((await submitted.json()).status,'pending');
      }
    }
    const doc=await (await call('/api/worker/documents','POST',input(complete),cookie)).json();assert.equal((await grant([])).status,200);
    assert.equal((await call(`/api/worker/documents/${doc.id}/transition`,'POST',{action:'submit',expectedEditVersion:doc.edit_version},cookie)).status,400);
    assert.equal((await (await call(`/api/documents/${doc.id}`,'GET',null,admin)).json()).status,'draft');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
