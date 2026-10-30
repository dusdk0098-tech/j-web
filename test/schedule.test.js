import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { scheduleMonthDays } from '../public/schedule.js';

test('일정 달력은 선택 가능한 날짜와 요일을 정확히 만든다',()=>{
  const leap=scheduleMonthDays('2024-02'),ordinary=scheduleMonthDays('2026-02');
  assert.equal(leap.firstWeekday,4);assert.equal(leap.days.length,29);assert.equal(leap.days[0],'2024-02-01');assert.equal(leap.days.at(-1),'2024-02-29');
  assert.equal(ordinary.firstWeekday,0);assert.equal(ordinary.days.length,28);assert.equal(ordinary.days.at(-1),'2026-02-28');assert.equal(scheduleMonthDays('9999-12').days.at(-1),'9999-12-31');
  for(const value of ['0999-01','2026-00','2026-13','2026-1','2026-02-01',null])assert.throws(()=>scheduleMonthDays(value),/월/);
});

test('일정 대상자는 현장별로 보존하고 이전 화면 수정에서 지워지지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-schedule-target-')),file=join(dir,'test.sqlite');let store=new Store(file);try{
    const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),person=store.createReviewer({siteId:a.id,loginId:'schedule_target',name:'가상 대상자',password:'virtual-password-123'}),foreign=store.createReviewer({siteId:b.id,loginId:'schedule_foreign',name:'다른 현장',password:'virtual-password-123'}),input={siteId:a.id,kind:'휴가',startDate:'2026-10-30',endDate:'2026-10-31',content:'가상 일정'},old=store.saveSchedule(input);assert.equal(old.target_id,null);assert.equal(old.target_name,'');
    for(const targetId of [foreign.id,-1,'1',999999])assert.throws(()=>store.saveSchedule({...input,targetId}));const row=store.saveSchedule({...input,targetId:person.id});assert.equal(row.target_name,'가상 대상자');assert.deepEqual(store.schedules(a.id,'2026-10','가상 대상자').map(item=>item.id),[row.id]);assert.deepEqual(store.schedules(b.id,'2026-10','가상 대상자'),[]);
    store.db.prepare('UPDATE reviewers SET name=? WHERE id=?').run('변경 이름',person.id);assert.equal(store.saveSchedule({...input,content:'이전 화면'},row.id).target_name,'가상 대상자');store.updateReviewer(a.id,person.id,{active:false});assert.equal(store.saveSchedule({...input,targetId:person.id},row.id).target_id,person.id);assert.throws(()=>store.saveSchedule({...input,targetId:person.id}),/대상자/);assert.throws(()=>store.saveSchedule({...input,targetId:0},row.id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.schedules(a.id,'2026-10','가상 대상자')[0].target_id,person.id);
    store.close();store=new Store(file);assert.equal(store.schedules(a.id,'2026-10','가상 대상자')[0].target_name,'가상 대상자');assert.equal(store.saveSchedule({...input,targetId:0},row.id).target_id,null);assert.equal(store.schedules(a.id,'2026-10','가상 대상자').length,0);
    store.close();const legacy=new DatabaseSync(file);legacy.exec('ALTER TABLE schedules DROP COLUMN target_name');legacy.exec('ALTER TABLE schedules DROP COLUMN target_id');legacy.close();store=new Store(file);assert.equal(store.schedules(a.id,'2026-10').find(item=>item.id===old.id).target_id,null);assert.equal(store.schedules(a.id,'2026-10').find(item=>item.id===old.id).target_name,'');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('시험 계정의 일정 API는 본인 대상으로 지정된 일정만 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reviewer-schedule-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],a=await (await send('/api/sites','POST',{name:'가상 A'},admin)).json(),b=await (await send('/api/sites','POST',{name:'가상 B'},admin)).json(),make=async(siteId,loginId)=>await (await send('/api/reviewers','POST',{siteId,loginId,name:loginId,password:'virtual-password-123'},admin)).json(),one=await make(a.id,'schedule_one'),two=await make(a.id,'schedule_two'),other=await make(b.id,'schedule_other'),input={siteId:a.id,kind:'휴가',startDate:'2026-10-31',endDate:'2026-11-02',content:'가상 일정 A',targetId:one.id};
    const own=await (await send('/api/schedules','POST',input,admin)).json(),second=await (await send('/api/schedules','POST',{...input,content:'가상 일정 B',targetId:two.id},admin)).json();await send('/api/schedules','POST',{...input,content:'대상 미지정',targetId:0},admin);await send('/api/schedules','POST',{...input,siteId:b.id,content:'다른 현장',targetId:other.id},admin);
    const login=async loginId=>(await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],oneCookie=await login(one.login_id),twoCookie=await login(two.login_id),otherCookie=await login(other.login_id),url='/api/reviewer/schedules?month=2026-11';assert.equal((await send(url)).status,401);assert.equal((await send(url,'GET',undefined,admin)).status,401);assert.deepEqual((await (await send(`${url}&siteId=${b.id}&reviewerId=${two.id}`,'GET',undefined,oneCookie)).json()).map(row=>row.id),[own.id]);assert.deepEqual((await (await send(url,'GET',undefined,twoCookie)).json()).map(row=>row.id),[second.id]);assert.equal((await (await send(url,'GET',undefined,otherCookie)).json())[0].content,'다른 현장');
    assert.deepEqual(await (await send('/api/reviewer/schedules?month=2026-12','GET',undefined,oneCookie)).json(),[]);assert.deepEqual(await (await send(`${url}&q=${encodeURIComponent('가상 일정 B')}`,'GET',undefined,oneCookie)).json(),[]);assert.equal((await send('/api/reviewer/schedules?month=2026-13','GET',undefined,oneCookie)).status,400);assert.equal((await send(`${url}&q=${'x'.repeat(201)}`,'GET',undefined,oneCookie)).status,400);
    assert.equal((await send(`/api/schedules/${own.id}`,'PUT',{...input,targetId:two.id},admin)).status,200);assert.deepEqual(await (await send(url,'GET',undefined,oneCookie)).json(),[]);assert.deepEqual((await (await send(url,'GET',undefined,twoCookie)).json()).map(row=>row.id),[own.id,second.id]);assert.equal((await send(`/api/reviewers/${two.id}`,'PUT',{siteId:a.id,active:false},admin)).status,200);assert.equal((await send(url,'GET',undefined,twoCookie)).status,401);assert.equal((await send('/api/reviewer/logout','POST',{},oneCookie)).status,200);assert.equal((await send(url,'GET',undefined,oneCookie)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('가상 일정은 현장·월·검색 조건을 지키고 재시작 후 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-schedule-')),file=join(dir,'test.sqlite');let store=new Store(file);
  try{
    const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),input={siteId:a.id,kind:'회의',startDate:'2026-10-30',endDate:'2026-11-02',startTime:'09:00',endTime:'10:00',content:'가상 회의'},row=store.saveSchedule(input);
    assert.deepEqual(store.schedules(a.id,'2026-10').map(x=>x.id),[row.id]);assert.deepEqual(store.schedules(a.id,'2026-11','회의').map(x=>x.id),[row.id]);assert.deepEqual(store.schedules(a.id,'2026-12'),[]);assert.deepEqual(store.schedules(b.id,'2026-11'),[]);assert.deepEqual(store.schedules(a.id,'2026-11','없는 검색'),[]);
    assert.throws(()=>store.saveSchedule({...input,siteId:b.id},row.id),/현장/);assert.throws(()=>store.deleteSchedule(b.id,row.id),/현장/);
    for(const change of [{kind:'모르는 구분'},{endDate:'2026-10-01'},{startDate:'2026-02-30'},{startTime:'24:01'},{startTime:0},{content:''}])assert.throws(()=>store.saveSchedule({...input,...change},row.id));
    assert.throws(()=>store.saveSchedule({...input,endDate:input.startDate,startTime:'15:00',endTime:'10:00'},row.id));assert.throws(()=>store.schedules(a.id,'2026-13'));
    store.close();store=new Store(file);assert.equal(store.schedules(a.id,'2026-11')[0].content,'가상 회의');assert.equal(store.saveSchedule({...input,kind:'교육',content:'수정'},row.id).content,'수정');store.deleteSchedule(a.id,row.id);assert.deepEqual(store.schedules(a.id,'2026-11'),[]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('일정 API는 관리자에게만 가상 기록의 등록과 삭제를 허용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-schedule-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/api/schedules?siteId=1&month=2026-10')).status,401);assert.equal((await send('/schedule.js')).status,200);
    const cookie=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},cookie)).json(),input={siteId:site.id,kind:'교육',startDate:'2026-10-30',endDate:'2026-10-30',startTime:'',endTime:'',content:'가상 교육'},created=await send('/api/schedules','POST',input,cookie);assert.equal(created.status,201);const row=await created.json();
    const other=await (await send('/api/sites','POST',{name:'다른 가상 현장'},cookie)).json(),target=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'schedule_api',name:'가상 대상자',password:'virtual-password-123'},cookie)).json(),foreign=await (await send('/api/reviewers','POST',{siteId:other.id,loginId:'schedule_api_other',name:'다른 대상자',password:'virtual-password-123'},cookie)).json();assert.equal((await send(`/api/schedules/${row.id}`,'PUT',{...input,targetId:foreign.id},cookie)).status,400);assert.equal((await send(`/api/schedules/${row.id}`,'PUT',{...input,targetId:target.id})).status,401);const updated=await (await send(`/api/schedules/${row.id}`,'PUT',{...input,targetId:target.id},cookie)).json();assert.equal(updated.target_name,'가상 대상자');assert.equal((await (await send(`/api/schedules?siteId=${site.id}&month=2026-10&q=${encodeURIComponent('가상 대상자')}`,'GET',undefined,cookie)).json())[0].id,row.id);
    assert.equal((await send(`/api/schedules/${row.id}`,'DELETE',{siteId:site.id})).status,401);assert.equal((await (await send(`/api/schedules?siteId=${site.id}&month=2026-10`,'GET',undefined,cookie)).json()).length,1);assert.equal((await send(`/api/schedules/${row.id}`,'DELETE',{siteId:site.id},cookie)).status,200);assert.deepEqual(await (await send(`/api/schedules?siteId=${site.id}&month=2026-10`,'GET',undefined,cookie)).json(),[]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('일정 저장 대기 중 대상자가 비활성화되면 기록하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-schedule-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.saveSchedule;Store.prototype.saveSchedule=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('SCHEDULE_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),target=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'schedule_race',name:'가상 대상',password:'virtual-password-123'},admin)).json(),input={siteId:site.id,kind:'휴가',startDate:'2026-10-30',endDate:'2026-10-30',content:'가상 일정',targetId:target.id};
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send('/api/schedules','POST',input,admin);pending.catch(()=>{});assert.match(String((await started)[0]),/SCHEDULE_LOCK/);db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(target.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM schedules WHERE site_id=?').get(site.id).n,0);db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(target.id);assert.equal((await send('/api/schedules','POST',input,admin)).status,201);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
