import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

const token='00000000-0000-4000-8000-000000000001';
test('작업중지와 위험신고는 같은 요청을 재전송해도 한 건만 저장한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const stop={requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유'};
    s.createWorkStop(worker.id,stop);s.createWorkStop(worker.id,stop);assert.equal(s.workStops(site.id).length,1);assert.throws(()=>s.createWorkStop(worker.id,stop,()=>{throw Error('세션 종료');}),/세션 종료/);assert.throws(()=>s.createWorkStop(worker.id,{...stop,requestId:'invalid'}),/요청 번호/);assert.throws(()=>s.createWorkerHazardReport(worker.id,{requestId:token,title:'가상 제목',body:'가상 내용'}),/요청/);
    assert.equal(s.db.prepare('SELECT worker_id FROM work_stops').get().worker_id,null);
    assert.throws(()=>s.createWorkStop(worker.id,{...stop,place:'다른 장소'}),/요청/);
    const report={requestId:'00000000-0000-4000-8000-000000000002',title:'가상 신고',body:'가상 내용'};
    const id=s.createWorkerHazardReport(worker.id,report);assert.equal(s.createWorkerHazardReport(worker.id,report),id);assert.equal(s.workerHazardReports(worker.id).length,1);
    assert.throws(()=>s.createWorkerHazardReport(worker.id,{...report,body:'다른 내용'}),/요청/);
  }finally{s.close();}
});

test('삭제 뒤 번호가 재사용돼도 이전 요청을 성공으로 처리하지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),stop={requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유'};
    s.createWorkStop(worker.id,stop);const old=s.workStops(site.id)[0];s.deleteWorkStop(site.id,old.id,{previousResponse:old.response,expectedVersion:old.version});assert.equal(s.db.prepare('SELECT input_hash FROM worker_report_requests WHERE request_id=?').get(token).input_hash,'');
    s.createWorkStop(worker.id,{...stop,requestId:'00000000-0000-4000-8000-000000000003'});assert.equal(s.workStops(site.id)[0].id,old.id);
    assert.throws(()=>s.createWorkStop(worker.id,stop),/삭제/);assert.equal(s.workStops(site.id).length,1);
    const report={requestId:'00000000-0000-4000-8000-000000000004',title:'가상 제목',body:'가상 내용'},id=s.createWorkerHazardReport(worker.id,report);
    s.db.prepare('DELETE FROM hazard_reports WHERE id=?').run(id);const replacement=s.createWorkerHazardReport(worker.id,{...report,requestId:'00000000-0000-4000-8000-000000000005'});assert.equal(id,replacement);assert.throws(()=>s.createWorkerHazardReport(worker.id,report),/삭제/);
  }finally{s.close();}
});

