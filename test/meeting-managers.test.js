import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { EventEmitter,once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Store } from '../store.js';

test('선택된 사용자 측 현장관리자도 승인된 회의를 확인하고 서명한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const make=(siteId,name,category)=>store.createWorker({siteId,name,category,company:'가상 업체',occupation:'가상 직종'});
    const manager=make(site.id,'가상 관리자','현장관리자'),worker=make(site.id,'가상 근로자','직영'),stranger=make(site.id,'선택되지 않은 관리자','현장관리자'),foreign=make(other.id,'다른 현장 관리자','현장관리자');
    store.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-31',present:true});
    const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature='data:image/png;base64,'+bytes.toString('base64');
    for(const type of ['work_council','safety_meeting']){
      const doc=store.createDocument({siteId:site.id,type,title:'가상 회의',date:'2026-10-31',body:'가상 내용',details:{...(type==='work_council'?{kind:'정기 회의'}:{}),managerIds:[manager.id],workerIds:[worker.id],employerParticipants:['직접 입력']}});
      const file=store.addAttachment(doc.id,'가상.txt',Buffer.from('가상 첨부'));
      assert.equal(store.workerMeetings(manager.id).some(row=>row.id===doc.id),false);assert.equal(store.workerMeetingAttachment(manager.id,doc.id,file),null);assert.throws(()=>store.confirmWorkerMeeting(manager.id,doc.id,signature),/승인/);
      store.transition(doc.id,'submit');assert.equal(store.workerMeetings(manager.id).some(row=>row.id===doc.id),false);store.transition(doc.id,'approve');
      const selected=store.workerMeetings(manager.id).find(row=>row.id===doc.id);assert.equal(selected.role,'manager');assert.equal(selected.body,'가상 내용');assert.equal(selected.details.managerSnapshot,undefined);assert.equal(store.workerMeetings(worker.id).find(row=>row.id===doc.id).role,'worker');
      assert.equal(Buffer.from(store.workerMeetingAttachment(manager.id,doc.id,file).data).toString(),'가상 첨부');assert.equal(store.workerMeetingAttachment(stranger.id,doc.id,file),null);assert.equal(store.workerMeetingAttachment(foreign.id,doc.id,file),null);
      assert.throws(()=>store.confirmWorkerMeeting(stranger.id,doc.id,signature),/승인/);assert.throws(()=>store.confirmWorkerMeeting(foreign.id,doc.id,signature),/승인/);assert.throws(()=>store.confirmWorkerMeeting(manager.id,doc.id,signature,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.meetingChecks(doc.id).length,0);
      store.confirmWorkerMeeting(manager.id,doc.id,signature);store.confirmWorkerMeeting(manager.id,doc.id,signature);assert.equal(store.meetingChecks(doc.id).length,1);assert.deepEqual(Buffer.from(store.meetingWorkerSignature(doc.id,manager.id)),bytes);assert.ok(store.workerMeetings(manager.id).find(row=>row.id===doc.id).created_at);
    }
  }finally{store.close();}
});

