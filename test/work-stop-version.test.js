import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;const photo=PNG.sync.write(png),photoUrl=`data:image/png;base64,${photo.toString('base64')}`;
const payload=(stop,response)=>({previousResponse:stop.response,expectedVersion:stop.version,...(response===undefined?{}:{response})});
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};

test('번호가 재사용되거나 조치 내용이 되돌아와도 이전 화면의 조치·삭제·사진은 거절된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
    s.createWorkStop(worker.id,{anonymous:true,place:'첫 장소',reason:'첫 요청',photo:photoUrl});const old=s.workStops(site.id)[0];assert.match(old.version,/^[0-9a-f]{32}$/);
    assert.throws(()=>s.updateWorkStopResponse(site.id,old.id,{previousResponse:null,response:'조치'}),/기존 조치/);
    s.deleteWorkStop(site.id,old.id,payload(old));s.createWorkStop(worker.id,{anonymous:true,place:'새 장소',reason:'새 요청',photo:photoUrl});
    const next=s.workStops(site.id)[0];assert.equal(next.id,old.id);assert.notEqual(next.version,old.version);
    assert.throws(()=>s.updateWorkStopResponse(site.id,old.id,payload(old,'이전 화면의 조치')),/다른 변경/);
    assert.throws(()=>s.deleteWorkStop(site.id,old.id,payload(old)),/다른 변경/);
    assert.equal(s.workStopPhoto(site.id,old.id,old.version),null);assert.deepEqual(Buffer.from(s.workStopPhoto(site.id,next.id,next.version)),photo);
    s.updateWorkStopResponse(site.id,next.id,payload(next,'가상 조치 A'));const first=s.workStops(site.id)[0];
    s.updateWorkStopResponse(site.id,next.id,payload(first,'가상 조치 B'));const second=s.workStops(site.id)[0];
    s.updateWorkStopResponse(site.id,next.id,payload(second,'가상 조치 A'));const latest=s.workStops(site.id)[0];assert.equal(latest.response,first.response);assert.notEqual(latest.version,first.version);
    assert.throws(()=>s.updateWorkStopResponse(site.id,next.id,payload(first,'오래된 조치')),/다른 변경/);assert.throws(()=>s.deleteWorkStop(site.id,next.id,payload(first)),/다른 변경/);
    const denied=()=>{throw Error('관리자 세션 만료');};assert.throws(()=>s.updateWorkStopResponse(site.id,next.id,payload(latest,'수정'),denied),/세션 만료/);assert.throws(()=>s.deleteWorkStop(site.id,next.id,payload(latest),denied),/세션 만료/);
    const saved=s.workStops(site.id)[0];assert.equal(saved.response,latest.response);assert.equal(saved.version,latest.version);assert.deepEqual(Buffer.from(s.workStopPhoto(site.id,next.id,latest.version)),photo);
  }finally{s.close();}
});

test('작업중지 API는 이전 요청의 번호와 저장 대기 중 만료된 관리자 세션을 차단한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-work-stop-version-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,auth=pathToFileURL(join(process.cwd(),'auth.js')).href;
  const trace=`import {Store} from ${JSON.stringify(source)};import {LocalAuth} from ${JSON.stringify(auth)};let armed=false,expired=false;process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.includes('expire')){armed=true;expired=false;process.stdout.write('ARMED\\n')}});const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(token,now){return valid.call(this,token,expired?Date.now()+9*60*60*1000:now)};for(const name of ['updateWorkStopResponse','deleteWorkStop']){const original=Store.prototype[name];Store.prototype[name]=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'&&armed){process.stdout.write('WAITING\\n');const result=exec.call(this,sql);expired=true;armed=false;return result}return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['pipe','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),loginAdmin=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const admin=await loginAdmin(),site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const worker={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'stop_version',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',worker)).status,201);const login=await send('/api/worker/login','POST',{token,loginId:worker.loginId,password:worker.password}),workerCookie=login.headers.get('set-cookie').split(';')[0],listPath=`/api/sites/${site.id}/work-stops`,list=async()=>(await (await send(listPath,'GET',null,admin)).json())[0];
    const submit=(place)=>send('/api/worker/work-stops','POST',{anonymous:true,place,reason:'가상 위험',photo:photoUrl},workerCookie);
    assert.equal((await submit('첫 장소')).status,201);const old=await list(),path=`${listPath}/${old.id}`;
    assert.equal((await send(path,'DELETE',payload(old),admin)).status,200);assert.equal((await submit('새 장소')).status,201);
    const next=await list();assert.equal(next.id,old.id);assert.notEqual(next.version,old.version);
    assert.equal((await send(path,'PUT',payload(old,'오래된 조치'),admin)).status,400);assert.equal((await send(path,'DELETE',payload(old),admin)).status,400);
    assert.equal((await send(`${path}/photo?version=${old.version}`,'GET',null,admin)).status,404);
    assert.deepEqual(Buffer.from(await (await send(`${path}/photo?version=${next.version}`,'GET',null,admin)).arrayBuffer()),photo);
    assert.equal((await send(path,'PUT',payload(next,'가상 조치'),admin)).status,200);const current=await list();assert.notEqual(current.version,next.version);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [method,data] of [['PUT',payload(current,'늦은 조치')],['DELETE',payload(current)]]){
      const cookie=await loginAdmin(),armed=once(child.stdout,'data');child.stdin.write('expire\n');assert.match(String((await armed)[0]),/ARMED/);
      db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(path,method,data,cookie);pending.catch(()=>{});assert.match(String((await started)[0]),/WAITING/);db.exec('COMMIT');locked=false;
      assert.equal((await pending).status,401);const saved=db.prepare('SELECT response,version FROM work_stops WHERE id=?').get(current.id);assert.deepEqual({...saved},{response:current.response,version:current.version});
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});
