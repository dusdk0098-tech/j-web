import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import http from 'node:http';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
const password='virtual-equipment-scope-password';
test('제한 관리자 장비 출역: 현장·개인정보·입력·충돌·잠금 중 철회',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-equipment-scope-')),store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db);auth.bootstrap(password);
 const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),c=store.createSite({name:'가상 C'}),equipment={kind:'가상 장비',model:'가상 모델',capacity:'가상 용량',manufacturer:'가상 제조',registration:'가상 번호',owner:'비공개 소유주'};
 const ea=store.createEquipment({...equipment,siteId:a.id}),eb=store.createEquipment({...equipment,siteId:b.id}),ec=store.createEquipment({...equipment,siteId:c.id}),actor=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[a.id,b.id]}),other=auth.create({loginId:'other',name:'가상 타인',password,scope:'restricted',siteIds:[a.id]});
 const input={siteId:a.id,equipmentId:ea.id,date:'2026-11-02',driverName:'가상 운전원',note:'가상 비고'},seed=store.saveEquipmentAttendance({...input,driverBirth:'2000-01-01',driverPhone:'010-1111-2222'}),foreign=store.saveEquipmentAttendance({...input,siteId:b.id,equipmentId:eb.id,driverBirth:'',driverPhone:''});
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const hook=`import {IncomingMessage} from 'node:http';const iterate=IncomingMessage.prototype[Symbol.asyncIterator];IncomingMessage.prototype[Symbol.asyncIterator]=async function*(){let first=true;for await(const chunk of iterate.call(this)){if(first&&this.headers['x-test-delayed-body']==='1'){process.send({event:'BODY_STARTED',authorized:this.adminProtected===true&&!this.checkSession(),chunk:chunk.toString()});first=false;}yield chunk;}};import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};for(const name of ['saveEquipmentAttendance','deleteEquipmentAttendance']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('WRITE_START\\n');return original.apply(this,args)}}`;
 const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(hook)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['ignore','pipe','pipe','ipc']});let locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패')})]);
  const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async id=>(await send('/api/login','POST',{loginId:id,password})).headers.get('set-cookie').split(';')[0];
  let cookie=await login('limited');const global=await login('admin'),path='/api/equipment-attendance',list=path+`?siteId=${a.id}&month=2026-11`,item=path+'/'+seed.id;
  const raw=()=>store.db.prepare('SELECT * FROM equipment_attendance WHERE id=?').get(seed.id),edit=()=>({siteId:a.id,date:input.date,driverName:'가상 수정',note:'가상 수정 비고',expectedVersion:raw().version});
  assert.equal((await send(list)).status,401);
  let r=await send(list,'GET',undefined,cookie);assert.equal(r.status,200);const rows=await r.json();assert.deepEqual(Object.keys(rows[0]).sort(),['id','site_id','equipment_id','date','driver_name','note','version','equipment_snapshot'].sort());assert.deepEqual(Object.keys(rows[0].equipment_snapshot).sort(),['id','kind','model','registration'].sort());assert.equal(JSON.stringify(rows).includes('비공개 소유주'),false);assert.equal(JSON.stringify(rows).includes('010-1111-2222'),false);
  r=await send('/api/equipment?siteId='+a.id,'GET',undefined,cookie);assert.equal(r.status,200);assert.deepEqual(Object.keys((await r.json())[0]).sort(),['id','kind','model','registration'].sort());
  const globalRows=await (await send(list,'GET',undefined,global)).json();assert.equal(globalRows[0].driver_birth,'2000-01-01');assert.match(globalRows[0].equipment_snapshot.details,/비공개 소유주/);
  for(const p of [list+'&siteId='+a.id,list+'&month=2026-12',list+'&equipmentId='+ea.id,path+`?siteId=${c.id}&month=2026-11`,'/api/equipment?siteId='+a.id+'&siteId='+a.id,'/api/equipment?siteId='+a.id+'&details=true','/api/equipment/'+ea.id+'/copy?siteId='+a.id])assert.equal((await send(p,'GET',undefined,cookie)).status,403,p);
  for(const extra of [{siteId:c.id},{siteId:[a.id]},{equipmentId:eb.id},{equipmentId:ec.id},{equipmentId:[ea.id]},{equipmentIds:[ea.id]},{driverBirth:''},{driverPhone:''},{owner:'유출'},{equipment_snapshot:{}},{date:'2026-02-30'},{date:['2026-11-02']},{driverName:[]},{note:'\u0000'}])assert.equal((await send(path,'POST',{...input,...extra},cookie)).status,403,JSON.stringify(extra));
  assert.equal((await send(path+'?siteId='+b.id,'POST',input,cookie)).status,403);
  assert.equal((await send(path+'/'+foreign.id,'PUT',edit(),cookie)).status,403);
  for(const extra of [{equipmentId:ea.id},{driverBirth:''},{driverPhone:''},{expectedVersion:undefined},{expectedVersion:[]},{siteId:b.id}])assert.equal((await send(item,'PUT',{...edit(),...extra},cookie)).status,403);
  const before=raw(),first=edit();assert.equal((await send(item,'PUT',first,cookie)).status,200);assert.equal(raw().driver_birth,before.driver_birth);assert.equal(raw().driver_phone,before.driver_phone);assert.equal(raw().equipment_snapshot,before.equipment_snapshot);assert.equal(raw().note,'가상 수정 비고');assert.equal((await send(item,'PUT',first,cookie)).status,409);assert.equal((await send(item,'DELETE',{siteId:a.id,expectedVersion:first.expectedVersion},cookie)).status,409);
  r=await send(path,'POST',input,cookie);assert.equal(r.status,201);const made=await r.json();assert.equal(store.db.prepare('SELECT driver_birth FROM equipment_attendance WHERE id=?').get(made.id).driver_birth,'');assert.equal((await send(path+'/'+made.id,'DELETE',{siteId:a.id,expectedVersion:made.version},cookie)).status,200);
  const lockRace=async(p,method,data,change)=>{store.db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(p,method,data,cookie);assert.match(String((await started)[0]),/WRITE_START/);change();store.db.exec('COMMIT');locked=false;return (await pending).status};
  for(const [p,method,data] of [[path,'POST',input],[item,'PUT',edit()],[item,'DELETE',{siteId:a.id,expectedVersion:raw().version}]]){
   const count=store.equipmentAttendance(a.id,'2026-11').length,snapshot=raw();assert.equal(await lockRace(p,method,data,()=>store.db.prepare('DELETE FROM admin_site_assignments WHERE admin_id=? AND site_id=?').run(actor.id,a.id)),403);assert.equal(store.equipmentAttendance(a.id,'2026-11').length,count);assert.deepEqual(raw(),snapshot);store.db.prepare('INSERT INTO admin_site_assignments(admin_id,site_id) VALUES(?,?)').run(actor.id,a.id);
  }
  assert.equal(await lockRace(path,'POST',input,()=>store.db.prepare('UPDATE equipment SET site_id=? WHERE id=?').run(b.id,ea.id)),403);store.db.prepare('UPDATE equipment SET site_id=? WHERE id=?').run(a.id,ea.id);
  assert.equal(await lockRace(item,'PUT',edit(),()=>store.db.prepare('UPDATE equipment_attendance SET site_id=? WHERE id=?').run(b.id,seed.id)),403);store.db.prepare('UPDATE equipment_attendance SET site_id=? WHERE id=?').run(a.id,seed.id);
  for(const method of ['PUT','DELETE'])assert.equal(await lockRace(item,method,method==='PUT'?edit():{siteId:a.id,expectedVersion:raw().version},()=>store.db.prepare('UPDATE equipment_attendance SET version=version+1 WHERE id=?').run(seed.id)),409);
  assert.equal(await lockRace(item,'PUT',edit(),()=>store.db.prepare('UPDATE admin_accounts SET name=? WHERE id=?').run('가상 타인 수정',other.id)),200);
  assert.equal(await lockRace(path,'POST',input,()=>store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(actor.id)),401);cookie=await login('limited');
  const bodyStarted=once(child,'message'),count=store.equipmentAttendance(a.id,'2026-11').length,req=http.request(base+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-test-delayed-body':'1'}}),answer=new Promise((r,j)=>{req.on('response',res=>{res.resume();r(res.statusCode)});req.on('error',j)});req.write('{');assert.deepEqual((await bodyStarted)[0],{event:'BODY_STARTED',authorized:true,chunk:'{'});auth.update(actor.id,{version:auth.list().find(x=>x.id===actor.id).version,siteIds:[b.id]});req.end(JSON.stringify(input).slice(1));assert.equal(await answer,401);assert.equal(store.equipmentAttendance(a.id,'2026-11').length,count);
 }finally{if(locked)store.db.exec('ROLLBACK');store.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true})}
});
