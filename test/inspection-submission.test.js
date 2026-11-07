import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { PNG } from 'pngjs';
const png=new PNG({width:1,height:1});png.data[3]=255;
const bytes=PNG.sync.write(png),signature='data:image/png;base64,'+bytes.toString('base64');
const row={inspector:'가상 점검자',timeFrom:'23:00',timeTo:'01:00',hazard:'없음',action:''};

for(const type of ['inspection','patrol'])test(`${type} 결재 요청은 작성자 서명을 요구하며 거절 시 상태와 이력을 보존한다`,()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type,title:'가상 점검',date:'2026-11-07',details:type==='inspection'?{rows:[row]}:{items:[]}},doc=s.createDocument(input),before=s.document(doc.id);
  assert.throws(()=>s.managedTransition(doc.id,{action:'submit',expectedEditVersion:before.edit_version}),/작성자 서명/);
  assert.deepEqual(s.document(doc.id),before);assert.equal(s.events(doc.id).length,0);assert.equal(s.approvalCycle(doc.id,1),null);
  s.saveMeetingSignature(doc.id,signature);assert.throws(()=>s.managedTransition(doc.id,{action:'submit',expectedEditVersion:before.edit_version}),e=>e.sessionStatus===409);
  const submitted=s.managedTransition(doc.id,{action:'submit',expectedEditVersion:s.document(doc.id).edit_version}),cycle=submitted.approval_cycle_id;assert.equal(submitted.status,'pending');assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'author-signature',0,0).data),bytes);
  s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,title:'수정한 가상 점검'});const edited=s.document(doc.id);assert.throws(()=>s.managedTransition(doc.id,{action:'submit',expectedEditVersion:edited.edit_version}),/작성자 서명/);assert.deepEqual(s.document(doc.id),edited);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,cycle,'author-signature',0,0).data),bytes);
 }finally{s.close();}
});

test('안전 점검의 빈 활동과 시간이 없는 이전 활동은 임시저장하고 상신 전에 보완한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-07',details:{rows:[]}},doc=s.createDocument(input);
  for(const rows of [[],[{inspector:'가상 점검자',hazard:'없음'}]]){
   s.updateDocument(doc.id,{...input,details:{rows}});s.saveMeetingSignature(doc.id,signature);const before=s.document(doc.id);
   assert.throws(()=>s.managedTransition(doc.id,{action:'submit',expectedEditVersion:before.edit_version}),/점검 활동.*시간/);assert.deepEqual(s.document(doc.id),before);assert.ok(s.meetingSignature(doc.id));
  }
  s.updateDocument(doc.id,{...input,details:{rows:[row]}});s.saveMeetingSignature(doc.id,signature);assert.equal(s.transition(doc.id,'submit').status,'pending');
 }finally{s.close();}
});

test('관리자 HTTP는 점검 활동과 서명 누락을 거절하고 최신 서명으로 결재 요청한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-inspection-submit-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await call('/api/sites','POST',{name:'가상 현장'},admin)).json();
  for(const type of ['inspection','patrol']){
   const input={siteId:site.id,type,title:'가상 점검',date:'2026-11-07'},created=await call('/api/documents','POST',input,admin);assert.equal(created.status,201);let doc=await created.json();const path=`/api/documents/${doc.id}`,get=async()=>await(await call(path,'GET',null,admin)).json();
   if(type==='inspection'){
    const missingActivity=await call(path+'/transition','POST',{action:'submit',expectedEditVersion:doc.edit_version},admin);assert.equal(missingActivity.status,400);assert.match((await missingActivity.json()).error,/점검 활동/);assert.deepEqual(await get(),doc);
    const updated=await call(path,'PUT',{...input,details:{rows:[row]},expectedEditVersion:doc.edit_version},admin);assert.equal(updated.status,200);doc=await updated.json();
   }
   const missingSignature=await call(path+'/transition','POST',{action:'submit',expectedEditVersion:doc.edit_version},admin);assert.equal(missingSignature.status,400);assert.match((await missingSignature.json()).error,/작성자 서명/);assert.deepEqual(await get(),doc);
   const signedInput={signature,expectedEditVersion:doc.edit_version};assert.equal((await call(path+'/meeting-signature','POST',signedInput)).status,401);assert.equal((await call(path+'/meeting-signature','POST',signedInput,admin)).status,200);
   assert.equal((await call(path+'/transition','POST',{action:'submit',expectedEditVersion:doc.edit_version},admin)).status,409);const signed=await get();assert.equal((await call(path+'/transition','POST',{action:'submit',expectedEditVersion:signed.edit_version},admin)).status,200);const submitted=await get();assert.equal(submitted.status,'pending');
   const cycle=await(await call(path+'/approval-cycles/'+submitted.approval_cycle_id,'GET',null,admin)).json();assert.equal(cycle.linked.authorSignature,true);if(type==='inspection')assert.deepEqual(JSON.parse(cycle.document.details).rows,[{...row}]);
  }
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
