import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
const measure={accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 대책'};
const equipment=siteId=>({siteId,kind:'가상 장비',model:'가상 형식',capacity:'',manufacturer:'',registration:''});

test('장비·현장 격리, 목록 버전, 저장 사본과 문서 버전 충돌, 오류 롤백 및 재시작',()=>{
 const dir=mkdtempSync(join(tmpdir(),'permit-measures-db-')),file=join(dir,'db.sqlite');let s=new Store(file);
 try{
  const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),e=s.createEquipment(equipment(a.id)),other=s.createEquipment(equipment(a.id)),foreign=s.createEquipment(equipment(b.id));
  const row=s.savePermitMeasure(a.id,e.id,null,measure),source={id:row.id,equipmentId:e.id,version:row.version},input={siteId:a.id,type:'permit',title:'가상 문서',date:'2026-11-01',details:{safetyMeasures:[measure]},permitMeasureSources:[source]};
  assert.equal(s.permitMeasures(a.id,e.id).length,1);assert.deepEqual(s.permitMeasures(a.id,other.id),[]);assert.throws(()=>s.permitMeasures(b.id,e.id));assert.throws(()=>s.savePermitMeasure(b.id,e.id,null,measure));assert.throws(()=>s.savePermitMeasure(a.id,other.id,row.id,{...measure,expectedVersion:row.version}));
  const doc=s.createAuthorizedDocument(input);s.updateDocument(doc.id,{...input,expectedEditVersion:doc.edit_version,title:'가상 수정'});assert.throws(()=>s.updateDocument(doc.id,{...input,expectedEditVersion:doc.edit_version}),e=>e.sessionStatus===409);
  const updated=s.savePermitMeasure(a.id,e.id,row.id,{...measure,measure:'새 가상 대책',expectedVersion:row.version});assert.notEqual(updated.version,row.version);assert.throws(()=>s.createAuthorizedDocument(input),e=>e.sessionStatus===409);assert.throws(()=>s.savePermitMeasure(a.id,e.id,row.id,{expectedVersion:row.version},true),e=>e.sessionStatus===409);
  assert.deepEqual(JSON.parse(s.document(doc.id).details).safetyMeasures,[measure]);assert.throws(()=>s.createAuthorizedDocument({...input,permitMeasureSources:[{...source,equipmentId:foreign.id}]}));
  for(const invalid of [{...measure,measure:''},{...measure,hazard:'x'.repeat(2001)},{...measure,measure:42}])assert.throws(()=>s.savePermitMeasure(a.id,e.id,null,invalid));
  const before=s.permitMeasures(a.id,e.id);assert.throws(()=>s.savePermitMeasure(a.id,e.id,null,measure,false,()=>{throw Error('만료');}),/만료/);assert.deepEqual(s.permitMeasures(a.id,e.id),before);
  s.db.exec("CREATE TRIGGER fail_measure BEFORE UPDATE ON permit_equipment_measures BEGIN SELECT RAISE(ABORT,'가상 실패'); END");assert.throws(()=>s.savePermitMeasure(a.id,e.id,row.id,{...measure,expectedVersion:updated.version}),/가상 실패/);assert.deepEqual(s.permitMeasures(a.id,e.id),before);s.db.exec('DROP TRIGGER fail_measure');
  s.close();s=new Store(file);assert.deepEqual(s.permitMeasures(a.id,e.id),before);s.savePermitMeasure(a.id,e.id,row.id,{expectedVersion:updated.version},true);assert.deepEqual(s.permitMeasures(a.id,e.id),[]);assert.deepEqual(JSON.parse(s.document(doc.id).details).safetyMeasures,[measure]);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('실제 HTTP CRUD·미인증 차단과 DB 잠금 대기 중 관리자 만료는 등록·수정·삭제를 모두 롤백한다',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'permit-measures-api-')),flag=join(dir,'expired'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const trace=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};import {AdminAccounts} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'admin-accounts.js')).href)};const valid=AdminAccounts.prototype.valid;AdminAccounts.prototype.valid=function(...args){return existsSync(${JSON.stringify(flag)})?false:valid.apply(this,args)};const original=Store.prototype.savePermitMeasure;Store.prototype.savePermitMeasure=function(...args){process.stdout.write('MEASURE_STARTED\\n');return original.apply(this,args)};`;
 const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),e=await (await send('/api/equipment','POST',equipment(site.id),admin)).json(),path=`/api/equipment/${e.id}/permit-measures`,url=path+`?siteId=${site.id}`;
  for(const method of ['GET','POST'])assert.equal((await send(url,method,method==='POST'?measure:undefined)).status,401);
  let response=await send(url,'POST',measure,admin);assert.equal(response.status,201);let row=await response.json();assert.equal((await send(path+`/${row.id}?siteId=${site.id}`,'PUT',{...measure,expectedVersion:'stale'},admin)).status,409);
  response=await send(path+`/${row.id}?siteId=${site.id}`,'PUT',{...measure,measure:'수정 대책',expectedVersion:row.version},admin);assert.equal(response.status,200);row=await response.json();
  const otherSite=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json();assert.equal((await send(path+'?siteId='+otherSite.id,'GET',undefined,admin)).status,400);
  const input={siteId:site.id,type:'permit',title:'가상 적용 문서',date:'2026-11-01',details:{safetyMeasures:[measure]},permitMeasureSources:[{id:row.id,equipmentId:e.id,version:row.version}]};
  const created=await send('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json();
  assert.equal((await send('/api/documents/'+doc.id,'PUT',{...input,expectedEditVersion:doc.edit_version,title:'가상 수정'},admin)).status,200);
  assert.equal((await send('/api/documents/'+doc.id,'PUT',{...input,expectedEditVersion:doc.edit_version},admin)).status,409);
  const stale={...input,permitMeasureSources:[{...input.permitMeasureSources[0],version:'stale'}]};assert.equal((await send('/api/documents','POST',stale,admin)).status,409);
  assert.deepEqual(JSON.parse((await (await send('/api/documents/'+doc.id,'GET',undefined,admin)).json()).details).safetyMeasures,[measure]);
  db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
  for(const method of ['POST','PUT','DELETE']){
   const before=db.prepare('SELECT * FROM permit_equipment_measures').all();db.exec('BEGIN IMMEDIATE');locked=true;
   const started=once(child.stdout,'data'),pending=send(method==='POST'?url:path+`/${row.id}?siteId=${site.id}`,method,{...measure,expectedVersion:row.version},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/MEASURE_STARTED/);writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);unlinkSync(flag);assert.deepEqual(db.prepare('SELECT * FROM permit_equipment_measures').all(),before);
  }
  assert.equal((await send(path+`/${row.id}?siteId=${site.id}`,'DELETE',{expectedVersion:row.version},admin)).status,200);assert.deepEqual(await (await send(url,'GET',undefined,admin)).json(),[]);assert.equal((await send('/permit-measures.js')).status,200);
 }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
