import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { runInNewContext } from 'node:vm';
import { verifyWorkerLocation } from '../geo.js';
import { captureWorkerLocation } from '../public/worker-location.js';

const position=(latitude=0,longitude=0,accuracyMeters=10,timestamp=Date.now())=>({latitude,longitude,accuracyMeters,timestamp});
const policy={enabled:true,latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:50};

test('위치 입력은 기기 권한 오류를 전달하고 오래된 위치를 요청하지 않는다',async()=>{
  let options;const fake={getCurrentPosition(success,_error,settings){options=settings;success({coords:{latitude:0,longitude:0,accuracy:10},timestamp:123});}};
  assert.deepEqual(await captureWorkerLocation(fake),position(0,0,10,123));assert.deepEqual(options,{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  await assert.rejects(captureWorkerLocation({getCurrentPosition(_success,error){error({code:1});}}),/권한/);await assert.rejects(captureWorkerLocation({getCurrentPosition(success){success(null);}}),/위치/);await assert.rejects(captureWorkerLocation(null),/사용/);
});

test('위치 확인은 거리·정확도·측정 시각을 검사한다',()=>{
  const now=Date.now(),inside=verifyWorkerLocation(policy,position(0,0,10,now),now);assert.equal(inside.distanceMeters,0);
  assert.throws(()=>verifyWorkerLocation(policy,position(0.01,0,10,now),now),/반경/);
  assert.throws(()=>verifyWorkerLocation(policy,position(0,0,51,now),now),/정확도/);
  assert.throws(()=>verifyWorkerLocation(policy,position(0,0,10,now-120001),now),/시각/);
  assert.throws(()=>verifyWorkerLocation(policy,position(91,0,10,now),now),/위치/);
  assert.throws(()=>verifyWorkerLocation(policy,null,now),/위치/);
  assert.ok(verifyWorkerLocation({...policy,longitude:179.999,radiusMeters:500},position(0,-179.999,10,now),now).distanceMeters<500);
});

test('현장별 위치 설정과 출역 확인은 함께 저장되고 실패하면 되돌린다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
    assert.deepEqual(s.siteLocationPolicy(site.id),{enabled:false,version:null});
    for(const bad of [{...policy,latitude:91},{...policy,radiusMeters:0},{...policy,maxAccuracyMeters:0},{...policy,longitude:'0'}])assert.throws(()=>s.setSiteLocationPolicy(site.id,{...bad,expectedVersion:null}),/위치|반경|정확도/);
    assert.throws(()=>s.setSiteLocationPolicy(site.id,{...policy,expectedVersion:null},()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.siteLocationPolicy(site.id).enabled,false);
    const saved=s.setSiteLocationPolicy(site.id,{...policy,expectedVersion:null});assert.equal(saved.enabled,true);assert.throws(()=>s.setSiteLocationPolicy(site.id,{enabled:false,expectedVersion:null}),error=>error.sessionStatus===409);
    assert.throws(()=>s.recordWorkerLogin(worker.id,'2026-10-30'),/위치/);assert.throws(()=>s.recordWorkerLogin(worker.id,'2026-10-30',null,null,position(0.01)),/반경/);assert.deepEqual(s.workerLocationEvents(site.id,'2026-10-30'),[]);
    s.db.exec("CREATE TRIGGER fail_location_event BEFORE INSERT ON worker_location_events BEGIN SELECT RAISE(ABORT,'시험 위치 저장 실패'); END");assert.throws(()=>s.recordWorkerLogin(worker.id,'2026-10-30',null,null,position()),/시험 위치 저장 실패/);assert.deepEqual(s.attendance(site.id,'2026-10-30').filter(row=>row.present),[]);s.db.exec('DROP TRIGGER fail_location_event');
    s.recordWorkerLogin(worker.id,'2026-10-30',null,null,position());const events=s.workerLocationEvents(site.id,'2026-10-30');assert.equal(events.length,1);assert.equal(events[0].worker_id,worker.id);assert.equal(events[0].distance_meters,0);assert.deepEqual(s.workerLocationEvents(other.id,'2026-10-30'),[]);
    assert.throws(()=>s.recordWorkerLogin(worker.id,'2026-10-31',null,()=>{throw Error('세션 만료');},position()),/세션 만료/);assert.deepEqual(s.workerLocationEvents(site.id,'2026-10-31'),[]);assert.deepEqual(s.attendance(site.id,'2026-10-31').filter(row=>row.present),[]);
    assert.throws(()=>s.deleteWorkerLocationEvent(other.id,events[0].id),/현장|위치/);assert.throws(()=>s.deleteWorkerLocationEvent(site.id,events[0].id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.workerLocationEvents(site.id,'2026-10-30').length,1);
    s.deleteWorkerLocationEvent(site.id,events[0].id);assert.deepEqual(s.workerLocationEvents(site.id,'2026-10-30'),[]);
    s.setSiteLocationPolicy(site.id,{enabled:false,expectedVersion:saved.version});s.recordWorkerLogin(worker.id,'2026-11-01');assert.equal(s.attendance(site.id,'2026-11-01')[0].present,1);
  }finally{s.close();}
});

test('첫 시험 접속은 위치 설정과 무관하게 날짜별로 보존하고 실패 시 되돌린다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-arrivals-')),file=join(dir,'data.sqlite');let s=new Store(file);try{const site=s.createSite({name:'가상'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상',category:'직영',company:'가상',occupation:'목공'}),date='2026-10-30';s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});assert.deepEqual(s.workerArrivals(site.id,date),[]);assert.throws(()=>s.recordWorkerLogin(worker.id,date,null,()=>{throw Error('권한 회수');}),/권한 회수/);assert.deepEqual(s.workerArrivals(site.id,date),[]);s.recordWorkerLogin(worker.id,date);const first=s.workerArrivals(site.id,date);assert.equal(first.length,1);assert.equal(first[0].worker_id,worker.id);assert.equal(typeof first[0].checked_at,'number');s.recordWorkerLogin(worker.id,date);assert.deepEqual(s.workerArrivals(site.id,date),first);assert.deepEqual(s.workerArrivals(other.id,date),[]);s.recordWorkerLogin(worker.id,'2026-10-31');assert.equal(s.workerArrivals(site.id,'2026-10-31').length,1);s.close();s=new Store(file);assert.deepEqual(s.workerArrivals(site.id,date),first);s.db.exec('DROP TABLE worker_arrivals');s.close();s=new Store(file);assert.deepEqual(s.workerArrivals(site.id,date),[]);assert.equal(s.attendance(site.id,date)[0].present,1);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('첫 접속 삭제는 현장·권한·기록 변경을 확인하고 기존 자료를 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-arrival-version-')),file=join(dir,'data.sqlite');let s=new Store(file);try{const site=s.createSite({name:'가상'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상',category:'직영',company:'가상',occupation:'목공'}),date='2026-10-30';s.recordWorkerLogin(worker.id,date);const original=s.workerArrivals(site.id,date)[0];assert.match(original.version,/^[a-f0-9]{32}$/);assert.throws(()=>s.deleteWorkerArrival(other.id,worker.id,date,original.version),error=>error.sessionStatus===409);assert.throws(()=>s.deleteWorkerArrival(site.id,worker.id,date,original.version,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.workerArrivals(site.id,date).length,1);s.deleteWorkerArrival(site.id,worker.id,date,original.version);assert.equal(s.attendance(site.id,date)[0].present,1);s.recordWorkerLogin(worker.id,date);const replacement=s.workerArrivals(site.id,date)[0];assert.notEqual(replacement.version,original.version);assert.throws(()=>s.deleteWorkerArrival(site.id,worker.id,date,original.version),error=>error.sessionStatus===409);s.db.exec('DROP TRIGGER worker_arrivals_version; ALTER TABLE worker_arrivals DROP COLUMN version');s.close();s=new Store(file);const upgraded=s.workerArrivals(site.id,date)[0];assert.equal(upgraded.checked_at,replacement.checked_at);assert.match(upgraded.version,/^[a-f0-9]{32}$/);s.deleteWorkerArrival(site.id,worker.id,date,upgraded.version);assert.equal(s.workerArrivals(site.id,date).length,0);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('첫 접속 화면은 시험 기록을 표시하고 이름을 안전하게 처리한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),marker='<h3>시험 첫 접속 시각</h3>',at=source.indexOf(marker),start=source.lastIndexOf("    content.insertAdjacentHTML('beforeend'",at),end=source.indexOf('\n',at);assert.ok(start>=0&&end>at);let html='';const content={insertAdjacentHTML(_position,value){html=value;}},esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));runInNewContext(source.slice(start,end),{content,esc,arrivals:[{name:'<가상>',checked_at:Date.UTC(2026,9,30)}],Date});assert.match(html,/&lt;가상&gt;/);assert.doesNotMatch(html,/<가상>/);assert.match(html,/2026/);
});

test('첫 접속 삭제 버튼은 조회한 날짜와 확인값을 보낸다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    content.querySelectorAll('[data-arrival-id]')"),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);let call;const button={dataset:{arrivalId:'7',arrivalVersion:'a'.repeat(32)}},context={content:{querySelectorAll:()=>[button]},confirm:()=>true,api:async(path,options)=>{call={path,method:options.method};},base:'/api/sites/1',date:'2026-10-30',state:{siteId:1,page:'worker-locations'},siteId:1,detailEpoch:1,epoch:1,render:async()=>{},showError:error=>{throw error;},encodeURIComponent};runInNewContext(source.slice(start,end),context);await button.onclick();assert.equal(call.path,`/api/sites/1/worker-arrivals/7?date=2026-10-30&version=${'a'.repeat(32)}`);assert.equal(call.method,'DELETE');
});

test('QR 가입 계정은 설정된 위치 확인을 통과해야 시험 출역한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-location-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),path=`/api/sites/${site.id}`;
    const invitation=await (await send(path+'/invitation','POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token');
    const registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'location_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',registration)).status,201);
    assert.equal((await send(path+'/location-policy','PUT',{...policy,expectedVersion:null})).status,401);const updated=await send(path+'/location-policy','PUT',{...policy,expectedVersion:null},admin);assert.equal(updated.status,200);const configured=await updated.json();
    assert.equal((await send(path+'/location-policy','PUT',{enabled:false,expectedVersion:null},admin)).status,409);
    const inviteInfo=await (await send(`/api/join?token=${encodeURIComponent(token)}`)).json();assert.equal(inviteInfo.locationRequired,true);assert.equal(Object.hasOwn(inviteInfo,'latitude'),false);const siteInfo=await (await send(`/api/worker/site?key=${encodeURIComponent(inviteInfo.siteKey)}`)).json();assert.equal(siteInfo.locationRequired,true);assert.equal(Object.hasOwn(siteInfo,'latitude'),false);
    const credentials={token,loginId:registration.loginId,password:registration.password},identity={token,method:'identity',name:registration.name,birthDigits:'000101',password:registration.password};assert.equal((await send('/api/worker/login','POST',credentials)).status,400);assert.equal((await send('/api/worker/login','POST',{...credentials,location:position(0.01)})).status,400);assert.equal((await send('/api/worker/login','POST',identity)).status,400);
    const login=await send('/api/worker/login','POST',{...credentials,location:position()});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const day=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),eventsPath=path+`/location-events?date=${day}`,arrivalsPath=path+`/worker-arrivals?date=${day}`;
    assert.equal((await send(arrivalsPath)).status,401);assert.equal((await send(arrivalsPath,'GET',undefined,cookie)).status,401);const arrivals=await (await send(arrivalsPath,'GET',undefined,admin)).json();assert.equal(arrivals.length,1);assert.equal(arrivals[0].name,'가상 근로자');assert.equal('latitude' in arrivals[0],false);
    assert.equal((await send(eventsPath)).status,401);assert.equal((await send(eventsPath,'GET',undefined,cookie)).status,401);assert.equal((await (await send(eventsPath,'GET',undefined,admin)).json()).length,1);
    assert.equal((await send('/api/worker/access','POST',{siteId:site.id,token},cookie)).status,400);assert.equal((await send('/api/worker/access','POST',{siteId:site.id,token,location:position()},cookie)).status,200);assert.deepEqual(await (await send(arrivalsPath,'GET',undefined,admin)).json(),arrivals);
    assert.equal((await send('/api/worker/login','POST',{...identity,location:position()})).status,200);assert.equal((await send('/api/worker/login','POST',{siteKey:inviteInfo.siteKey,loginId:registration.loginId,password:registration.password,location:position()})).status,200);const events=await (await send(eventsPath,'GET',undefined,admin)).json();assert.equal(events.length,4);assert.equal((await send(path+`/location-events/${events[0].id}`,'DELETE',{},cookie)).status,401);assert.equal((await send(path+`/location-events/${events[0].id}`,'DELETE',{},admin)).status,200);
    assert.equal((await send(path+'/location-policy','PUT',{enabled:false,expectedVersion:configured.version},admin)).status,200);assert.equal((await send('/api/worker/login','POST',credentials)).status,200);const arrival=arrivals[0],deletePath=path+`/worker-arrivals/${arrival.worker_id}?date=${day}&version=${arrival.version}`;assert.equal((await send(deletePath,'DELETE')).status,401);assert.equal((await send(deletePath,'DELETE',undefined,admin)).status,200);assert.equal((await send('/api/worker/login','POST',credentials)).status,200);const again=await (await send(arrivalsPath,'GET',undefined,admin)).json();assert.equal(again.length,1);assert.notEqual(again[0].version,arrival.version);assert.equal((await send(deletePath,'DELETE',undefined,admin)).status,409);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('위치 기준이 저장 대기 중 변경되면 최신 설정으로 출역을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-location-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.recordWorkerLogin;Store.prototype.recordWorkerLogin=function(...args){process.stdout.write('LOCATION_LOCK\\n');return original.apply(this,args)}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invitation=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token');
    const registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'location_race',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',registration)).status,201);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const credentials={token,loginId:registration.loginId,password:registration.password};
    db.exec('BEGIN IMMEDIATE');locked=true;let started=once(child.stdout,'data'),pending=send('/api/worker/login','POST',credentials);pending.catch(()=>{});assert.match(String((await started)[0]),/LOCATION_LOCK/);
    db.prepare('INSERT INTO site_location_policies(site_id,enabled,latitude,longitude,radius_meters,max_accuracy_meters,version) VALUES(?,1,0,0,100,50,?)').run(site.id,'a'.repeat(32));db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_sessions').get().n,0);
    db.exec('BEGIN IMMEDIATE');locked=true;started=once(child.stdout,'data');pending=send('/api/worker/login','POST',credentials);pending.catch(()=>{});assert.match(String((await started)[0]),/LOCATION_LOCK/);db.prepare('UPDATE site_location_policies SET enabled=0,version=? WHERE site_id=?').run('b'.repeat(32),site.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_location_events').get().n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
