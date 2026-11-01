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

test('제한 관리자 월 셀: 전체 행 검증·버전·원자 롤백·본문/잠금/응답 권한 경합',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-month-cells-')),store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db),password='virtual-month-cells-password';auth.bootstrap(password);
 const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),c=store.createSite({name:'가상 C'}),fields={name:'가상',category:'직영',company:'가상 소속',occupation:'목공'},wa=store.createWorker({...fields,siteId:a.id}),wa2=store.createWorker({...fields,siteId:a.id}),wb=store.createWorker({...fields,siteId:b.id});
 const actor=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[a.id,b.id]}),other=auth.create({loginId:'other',name:'가상 타인',password,scope:'restricted',siteIds:[a.id]});
 const date='2026-11-02',month='2026-11',entry={siteId:a.id,workerId:wa.id,date};store.setAttendance({...entry,present:true});store.setAttendanceDailyRate({...entry,dailyRate:'12345'});store.setAttendanceUnits({...entry,units:'1.25'});
 store.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,profile) VALUES(?,?,?)').run(wa.id,'virtual',JSON.stringify({birthDate:'1990-01-01',phone:'010-0000-0000'}));store.db.prepare('INSERT INTO wage_records(site_id,worker_id,month,gross,deductions) VALUES(?,?,?,?,?)').run(a.id,wa.id,month,55555,'{}');
 const protectedSnapshot=()=>JSON.stringify([store.db.prepare('SELECT * FROM join_acknowledgements').all(),store.db.prepare('SELECT * FROM wage_records').all()]),protectedBefore=protectedSnapshot();
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const expired=join(dir,'expired'),responseGate=join(dir,'response'),url=file=>pathToFileURL(join(process.cwd(),file)).href;
 const hook=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(url('store.js'))};import {AdminAccounts} from ${JSON.stringify(url('admin-accounts.js'))};const valid=AdminAccounts.prototype.valid;AdminAccounts.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(expired)})?9*60*60*1000:0))};const update=Store.prototype.updateMonthlyAttendanceCells;Store.prototype.updateMonthlyAttendanceCells=function(...args){process.stdout.write('WRITE_START\\n');return update.apply(this,args)};const read=Store.prototype.monthlyAttendance;Store.prototype.monthlyAttendance=function(...args){const rows=read.apply(this,args);if(existsSync(${JSON.stringify(responseGate)}))this.db.prepare('DELETE FROM admin_site_assignments WHERE admin_id=? AND site_id=?').run(${actor.id},${a.id});return rows};`;
 const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(hook)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패')})]);
  const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async id=>(await send('/api/login','POST',{loginId:id,password})).headers.get('set-cookie').split(';')[0];
  let cookie=await login('limited');const global=await login('admin'),path='/api/attendance/month/cells',readPath=`/api/attendance/month?siteId=${a.id}&month=${month}`;
  const read=async()=>{const r=await send(readPath,'GET',undefined,cookie);assert.equal(r.status,200);return r.json()},snapshot=()=>JSON.stringify(store.db.prepare('SELECT * FROM attendance ORDER BY worker_id,date').all()),restore=()=>store.db.prepare('INSERT OR IGNORE INTO admin_site_assignments(admin_id,site_id) VALUES(?,?)').run(actor.id,a.id);
  const payload=async()=>{const rows=await read();return {siteId:a.id,month,changes:[{workerId:wa.id,date,present:true,units:'2.25'},{workerId:wa.id,date:'2026-11-03',present:true,units:'0'},{workerId:wa2.id,date:'2026-11-04',present:true,units:''}].map(row=>({...row,expectedVersion:rows.find(w=>w.id===row.workerId).version,expectedDayVersion:rows.find(w=>w.id===row.workerId).dayVersions[row.date]??0}))}};
  const initial=await read();for(const worker of initial)for(const key of ['phone','birth_date','daily_rate','salary_amount','estimated_pay']){assert.equal(Object.hasOwn(worker,key),false);for(const unit of worker.units)assert.equal(Object.hasOwn(unit,key),false)}
  const first=await payload(),saved=await send(path,'PUT',first,cookie);assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{updated:3});assert.equal(store.db.prepare('SELECT units_hundredths FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).units_hundredths,225);assert.equal((await send(path,'PUT',first,cookie)).status,409);assert.equal(store.db.prepare('SELECT daily_rate FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).daily_rate,12345);
  store.setAttendanceSalary({siteId:a.id,workerId:wa2.id,date:'2026-11-04',kind:'monthly',amount:'98765'});
  const valid=await payload();
  for(const bad of [{siteId:c.id},{siteId:[a.id]},{month:['2026-11']},{month:'2026-13'},{salaryAmount:'2'},{workerIds:[wa.id,wb.id]},{changes:[]},{changes:{}},{changes:Array(1001).fill(valid.changes[0])},{changes:[valid.changes[0],valid.changes[0]]}]){const before=snapshot();assert.equal((await send(path,'PUT',{...valid,...bad},cookie)).status,403);assert.equal(snapshot(),before)}
  for(const extra of [{workerId:wb.id},{workerId:999999},{workerId:[wa.id]},{siteId:b.id},{date:'2026-11-31'},{date:'2026-12-01'},{date:['2026-11-03']},{expectedVersion:undefined},{expectedDayVersion:undefined},{expectedDayVersion:-1},{present:'true'},{units:'10'},{units:1},{units:'1e0'},{present:false,units:'1'},{dailyRate:'9'},{salaryKind:'monthly',salaryAmount:'9'},{phone:'secret'},{days:[date]}]){const before=snapshot();assert.equal((await send(path,'PUT',{...valid,changes:[valid.changes[0],{...valid.changes[1],...extra}]},cookie)).status,403,JSON.stringify(extra));assert.equal(snapshot(),before)}
  for(const requestPath of [path+'/',path+'/bulk',path+'?siteId='+b.id,path+'?siteId='+a.id+'&siteId='+a.id,path+'?workerId='+wa.id])assert.equal((await send(requestPath,'PUT',valid,cookie)).status,403);
  for(const method of ['GET','POST','PATCH','DELETE'])assert.equal((await send(path,method,method==='GET'?undefined:valid,cookie)).status,403);
  const beforeDay=snapshot();assert.equal((await send(path,'PUT',{...valid,changes:[valid.changes[0],{...valid.changes[1],expectedDayVersion:999}]},cookie)).status,409);assert.equal(snapshot(),beforeDay);
  const cancel=await payload();cancel.changes=[{...cancel.changes[0],present:false}];delete cancel.changes[0].units;assert.equal((await send(path,'PUT',cancel,cookie)).status,200);assert.equal(store.db.prepare('SELECT daily_rate FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).daily_rate,12345);
  assert.equal((await send(path,'PUT',await payload(),global)).status,200);
  store.db.exec(`CREATE TRIGGER cells_fail BEFORE UPDATE ON attendance WHEN NEW.worker_id=${wa2.id} BEGIN SELECT RAISE(ABORT,'가상 실패'); END;`);const beforeFailure=snapshot();assert.equal((await send(path,'PUT',await payload(),cookie)).status,400);assert.equal(snapshot(),beforeFailure);store.db.exec('DROP TRIGGER cells_fail');
  store.db.exec(`CREATE TRIGGER cells_revoke AFTER UPDATE ON attendance WHEN NEW.worker_id=${wa2.id} BEGIN DELETE FROM admin_site_assignments WHERE admin_id=${actor.id} AND site_id=${a.id}; END;`);const beforeRevoke=snapshot();assert.equal((await send(path,'PUT',await payload(),cookie)).status,403);assert.equal(snapshot(),beforeRevoke);assert.ok(store.db.prepare('SELECT 1 FROM admin_site_assignments WHERE admin_id=? AND site_id=?').get(actor.id,a.id));store.db.exec('DROP TRIGGER cells_revoke');
  const delayed=async(data,change)=>{const req=http.request(base+path,{method:'PUT',headers:{cookie,'content-type':'application/json'}}),answer=new Promise((r,j)=>{req.on('response',res=>{res.resume();r(res.statusCode)});req.on('error',j)});req.write('{');await new Promise(r=>setTimeout(r,70));change();req.end(JSON.stringify(data).slice(1));return answer};
  const update=(id,values)=>auth.update(id,{version:auth.list().find(x=>x.id===id).version,...values});
  for(const [change,status,reset] of [
   [()=>update(actor.id,{siteIds:[b.id]}),401,()=>update(actor.id,{siteIds:[a.id,b.id]})],
   [()=>store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id),401,()=>{}],
   [()=>store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(b.id,wa2.id),403,()=>store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(a.id,wa2.id)],
   [()=>writeFileSync(expired,'expired'),401,()=>unlinkSync(expired)]
  ]){const data=await payload(),before=snapshot();assert.equal(await delayed(data,change),status);assert.equal(snapshot(),before);reset();cookie=await login('limited')}
  assert.equal(await delayed(await payload(),()=>update(other.id,{name:'가상 타인 변경'})),200);
  const lockRace=async(data,change)=>{store.db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(path,'PUT',data,cookie);assert.match(String((await started)[0]),/WRITE_START/);change();store.db.exec('COMMIT');locked=false;return (await pending).status};
  for(const [change,status,reset] of [
   [()=>store.db.prepare('DELETE FROM admin_site_assignments WHERE admin_id=? AND site_id=?').run(actor.id,a.id),403,restore],
   [()=>store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id),401,()=>{}],
   [()=>store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(b.id,wa2.id),403,()=>store.db.prepare('UPDATE workers SET site_id=? WHERE id=?').run(a.id,wa2.id)],
   [()=>writeFileSync(expired,'expired'),401,()=>unlinkSync(expired)]
  ]){const data=await payload(),before=snapshot();assert.equal(await lockRace(data,change),status);assert.equal(snapshot(),before);reset();cookie=await login('limited')}
  for(const sql of ['UPDATE attendance SET company_snapshot=\'가상 최신\' WHERE worker_id=? AND date=?','UPDATE attendance SET units_hundredths=321 WHERE worker_id=? AND date=?','UPDATE attendance SET daily_rate=23456 WHERE worker_id=? AND date=?']){const data=await payload();let changed;assert.equal(await lockRace(data,()=>{store.db.prepare(sql).run(wa2.id,'2026-11-04');changed=snapshot()}),409);assert.equal(snapshot(),changed)}
  assert.equal(await lockRace(await payload(),()=>store.db.prepare('UPDATE admin_accounts SET name=? WHERE id=?').run('가상 타인 잠금',other.id)),200);
  const preserved=await payload();preserved.changes=[{...preserved.changes[0]}];delete preserved.changes[0].units;const priorUnits=store.db.prepare('SELECT units_hundredths FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).units_hundredths;assert.equal((await send(path,'PUT',preserved,cookie)).status,200);assert.equal(store.db.prepare('SELECT units_hundredths FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).units_hundredths,priorUnits);assert.equal(protectedSnapshot(),protectedBefore);assert.deepEqual({...store.db.prepare('SELECT salary_kind,salary_amount FROM attendance WHERE worker_id=? AND date=?').get(wa2.id,'2026-11-04')},{salary_kind:'monthly',salary_amount:98765});
  writeFileSync(responseGate,'revoke');const response=await send(readPath,'GET',undefined,cookie);assert.equal(response.status,403);assert.deepEqual(Object.keys(await response.json()),['error']);unlinkSync(responseGate);restore();
  assert.equal((await send('/api/attendance','POST',{...entry,present:true,expectedDayVersion:store.db.prepare('SELECT day_version FROM attendance WHERE worker_id=? AND date=?').get(wa.id,date).day_version},cookie)).status,200);
 }finally{if(locked)store.db.exec('ROLLBACK');store.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}rmSync(dir,{recursive:true,force:true})}
});
