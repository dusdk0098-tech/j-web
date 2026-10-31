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
import { mountReviewerManagerCheck } from '../public/reviewer-manager-check.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const bytes=PNG.sync.write(png),signature='data:image/png;base64,'+bytes.toString('base64'),password='virtual-password-123';
const answers=[{answer:'O',note:'가상 메모'},{answer:'X',note:''},{answer:'O',note:'가상 확인'}];

test('직원별 점검은 현장·계정·날짜를 구분하고 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,id)=>s.createReviewer({siteId,loginId:id,name:id,password}),one=make(site.id,'self_one'),two=make(site.id,'self_two'),foreign=make(other.id,'self_other'),date='2024-02-29';
    s.saveManagerCheck(site.id,date,answers,signature);
    s.saveReviewerManagerCheck(one.id,date,{kind:'check',answers,signature,siteId:other.id,reviewerId:foreign.id});
    s.saveReviewerManagerCheck(two.id,date,{kind:'day_off'});
    s.saveReviewerManagerCheck(foreign.id,date,{kind:'check',answers,signature});
    assert.throws(()=>s.saveReviewerManagerCheck(one.id,date,{kind:'day_off'}),/이미/);
    assert.throws(()=>s.saveReviewerManagerCheck(two.id,date,{kind:'check',answers,signature}),/이미/);
    assert.throws(()=>s.saveReviewerManagerCheck(one.id,'2024-03-01',{kind:'check',answers:answers.slice(0,2),signature}),/항목/);
    assert.throws(()=>s.saveReviewerManagerCheck(one.id,'2024-03-01',{kind:'check',answers,signature:'잘못된 서명'}),/서명/);
    assert.throws(()=>s.saveReviewerManagerCheck(one.id,'2024-03-01',{kind:'day_off'},()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.throws(()=>s.saveManagerDayOff(site.id,'2024-03-01',()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.throws(()=>s.saveManagerCheck(site.id,'2024-03-01',answers,signature,()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.equal(s.managerChecks(site.id).length,1);
    assert.deepEqual(s.reviewerManagerChecks(one.id)[0].answers,answers);
    assert.deepEqual(s.reviewerManagerChecks(two.id)[0].answers,null);
    assert.equal(s.siteReviewerManagerChecks(site.id,date).length,2);
    assert.equal(s.siteReviewerManagerChecks(other.id,date).length,1);
    assert.deepEqual(Buffer.from(s.siteReviewerManagerSignature(site.id,one.id,date)),bytes);
    assert.equal(s.siteReviewerManagerSignature(other.id,one.id,date),null);
    assert.equal(s.siteReviewerManagerSignature(site.id,two.id,date),null);
    assert.equal(s.weeklyActivity(site.id,date)[0].managerChecks,2);
    assert.equal(s.weeklyActivity(site.id,date)[0].managerDaysOff,1);
    let calls=0;
    assert.throws(()=>s.reviewerManagerChecks(one.id,()=>{if(++calls===2)throw Error('세션 만료');}),/세션 만료/);
    s.updateReviewer(site.id,one.id,{active:false});
    assert.throws(()=>s.reviewerManagerChecks(one.id),/직원 계정/);
    assert.equal(s.siteReviewerManagerChecks(site.id,date).length,2);
  }finally{s.close();}
});

test('직원 화면은 이전 답변과 시험 서명을 본인 요청에 전달한다',async()=>{
  const controls=Object.fromEntries(['[data-status]','[data-reload]','[data-dayoff]','[data-clear]','[data-signature]','[data-previous]'].map(key=>[key,{isConnected:true,addEventListener(){}}]));
  const submit={disabled:false},form={elements:{},addEventListener(){},querySelector(){return submit;}};
  for(let i=0;i<3;i++){form.elements['answer'+i]={value:''};form.elements['note'+i]={value:''};}
  controls['[data-check]']=form;
  const target={innerHTML:'',querySelector(key){return controls[key];}};
  let records=[{date:'2026-10-30',kind:'check',answers:[{answer:'O',note:'<가상>'},{answer:'X',note:''},{answer:'O',note:''}]}],saved;
  const api=async(path,options={})=>{assert.equal(path,'/api/reviewer/manager-checks');if(options.method==='POST'){saved=JSON.parse(options.body);records=[{date:saved.expectedDate,kind:saved.kind,answers:saved.answers},...records];return {ok:true};}return {today:'2026-10-31',records};};
  await mountReviewerManagerCheck({target,api,pad:()=>()=>signature,active:()=>true});
  controls['[data-previous]'].onchange({target:{value:'0'}});
  assert.equal(form.elements.answer0.value,'O');assert.equal(form.elements.note0.value,'<가상>');
  await form.onsubmit({preventDefault(){}});
  assert.equal(saved.kind,'check');assert.equal(saved.expectedDate,'2026-10-31');assert.equal(saved.signature,signature);
  assert.match(target.innerHTML,/&lt;가상&gt;/);assert.doesNotMatch(target.innerHTML,/<가상>/);
  let release,visible=true;const pending=new Promise(resolve=>{release=resolve;}),stale={innerHTML:'변경 전',querySelector(){throw Error('만료된 화면 접근');}};
  const loading=mountReviewerManagerCheck({target:stale,api:()=>pending,pad:()=>{},active:()=>visible});visible=false;release({today:'2026-10-31',records:[]});await loading;assert.equal(stale.innerHTML,'변경 전');
});

test('직원 점검 API는 계정별로 분리하고 서버 재시작 후 보존한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-staff-check-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  try{
    await start();const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),loginAdmin=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await loginAdmin();const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json(),make=async(siteId,id)=>await (await send('/api/reviewers','POST',{siteId,loginId:id,name:id,password},admin)).json(),one=await make(site.id,'staff_check_one'),two=await make(site.id,'staff_check_two'),foreign=await make(other.id,'staff_check_other'),login=async id=>(await send('/api/reviewer/login','POST',{loginId:id,password})).headers.get('set-cookie').split(';')[0],first=await login(one.login_id),second=await login(two.login_id),outside=await login(foreign.login_id),path='/api/reviewer/manager-checks';
    assert.equal((await send(path)).status,401);assert.equal((await send(path,'GET',undefined,admin)).status,401);assert.equal((await fetch(root+'/reviewer-manager-check.js')).status,200);
    const initial=await send(path,'GET',undefined,first);assert.equal(initial.status,200);assert.match(initial.headers.get('cache-control'),/no-store/);const {today}=await initial.json();
    assert.equal((await send(path,'POST',{kind:'day_off',expectedDate:'2000-01-01'},first)).status,409);
    assert.equal((await send(path,'POST',{kind:'check',expectedDate:today,answers,signature:'invalid'},first)).status,400);
    assert.equal((await send(path,'POST',{kind:'check',expectedDate:today,answers,signature,siteId:other.id,reviewerId:foreign.id},first)).status,201);
    assert.equal((await send(path,'POST',{kind:'day_off',expectedDate:today},first)).status,400);
    assert.equal((await send(path,'POST',{kind:'day_off',expectedDate:today},second)).status,201);
    assert.equal((await send(path,'POST',{kind:'check',expectedDate:today,answers,signature},outside)).status,201);
    assert.equal((await (await send(path,'GET',undefined,first)).json()).records[0].kind,'check');
    assert.equal((await (await send(path,'GET',undefined,second)).json()).records[0].kind,'day_off');
    const own=`${path}/signature?date=${today}&reviewerId=${foreign.id}`;
    assert.deepEqual(Buffer.from(await (await send(own,'GET',undefined,first)).arrayBuffer()),bytes);
    assert.equal((await send(own,'GET',undefined,second)).status,404);
    const list=`/api/sites/${site.id}/reviewer-manager-checks?date=${today}`;
    assert.equal((await send(list,'GET',undefined,first)).status,401);
    assert.deepEqual((await (await send(list,'GET',undefined,admin)).json()).map(item=>item.id).sort((a,b)=>a-b),[one.id,two.id].sort((a,b)=>a-b));
    assert.equal((await (await send(`/api/sites/${other.id}/reviewer-manager-checks?date=${today}`,'GET',undefined,admin)).json()).length,1);
    const image=`/api/sites/${site.id}/reviewer-manager-checks/${one.id}/signature?date=${today}`;
    assert.deepEqual(Buffer.from(await (await send(image,'GET',undefined,admin)).arrayBuffer()),bytes);
    assert.equal((await send(`/api/sites/${other.id}/reviewer-manager-checks/${one.id}/signature?date=${today}`,'GET',undefined,admin)).status,404);
    const week=(await (await send(`/api/weekly-activity?siteId=${site.id}&start=${today}`,'GET',undefined,admin)).json())[0];assert.equal(week.managerChecks,1);assert.equal(week.managerDaysOff,1);
    await stop();await start();admin=await loginAdmin();
    assert.equal((await (await send(path,'GET',undefined,first)).json()).records[0].kind,'check');
    assert.equal((await (await send(list,'GET',undefined,admin)).json()).length,2);
    assert.deepEqual(Buffer.from(await (await send(image,'GET',undefined,admin)).arrayBuffer()),bytes);
  }finally{await stop();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('쓰기 잠금을 기다리는 중 세션이 종료되면 직원 점검을 저장하지 않는다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-staff-check-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const module=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(module)};const original=Store.prototype.saveReviewerManagerCheck;Store.prototype.saveReviewerManagerCheck=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('STAFF_CHECK_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),person=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'staff_check_race',name:'가상 직원',password},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:person.login_id,password})).headers.get('set-cookie').split(';')[0],path='/api/reviewer/manager-checks',today=(await (await send(path,'GET',undefined,cookie)).json()).today;
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;
    const entered=once(child.stdout,'data'),pending=send(path,'POST',{kind:'check',expectedDate:today,answers,signature},cookie);pending.catch(()=>{});assert.match(String((await entered)[0]),/STAFF_CHECK_LOCK/);
    db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(person.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviewer_manager_checks').get().n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

