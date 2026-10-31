import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';

const staff=(siteId,loginId)=>({siteId,loginId,name:loginId,password:'virtual-password-123'});
const meeting=(siteId,type,employeeIds)=>({siteId,type,title:'가상 회의',date:'2026-11-01',details:{...(type==='work_council'?{kind:'정기 회의'}:{}),employeeIds}});

for(const type of ['safety_meeting','work_council'])test(`${type}: 임직원 신규 선택 검증과 이전 명단 및 결재 사본 보존`,()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'외부 현장'}),one=s.createReviewer(staff(site.id,'employee_one')),two=s.createReviewer(staff(site.id,'employee_two')),foreign=s.createReviewer(staff(other.id,'foreign_employee'));
    const worker=s.createWorker({siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 업체',occupation:'가상 직종'});s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-11-01',present:true});assert.equal(worker.id,one.id);
    const input=meeting(site.id,type,[one.id]),doc=s.createDocument({...input,details:{...input.details,workerIds:[worker.id],employeeSnapshot:[{id:foreign.id,name:'위조'}]}}),snapshot=[{id:one.id,name:'employee_one'}],details=()=>JSON.parse(s.document(doc.id).details);
    assert.deepEqual(details().employeeIds,[one.id]);assert.deepEqual(details().employeeSnapshot,snapshot);assert.equal(details().workerSnapshot[0].name,'가상 출입자');
    for(const ids of [null,'1',[String(one.id)],[0],[-1],[1.5],[Number.MAX_SAFE_INTEGER+1],[one.id,one.id],Array.from({length:101},(_,i)=>i+1)])assert.throws(()=>s.createDocument(meeting(site.id,type,ids)),/임직원/);
    assert.throws(()=>s.createDocument(meeting(site.id,type,[foreign.id])),/같은 현장/);assert.throws(()=>s.createDocument(meeting(site.id,type,[999999])),/활성 임직원/);
    s.updateReviewer(site.id,two.id,{active:false});assert.throws(()=>s.updateDocument(doc.id,meeting(site.id,type,[one.id,two.id])),/활성 임직원/);assert.deepEqual(details().employeeSnapshot,snapshot);
    s.db.prepare('UPDATE reviewers SET name=?,active=0,site_id=? WHERE id=?').run('변경 이름',other.id,one.id);
    s.updateDocument(doc.id,input);assert.deepEqual(details().employeeSnapshot,snapshot);
    s.updateDocument(doc.id,{...meeting(site.id,type,undefined),date:'2026-11-02',details:{...meeting(site.id,type,undefined).details,employeeSnapshot:[]}});assert.deepEqual(details().employeeIds,[one.id]);assert.deepEqual(details().employeeSnapshot,snapshot);
    s.transition(doc.id,'submit');const current=s.document(doc.id),cycle=current.approval_cycle_id;assert.ok(cycle);assert.equal(s.reviewerPayload(current).frozen,true);assert.deepEqual(JSON.parse(s.reviewerPayload(current).document.details).employeeSnapshot,snapshot);
    s.transition(doc.id,'withdraw');s.updateDocument(doc.id,meeting(site.id,type,[]));assert.deepEqual(details().employeeIds,[]);assert.deepEqual(details().employeeSnapshot,[]);assert.deepEqual(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).employeeSnapshot,snapshot);
    assert.throws(()=>s.updateDocument(doc.id,input),/활성 임직원/);s.db.prepare('UPDATE reviewers SET site_id=?,active=1 WHERE id=?').run(site.id,one.id);s.updateDocument(doc.id,input);assert.deepEqual(details().employeeSnapshot,[{id:one.id,name:'변경 이름'}]);
    const legacy=s.createDocument(meeting(site.id,type,undefined));assert.deepEqual(JSON.parse(legacy.details).employeeSnapshot,[]);
  }finally{s.close();}
});

test('회의 임직원 API는 관리자 권한과 현장 경계를 검사하고 재시작 뒤 명단과 결재 사본을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meeting-employees-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),loginAdmin=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await loginAdmin();
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'외부 현장'},admin)).json(),one=await (await send('/api/reviewers','POST',staff(site.id,'api_employee'),admin)).json(),foreign=await (await send('/api/reviewers','POST',staff(other.id,'api_foreign'),admin)).json(),reviewer=(await send('/api/reviewer/login','POST',{loginId:'api_employee',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],saved=[];
    for(const type of ['safety_meeting','work_council']){
      const input=meeting(site.id,type,[one.id]);assert.equal((await send('/api/documents','POST',input)).status,401);assert.equal((await send('/api/documents','POST',input,reviewer)).status,401);assert.equal((await send('/api/documents','POST',meeting(site.id,type,[foreign.id]),admin)).status,400);
      const response=await send('/api/documents','POST',input,admin);assert.equal(response.status,201);const doc=await response.json(),path=`/api/documents/${doc.id}`;assert.deepEqual(JSON.parse(doc.details).employeeSnapshot,[{id:one.id,name:'api_employee'}]);
      assert.equal((await send(path,'PUT',meeting(site.id,type,[foreign.id]),admin)).status,400);assert.equal((await send(path,'PUT',meeting(site.id,type,undefined),admin)).status,200);
      assert.equal((await send(path+'/approval-line','PUT',{reviewerIds:[one.id]},admin)).status,200);assert.equal((await send(path+'/transition','POST',{action:'submit'},admin)).status,200);
      const viewed=await send(`/api/reviewer/documents/${doc.id}`,'GET',undefined,reviewer);assert.equal(viewed.status,200);const frozen=await viewed.json();assert.deepEqual(JSON.parse(frozen.document.details).employeeSnapshot,[{id:one.id,name:'api_employee'}]);saved.push(doc.id);
    }
    await stop();await start();admin=await loginAdmin();for(const id of saved){const doc=await (await send(`/api/documents/${id}`,'GET',undefined,admin)).json();assert.deepEqual(JSON.parse(doc.details).employeeIds,[one.id]);const frozen=await (await send(`/api/reviewer/documents/${id}`,'GET',undefined,reviewer)).json();assert.deepEqual(JSON.parse(frozen.document.details).employeeSnapshot,[{id:one.id,name:'api_employee'}]);}
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
