import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';

const password='virtual-password-123';
function setup(path){const s=new Store(path),a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:loginId,password}),one=make(a.id,'meeting_one'),peer=make(a.id,'meeting_peer'),foreign=make(b.id,'meeting_foreign'),input={siteId:a.id,type:'work_council',title:'가상 회의',date:'2026-11-05',body:'가상 회의 내용',details:{kind:'정기 회의',employeeIds:[one.id]}},doc=s.createDocument(input),file=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));return {s,a,b,one,peer,foreign,input,doc,file};}
function signature(){const image=new PNG({width:1,height:1});image.data[3]=255;return 'data:image/png;base64,'+PNG.sync.write(image).toString('base64');}

test('직원 회의 확인은 승인·선정·현장·버전과 세션을 검증한다',()=>{
  const {s,one,peer,foreign,doc,file}=setup(':memory:');try{
    assert.deepEqual(s.reviewerMeetings(one.id),[]);assert.throws(()=>s.confirmReviewerMeeting(one.id,doc.id,doc.edit_version,signature()),/승인 회의/);
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');const version=s.document(doc.id).edit_version;
    assert.equal(s.reviewerMeetings(one.id)[0].id,doc.id);assert.deepEqual(s.reviewerMeetings(peer.id),[]);assert.deepEqual(s.reviewerMeetings(foreign.id),[]);
    assert.equal(s.reviewerMeetingAttachment(one.id,doc.id,file).name,'가상.txt');assert.equal(s.reviewerMeetingAttachment(peer.id,doc.id,file),null);
    assert.throws(()=>s.confirmReviewerMeeting(one.id,doc.id,version-1,signature()),error=>error.sessionStatus===409);assert.throws(()=>s.confirmReviewerMeeting(one.id,doc.id,version,signature(),()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(s.meetingEmployeeChecks(doc.id),[]);
    s.confirmReviewerMeeting(one.id,doc.id,version,signature());assert.ok(s.reviewerMeetings(one.id,doc.id).signature);assert.equal(s.meetingEmployeeChecks(doc.id)[0].reviewer_id,one.id);assert.ok(s.meetingEmployeeSignature(doc.id,one.id));assert.equal(s.meetingEmployeeSignature(doc.id,peer.id),null);
    s.db.prepare('UPDATE documents SET edit_version=edit_version+1 WHERE id=?').run(doc.id);assert.equal(s.reviewerMeetings(one.id,doc.id).signature,null);assert.deepEqual(s.meetingEmployeeChecks(doc.id),[]);assert.equal(s.meetingEmployeeSignature(doc.id,one.id),null);
    s.updateReviewer(one.site_id,one.id,{active:false});assert.deepEqual(s.reviewerMeetings(one.id),[]);
  }finally{s.close();}
});

test('직원 회의 시험 확인은 데이터베이스를 다시 열어도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meeting-reopen-')),path=join(dir,'jweb.sqlite'),fixture=setup(path);let s=fixture.s;
  try{s.transition(fixture.doc.id,'submit');s.transition(fixture.doc.id,'approve');const version=s.document(fixture.doc.id).edit_version;s.confirmReviewerMeeting(fixture.one.id,fixture.doc.id,version,signature());s.close();s=new Store(path);assert.ok(s.reviewerMeetings(fixture.one.id,fixture.doc.id).signature);assert.ok(s.meetingEmployeeSignature(fixture.doc.id,fixture.one.id));}
  finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('직원 회의 API는 로그인·현장·대상과 서명 버전을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-meeting-')),fixture=setup(join(dir,'jweb.sqlite')),s=fixture.s,auth=new AdminAccounts(s.db);auth.bootstrap(password);s.transition(fixture.doc.id,'submit');s.transition(fixture.doc.id,'approve');
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async(loginId)=>(await call('/api/reviewer/login','POST',{loginId,password})).headers.get('set-cookie').split(';')[0],one=await login('meeting_one'),peer=await login('meeting_peer'),foreign=await login('meeting_foreign'),admin=(await call('/api/login','POST',{password})).headers.get('set-cookie').split(';')[0],id=fixture.doc.id,path=`/api/reviewer/meetings/${id}`;
    assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',null,peer)).status,404);assert.equal((await call(path,'GET',null,foreign)).status,404);
    const view=await (await call(path,'GET',null,one)).json(),body={expectedEditVersion:view.document.edit_version,signature:signature()};assert.equal((await call(path+`/attachments/${fixture.file}`,'GET',null,one)).status,200);assert.equal((await call(path+`/attachments/${fixture.file}`,'GET',null,peer)).status,404);
    assert.equal((await call(path+'/confirmation','POST',{...body,expectedEditVersion:body.expectedEditVersion-1},one)).status,409);assert.equal((await call(path+'/confirmation','POST',body,foreign)).status,400);assert.equal((await call(path+'/confirmation','POST',body,one)).status,200);
    assert.equal((await call(`/api/documents/${id}/meeting-employee-checks/${fixture.one.id}/signature`,'GET',null,admin)).status,200);assert.equal((await call(`/api/documents/${id}/meeting-employee-checks/${fixture.peer.id}/signature`,'GET',null,admin)).status,404);
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}s.close();rmSync(dir,{recursive:true,force:true});}
});
