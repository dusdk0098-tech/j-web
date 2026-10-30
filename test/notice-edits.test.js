import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

test('게시 공지 수정은 이전 확인을 보존하고 새 내용에 다시 서명하게 한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});let db;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const token=new URL((await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json()).link).searchParams.get('token'),workerInput={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'notice_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',workerInput)).status,201);const login=await call('/api/worker/login','POST',{token,loginId:workerInput.loginId,password:workerInput.password}),workerCookie=login.headers.get('set-cookie').split(';')[0],worker=(await login.json()).worker;
    const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),doc=await (await call('/api/documents','POST',{siteId:site.id,type:'notice',title:'처음 공지',date,body:'처음 내용'},admin)).json(),path=`/api/documents/${doc.id}`;
    assert.equal((await call(path+'/publish-notice','POST',{},admin)).status,200);const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    const notices=await (await call('/api/worker/notices','GET',null,workerCookie)).json();assert.equal(notices[0].version,0);assert.equal((await call(`/api/worker/notices/${doc.id}/confirm`,'POST',{signature,version:0},workerCookie)).status,200);
    const input={siteId:site.id,expectedVersion:0,title:'수정 공지',body:'수정 내용\n두 번째 줄'};
    assert.equal((await call(path+'/notice-edits','PUT',input)).status,401);assert.equal((await call(path+'/notice-edits','PUT',input,workerCookie)).status,401);assert.equal((await call(path+'/notice-edits','PUT',{...input,siteId:other.id},admin)).status,400);
    const edited=await call(path+'/notice-edits','PUT',input,admin);assert.equal(edited.status,200);const current=await edited.json();assert.ok(current.notice_version>0);assert.equal(current.body,input.body);
    assert.deepEqual(await (await call(path+'/notice-reads','GET',null,admin)).json(),[]);const history=await (await call(path+'/notice-edits','GET',null,admin)).json();assert.equal(history.length,1);assert.equal(history[0].previous_body,'처음 내용');assert.equal(history[0].reads[0].id,worker.id);
    const saved=`${path}/notice-edits/${history[0].id}/reads/${worker.id}/signature`;assert.equal((await call(saved)).status,401);const downloaded=await call(saved,'GET',null,admin);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
    for(const old of [{signature,version:0},{signature}])assert.equal((await call(`/api/worker/notices/${doc.id}/confirm`,'POST',old,workerCookie)).status,409);
    const next=await (await call('/api/worker/notices','GET',null,workerCookie)).json();assert.equal(next[0].read_at,null);assert.equal(next[0].version,current.notice_version);
    assert.equal((await call(`/api/worker/notices/${doc.id}/confirm`,'POST',{signature,version:current.notice_version},workerCookie)).status,200);
    assert.equal((await call(path+'/notice-edits','PUT',input,admin)).status,409);
    assert.equal((await call(path+'/notice-edits','PUT',{...input,expectedVersion:current.notice_version},admin)).status,200);assert.equal((await (await call(path+'/notice-reads','GET',null,admin)).json()).length,1);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec("CREATE TRIGGER fail_notice_edit BEFORE INSERT ON events WHEN NEW.action='edit' BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");
    assert.equal((await call(path+'/notice-edits','PUT',{...input,title:'저장 실패',expectedVersion:current.notice_version},admin)).status,400);assert.equal((await (await call(path,'GET',null,admin)).json()).title,input.title);assert.equal((await (await call(path+'/notice-reads','GET',null,admin)).json()).length,1);assert.equal((await (await call(path+'/notice-edits','GET',null,admin)).json()).length,1);
  }finally{if(db)db.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('기존 공지 확인 기록은 수정 이력 테이블 추가 후에도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-migration-')),path=join(dir,'test.sqlite');let store;
  try{
    store=new Store(path);const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),doc=store.createDocument({siteId:site.id,type:'notice',title:'가상 공지',date:'2026-10-29',body:'가상 내용'}),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    store.publishNotice(doc.id);store.confirmWorkerNotice(worker.id,doc.id,signature,doc.date);store.db.exec('DROP TABLE notice_edit_reads; DROP TABLE notice_edits');store.close();store=new Store(path);
    assert.equal(store.document(doc.id).notice_version,0);assert.equal(store.workerNotices(worker.id,doc.date)[0].version,0);assert.equal(store.noticeReads(doc.id).length,1);assert.deepEqual(store.noticeEditHistory(doc.id),[]);
    assert.throws(()=>store.editPublishedNotice(doc.id,{siteId:site.id,expectedVersion:0,title:'가상',body:'내용'},'2026-10-30'),/오늘/);
  }finally{if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});
