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

test('장비 점검 저장·삭제는 권한 확인에 실패하면 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),equipment=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''}),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}}),input={equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 점검',result:'적정'}]};
    assert.throws(()=>s.addEquipmentCheck(doc.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.equipmentChecks(doc.id).length,0);
    const id=s.addEquipmentCheck(doc.id,input);assert.throws(()=>s.deleteEquipmentCheck(doc.id,id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.equipmentChecks(doc.id).length,1);
  }finally{s.close();}
});

test('점검 저장 대기 중 계획서에서 장비가 빠지면 점검을 저장하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-equipment-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.addEquipmentCheck;Store.prototype.addEquipmentCheck=function(...args){const db=this.db,exec=db.exec,prepare=db.prepare;let signaled=false;const signal=()=>{if(!signaled){signaled=true;process.stdout.write('CHECK_SAVE\\n')}};db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')signal();return exec.call(this,sql)};db.prepare=function(sql){if(sql.startsWith('INSERT INTO equipment_checks'))signal();return prepare.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec;db.prepare=prepare}};`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),equipment=await (await send('/api/equipment','POST',{siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''},admin)).json(),doc=await (await send('/api/documents','POST',{siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}},admin)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(`/api/documents/${doc.id}/equipment-checks`,'POST',{equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 점검',result:'적정'}]},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/CHECK_SAVE/);db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({equipmentIds:[]}),doc.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM equipment_checks WHERE document_id=?').get(doc.id).n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