test('현장관리자 시험 계정은 지정된 회의와 첨부만 읽고 본인 확인을 남긴다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meeting-manager-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const storeUrl=pathToFileURL(join(process.cwd(),'store.js')).href,trace="import {Store} from "+JSON.stringify(storeUrl)+";const original=Store.prototype.confirmWorkerMeeting;Store.prototype.confirmWorkerMeeting=function(...args){process.stdout.write('MEETING_SAVE\\n');return original.apply(this,args)};";
  let child,signals,db,locked=false;const start=async()=>{child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(trace),'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);signals=new EventEmitter();child.stdout.on('data',chunk=>{if(String(chunk).includes('MEETING_SAVE'))signals.emit('meeting');});};
  const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}child=null;};
  try{
    await start();const base='http://127.0.0.1:'+port,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const adminLogin=async()=>{const response=await send('/api/login','POST',{password:'virtual-admin-password'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
    let admin=await adminLogin();const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json();
    const invitation=async id=>{const response=await send('/api/sites/'+id+'/invitation','POST',{},admin);assert.equal(response.status,201);return new URL((await response.json()).link).searchParams.get('token');};
    const firstToken=await invitation(site.id),otherToken=await invitation(other.id);
    const add=async(siteId,token,loginId,name,manager=false)=>{
      const registered=await send('/api/join','POST',{token,name,category:'직영',company:'가상 업체',occupation:'가상 직종',loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});assert.equal(registered.status,201);
      const people=await (await send('/api/workers?siteId='+siteId,'GET',undefined,admin)).json(),person=people.find(item=>item.name===name);assert.ok(person);
      if(manager)assert.equal((await send('/api/workers/'+person.id,'PUT',{siteId,name,category:'현장관리자',company:'가상 업체',occupation:'가상 직종'},admin)).status,200);
      const logged=await send('/api/worker/login','POST',{token,loginId,password:'virtual-password-123'});assert.equal(logged.status,200);return {id:person.id,cookie:logged.headers.get('set-cookie').split(';')[0]};
    };
    const manager=await add(site.id,firstToken,'meeting_manager','가상 관리자',true),worker=await add(site.id,firstToken,'meeting_worker','가상 근로자'),stranger=await add(site.id,firstToken,'other_manager','다른 관리자',true),foreign=await add(other.id,otherToken,'foreign_manager','외부 관리자',true);
    const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature='data:image/png;base64,'+bytes.toString('base64');
    for(const type of ['work_council','safety_meeting']){
      const response=await send('/api/documents','POST',{siteId:site.id,type,title:'가상 회의',date,body:'가상 내용',details:{...(type==='work_council'?{kind:'정기 회의'}:{}),workerIds:[worker.id],managerIds:[manager.id]}},admin);assert.equal(response.status,201);const doc=await response.json();
      const upload=await fetch(base+'/api/documents/'+doc.id+'/attachments',{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'가상 첨부'});assert.equal(upload.status,201);const file=(await upload.json()).id,filePath='/api/worker/meetings/'+doc.id+'/attachments/'+file;
      assert.equal((await send(filePath,'GET',undefined,manager.cookie)).status,404);assert.equal((await send('/api/worker/meetings','POST',{documentId:doc.id,signature},manager.cookie)).status,400);
      assert.equal((await send('/api/documents/'+doc.id+'/transition','POST',{action:'submit'},admin)).status,200);assert.equal((await send('/api/documents/'+doc.id+'/transition','POST',{action:'approve',signature},admin)).status,200);
      const mine=await (await send('/api/worker/meetings','GET',undefined,manager.cookie)).json(),selected=mine.find(item=>item.id===doc.id);assert.equal(selected.role,'manager');assert.equal(selected.body,'가상 내용');assert.equal(selected.details.managerSnapshot,undefined);
      assert.equal((await (await send('/api/worker/meetings','GET',undefined,worker.cookie)).json()).find(item=>item.id===doc.id).role,'worker');
      assert.equal((await send(filePath,'GET',undefined,manager.cookie)).status,200);assert.equal((await send(filePath,'GET',undefined,stranger.cookie)).status,404);assert.equal((await send(filePath,'GET',undefined,foreign.cookie)).status,404);
      assert.equal((await send('/api/worker/meetings','POST',{documentId:doc.id,signature},stranger.cookie)).status,400);assert.equal((await send('/api/worker/meetings','POST',{documentId:doc.id,signature},foreign.cookie)).status,400);
      assert.equal((await send('/api/worker/meetings','POST',{documentId:doc.id,signature:'잘못된 서명'},manager.cookie)).status,400);
      assert.equal((await send('/api/worker/meetings','POST',{documentId:doc.id,signature,workerId:worker.id},manager.cookie)).status,200);
      const checks=await (await send('/api/documents/'+doc.id+'/meeting-checks','GET',undefined,admin)).json();assert.deepEqual(checks.map(check=>check.worker_id),[manager.id]);
      const image=await send('/api/documents/'+doc.id+'/meeting-checks/'+manager.id+'/signature','GET',undefined,admin);assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
      assert.equal((await send('/api/documents/'+doc.id+'/meeting-checks/'+manager.id+'/signature','GET',undefined,manager.cookie)).status,401);
    }
    const race=await (await send('/api/documents','POST',{siteId:site.id,type:'safety_meeting',title:'가상 경합 회의',date,details:{managerIds:[manager.id],workerIds:[worker.id]}},admin)).json();assert.ok(race.id);
    assert.equal((await send('/api/documents/'+race.id+'/transition','POST',{action:'submit'},admin)).status,200);assert.equal((await send('/api/documents/'+race.id+'/transition','POST',{action:'approve',signature},admin)).status,200);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;
    const started=once(signals,'meeting'),pending=send('/api/worker/meetings','POST',{documentId:race.id,signature},manager.cookie);pending.catch(()=>{});await started;
    db.prepare('DELETE FROM worker_sessions WHERE token_hash=?').run(createHash('sha256').update(manager.cookie.split('=')[1]).digest('hex'));db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_meeting_checks WHERE document_id=?').get(race.id).n,0);db.close();db=null;
    const relogin=await send('/api/worker/login','POST',{token:firstToken,loginId:'meeting_manager',password:'virtual-password-123'});assert.equal(relogin.status,200);manager.cookie=relogin.headers.get('set-cookie').split(';')[0];
    await stop();await start();assert.equal((await (await send('/api/worker/meetings','GET',undefined,manager.cookie)).json()).filter(item=>item.role==='manager'&&item.created_at).length,2);
    admin=await adminLogin();assert.equal((await send('/api/worker/logout','POST',{},manager.cookie)).status,200);assert.equal((await send('/api/worker/meetings','GET',undefined,manager.cookie)).status,401);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}await stop();rmSync(dir,{recursive:true,force:true});}
});
