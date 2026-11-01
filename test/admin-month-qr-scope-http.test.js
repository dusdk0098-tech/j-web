import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import http from 'node:http';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
const password='virtual-month-qr-password';
test('제한 관리자 월·QR: 허용 범위, 충돌, 위조, 지연 본문, SQLite 잠금, QR 생성 중 철회',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-scope-month-qr-')),store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db);auth.bootstrap(password);
 const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),c=store.createSite({name:'가상 C'}),fields={name:'가상',category:'직영',company:'가상 소속',occupation:'목공'},wa=store.createWorker({...fields,siteId:a.id}),wb=store.createWorker({...fields,siteId:b.id});
 const actor=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[a.id,b.id]}),other=auth.create({loginId:'other',name:'가상 타인',password,scope:'restricted',siteIds:[a.id]});
 const date='2026-11-02',entry={siteId:a.id,workerId:wa.id,date};store.setAttendance({...entry,present:true});store.setAttendanceDailyRate({...entry,dailyRate:'12345'});store.setAttendanceUnits({...entry,units:'1.25'});
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const gate=join(dir,'gate'),expired=join(dir,'expired'),url=file=>pathToFileURL(join(process.cwd(),file)).href;
 const hook=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(url('store.js'))};import {AdminAccounts} from ${JSON.stringify(url('admin-accounts.js'))};import qr from ${JSON.stringify(url('node_modules/qrcode/lib/index.js'))};const valid=AdminAccounts.prototype.valid;AdminAccounts.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(expired)})?9*60*60*1000:0))};for(const name of ['updateMonthlyAttendanceDetails','openSiteRegistration','revokeInvitations']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('WRITE_START\\n');return original.apply(this,args)}}const render=qr.toDataURL;let release;qr.toDataURL=(...args)=>existsSync(${JSON.stringify(gate)})?new Promise(resolve=>{release=()=>resolve(render(...args));process.stdout.write('QR_START\\n')}):render(...args);process.stdin.on('data',()=>{if(release){const run=release;release=null;run()}});`;
 const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(hook)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['pipe','pipe','pipe']});let locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패')})]);
  const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie,headers={})=>fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async id=>(await send('/api/login','POST',{loginId:id,password})).headers.get('set-cookie').split(';')[0];
  let cookie=await login('limited');const global=await login('admin'),monthPath=`/api/attendance/month?siteId=${a.id}&month=2026-11`,save='/api/attendance/month/details',qrPath=`/api/sites/${a.id}`;
  const month=async()=>{const r=await send(monthPath,'GET',undefined,cookie);assert.equal(r.status,200);return (await r.json()).find(w=>w.id===wa.id)},payload=async()=>({siteId:a.id,workerId:wa.id,month:'2026-11',expectedVersion:(await month()).version,company:'가상 월 수정'});
  const initial=await month();assert.equal(initial.units[0].units_hundredths,125);assert.ok(Number.isInteger(initial.dayVersions[date]));for(const key of ['phone','birth_date','daily_rate','salary_amount','estimated_pay']){assert.equal(Object.hasOwn(initial,key),false);assert.equal(Object.hasOwn(initial.units[0],key),false)}
  const first=await payload();assert.equal((await send(save,'PUT',first,cookie)).status,200);assert.equal((await month()).units[0].company,'가상 월 수정');assert.equal((await send(save,'PUT',first,cookie)).status,409);assert.equal(store.db.prepare('SELECT daily_rate FROM attendance WHERE worker_id=?').get(wa.id).daily_rate,12345);
  for(const extra of [{siteId:c.id},{workerId:wb.id},{workerId:[wa.id]},{siteId:[a.id]},{workerIds:[wa.id,wb.id]},{rows:[wa.id]},{month:['2026-11']},{months:['2026-11']},{month:'2026-13'},{expectedVersion:undefined},{dailyRate:'100'},{salaryKind:'monthly',salaryAmount:'1'},{phone:'010'},{units:'2'}])assert.equal((await send(save,'PUT',{...await payload(),...extra},cookie)).status,403,JSON.stringify(extra));
  for(const path of [monthPath+'&siteId='+b.id,monthPath+'&month=2026-12',monthPath+'&workerIds='+wa.id,`/api/workers/export?siteId=${a.id}`,`/api/workers/${wa.id}/files?siteId=${a.id}`,`/api/attendance/report?siteId=${a.id}`,save+'/bulk',`/api/sites/${a.id}/location-policy`])assert.equal((await send(path,'GET',undefined,cookie)).status,403,path);
  assert.equal((await send(save+'?siteId='+b.id,'PUT',await payload(),cookie)).status,403);
  assert.equal((await send(save,'PUT',{...await payload(),dailyRate:'222'},global)).status,200);
  for(const suffix of ['access/status','access','access/rotate','access/registration','invitation']){const method=suffix==='access/status'?'GET':'POST';assert.equal((await send(`/api/sites/${c.id}/${suffix}`,method,method==='POST'?{}:undefined,cookie)).status,403);assert.equal((await send(qrPath+'/'+suffix+'?siteId='+b.id,method,method==='POST'?{}:undefined,cookie)).status,403);}
  for(const data of [{siteId:a.id},{siteIds:[a.id,b.id]},{workerId:wa.id},{rows:[]}])assert.equal((await send(qrPath+'/access','POST',data,cookie)).status,403);
  assert.equal((await send(qrPath+'/access/status?siteId='+a.id+'&siteId='+a.id,'GET',undefined,cookie)).status,403);assert.equal((await send(qrPath+'/access/status','POST',{},cookie)).status,403);
  assert.equal((await send(qrPath+'/access/status','GET',undefined,cookie)).status,200);
  assert.equal((await send(qrPath+'/access','POST',{},cookie)).status,200);const oldKey=store.siteAccessKey(a.id);
  assert.equal((await send(qrPath+'/access/registration','POST',{},cookie)).status,200);assert.equal(store.siteRegistrationOpen(a.id),true);
  assert.equal((await send(qrPath+'/invitation','POST',{},cookie)).status,201);assert.equal((await send(qrPath+'/invitation','DELETE',undefined,cookie)).status,200);assert.equal(store.siteRegistrationOpen(a.id),false);
  assert.equal((await send(qrPath+'/access/rotate','POST',{},cookie)).status,200);assert.notEqual(store.siteAccessKey(a.id),oldKey);
  const update=(id,values)=>auth.update(id,{version:auth.list().find(x=>x.id===id).version,...values});
  const delayed=async(path,method,data,change)=>{const req=http.request(base+path,{method,headers:{cookie,'content-type':'application/json'}}),answer=new Promise((r,j)=>{req.on('response',res=>{res.resume();r(res.statusCode)});req.on('error',j)});req.write('{');await new Promise(r=>setTimeout(r,70));change();req.end(JSON.stringify(data).slice(1));return answer};
  const before=store.db.prepare('SELECT company_snapshot FROM attendance WHERE worker_id=?').get(wa.id).company_snapshot;
  assert.equal(await delayed(save,'PUT',await payload(),()=>update(actor.id,{siteIds:[b.id]})),401);assert.equal(store.db.prepare('SELECT company_snapshot FROM attendance WHERE worker_id=?').get(wa.id).company_snapshot,before);
  update(actor.id,{siteIds:[a.id,b.id]});cookie=await login('limited');
  assert.equal(await delayed(save,'PUT',await payload(),()=>update(other.id,{name:'가상 타인 변경'})),200);
  assert.equal(await delayed(qrPath+'/invitation','POST',{},()=>update(actor.id,{siteIds:[b.id]})),401);update(actor.id,{siteIds:[a.id,b.id]});cookie=await login('limited');
  const lockRace=async(path,method,data,change)=>{store.db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(path,method,data,cookie);assert.match(String((await started)[0]),/WRITE_START/);change();store.db.exec('COMMIT');locked=false;return (await pending).status};
  assert.equal(await lockRace(save,'PUT',await payload(),()=>store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(b.id,wa.id)),403);store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(a.id,wa.id);
  assert.equal(await lockRace(save,'PUT',await payload(),()=>store.db.prepare('UPDATE attendance SET company_snapshot=? WHERE worker_id=?').run('가상 최신',wa.id)),409);
  assert.equal(await lockRace(save,'PUT',await payload(),()=>store.db.prepare('UPDATE admin_accounts SET name=? WHERE id=?').run('가상 타인 잠금 변경',other.id)),200);
  assert.equal(await lockRace(qrPath+'/access/registration','POST',{},()=>store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id)),401);assert.equal(store.siteRegistrationOpen(a.id),false);cookie=await login('limited');
  assert.equal(await lockRace(save,'PUT',await payload(),()=>store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id)),401);cookie=await login('limited');
  for(const [path,method,data] of [[save,'PUT',await payload()],[qrPath+'/access/registration','POST',{}],[qrPath+'/invitation','DELETE',undefined]]){
   assert.equal(await lockRace(path,method,data,()=>store.db.prepare('DELETE FROM admin_site_assignments WHERE admin_id=? AND site_id=?').run(actor.id,a.id)),403);
   store.db.prepare('INSERT INTO admin_site_assignments(admin_id,site_id) VALUES(?,?)').run(actor.id,a.id);
  }
  for(const suffix of ['access/rotate','invitation'])for(const change of ['assignment','expiry','context']){
   const key=store.siteAccessKey(a.id),count=store.db.prepare('SELECT COUNT(*) AS n FROM invitations').get().n;writeFileSync(gate,'pause');const started=once(child.stdout,'data'),pending=send(qrPath+'/'+suffix,'POST',{},cookie);assert.match(String((await started)[0]),/QR_START/);
   if(change==='assignment')update(actor.id,{siteIds:[b.id]});else if(change==='expiry')writeFileSync(expired,'expired');else store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id);
   child.stdin.write('go\n');assert.equal((await pending).status,401);unlinkSync(gate);if(change==='expiry')unlinkSync(expired);if(change==='assignment')update(actor.id,{siteIds:[a.id,b.id]});cookie=await login('limited');assert.equal(store.siteAccessKey(a.id),key);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM invitations').get().n,count);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE pending=1').get().n,0);
  }
  assert.equal((await send(save,'PUT',await payload(),cookie,{'X-Admin-Context':'stale'})).status,409);
 }finally{if(locked)store.db.exec('ROLLBACK');store.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}rmSync(dir,{recursive:true,force:true})}
});