test('요청 번호 저장이 실패하면 신고도 함께 저장되지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    s.db.exec("CREATE TRIGGER fail_report_request BEFORE INSERT ON worker_report_requests BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");
    assert.throws(()=>s.createWorkStop(worker.id,{requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유'}),/가상 저장 실패/);
    assert.throws(()=>s.createWorkerHazardReport(worker.id,{requestId:token,title:'가상 제목',body:'가상 내용'}),/가상 저장 실패/);
    assert.equal(s.workStops(site.id).length,0);assert.equal(s.workerHazardReports(worker.id).length,0);
  }finally{s.close();}
});

test('실제 HTTP에서 같은 요청의 동시 재전송은 한 건만 저장된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-report-retry-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),joinToken=new URL(invite.link).searchParams.get('token');
    const person={token:joinToken,name:'가상 근로자',category:'직영',occupation:'목공',loginId:'retry_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',person)).status,201);const login=await send('/api/worker/login','POST',{token:joinToken,loginId:person.loginId,password:person.password}),cookie=login.headers.get('set-cookie').split(';')[0],context=(await login.json()).reportContext;
    const stop={requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유',reportContext:context},report={requestId:'00000000-0000-4000-8000-000000000002',title:'가상 제목',body:'가상 내용',reportContext:context};
    const stops=await Promise.all([send('/api/worker/work-stops','POST',stop,cookie),send('/api/worker/work-stops','POST',stop,cookie)]);assert.deepEqual(stops.map(r=>r.status),[201,201]);
    assert.equal((await send('/api/worker/work-stops','POST',{...stop,place:'다른 장소'},cookie)).status,409);assert.equal((await (await send(`/api/sites/${site.id}/work-stops`,'GET',null,admin)).json()).length,1);
    const reports=await Promise.all([send('/api/worker/hazard-reports','POST',report,cookie),send('/api/worker/hazard-reports','POST',report,cookie)]);assert.deepEqual(reports.map(r=>r.status),[201,201]);const ids=await Promise.all(reports.map(r=>r.json()));assert.equal(ids[0].id,ids[1].id);assert.equal((await send('/api/worker/hazard-reports','POST',{...report,body:'다른 내용'},cookie)).status,409);
    assert.equal((await (await send(`/api/sites/${site.id}/hazard-reports`,'GET',null,admin)).json()).length,1);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('재시작 후에도 같은 요청은 중복되지 않고 익명 재시도 정보에 작성자가 없다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-report-reopen-')),file=join(dir,'test.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),stop={requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유'};
    s.createWorkStop(worker.id,stop);s.close();s=new Store(file);s.createWorkStop(worker.id,stop);assert.equal(s.workStops(site.id).length,1);
    assert.equal(s.db.prepare('SELECT worker_id FROM work_stops').get().worker_id,null);assert.ok(!s.db.prepare('PRAGMA table_info(worker_report_requests)').all().some(col=>/worker|actor|user/i.test(col.name)));
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('서로 다른 서버 프로세스의 같은 요청도 한 건만 저장된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-report-process-')),file=join(dir,'test.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});s.close();s=null;
    const code="import {Store} from './store.js';const s=new Store(process.env.JWEB_REPORT_TEST_FILE);try{s.createWorkStop(Number(process.env.JWEB_REPORT_TEST_WORKER),{requestId:'00000000-0000-4000-8000-000000000001',anonymous:true,place:'가상 장소',reason:'가상 사유'});}finally{s.close();}";
    const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,JWEB_REPORT_TEST_FILE:file,JWEB_REPORT_TEST_WORKER:String(worker.id)},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',chunk=>{err+=chunk;});child.on('error',reject);child.on('exit',status=>status===0?resolve():reject(Error(err)));});
    await Promise.all([run(),run()]);s=new Store(file);assert.equal(s.workStops(site.id).length,1);assert.equal(s.db.prepare('SELECT count(*) AS n FROM worker_report_requests').get().n,1);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('첨부 사진이 달라진 같은 요청 번호는 거절하고 원본 사진을 유지한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'}),photo=Buffer.from('89504e470d0a1a0a01','hex'),other=Buffer.from('89504e470d0a1a0a02','hex'),data=bytes=>'data:image/png;base64,'+bytes.toString('base64'),stop={requestId:token,anonymous:true,place:'가상 장소',reason:'가상 사유',photo:data(photo)};
    s.createWorkStop(worker.id,stop);s.createWorkStop(worker.id,stop);assert.throws(()=>s.createWorkStop(worker.id,{...stop,photo:data(other)}),/요청/);const row=s.workStops(site.id)[0];assert.deepEqual(Buffer.from(s.workStopPhoto(site.id,row.id,row.version)),photo);
    const report={requestId:'00000000-0000-4000-8000-000000000002',title:'가상 제목',body:'가상 내용',photo:data(photo)},id=s.createWorkerHazardReport(worker.id,report);assert.equal(s.createWorkerHazardReport(worker.id,report),id);assert.throws(()=>s.createWorkerHazardReport(worker.id,{...report,photo:data(other)}),/요청/);assert.deepEqual(Buffer.from(s.workerHazardPhoto(worker.id,id)),photo);
  }finally{s.close();}
});

test('이전 신고 DB를 이관해도 기존 기록을 보존하고 신규 재시도만 중복 제거한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-report-migrate-')),file=join(dir,'test.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    s.createWorkStop(worker.id,{anonymous:true,place:'이전 장소',reason:'이전 사유'});s.createWorkerHazardReport(worker.id,{title:'이전 제목',body:'이전 내용'});s.close();s=null;
    const old=new DatabaseSync(file);old.exec('DROP TABLE worker_report_requests; ALTER TABLE work_stops DROP COLUMN request_id; ALTER TABLE hazard_reports DROP COLUMN request_id');old.close();
    s=new Store(file);assert.equal(s.workStops(site.id)[0].place,'이전 장소');assert.equal(s.workerHazardReports(worker.id)[0].title,'이전 제목');
    const stop={requestId:token,anonymous:true,place:'새 장소',reason:'새 사유'};s.createWorkStop(worker.id,stop);s.createWorkStop(worker.id,stop);assert.equal(s.workStops(site.id).length,2);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
