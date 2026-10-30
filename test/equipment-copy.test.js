import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('장비 복사는 현장과 원본 변경을 확인하며 첨부를 독립 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-equipment-copy-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),source=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'모델 A',capacity:'1',manufacturer:'가상 제조사',registration:'가상 번호',owner:'가상 소유주'}),file=s.addEquipmentAttachment(site.id,source.id,'lease','가상.txt',Buffer.from('자료 A')),plan=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[source.id]}});s.addEquipmentCheck(plan.id,{equipmentId:source.id,date:'2026-10-30',items:[{name:'가상 점검',result:'적정'}]});
    const snap=s.equipmentCopySource(site.id,source.id),input={version:snap.version,kind:'가상 장비',model:'모델 B',registration:'새 번호'};assert.equal(snap.attachmentCount,1);assert.throws(()=>s.equipmentCopySource(other.id,source.id),/현장/);assert.throws(()=>s.copyEquipment(other.id,source.id,input),/현장/);assert.throws(()=>s.copyEquipment(site.id,source.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);
    s.db.prepare('UPDATE equipment_attachments SET data=? WHERE id=?').run(Buffer.from('자료 B'),file);assert.throws(()=>s.copyEquipment(site.id,source.id,input),/변경/);assert.equal(s.equipment(site.id).length,1);
    const current=s.equipmentCopySource(site.id,source.id);s.db.exec(`CREATE TRIGGER fail_equipment_copy BEFORE INSERT ON equipment_attachments WHEN NEW.equipment_id<>${source.id} BEGIN SELECT RAISE(ABORT,'가상 첨부 실패'); END`);assert.throws(()=>s.copyEquipment(site.id,source.id,{...input,version:current.version}),/가상 첨부 실패/);assert.equal(s.equipment(site.id).length,1);s.db.exec('DROP TRIGGER fail_equipment_copy');
    const copied=s.copyEquipment(site.id,source.id,{...input,version:current.version});assert.notEqual(copied.id,source.id);assert.equal(copied.model,'모델 B');assert.equal(copied.registration,'새 번호');assert.equal(JSON.parse(copied.details).owner,'가상 소유주');const copyFile=s.equipmentAttachments(site.id,copied.id)[0];assert.equal(Buffer.from(s.equipmentAttachment(site.id,copied.id,copyFile.id).data).toString(),'자료 B');assert.deepEqual(JSON.parse(s.document(plan.id).details).equipmentIds,[source.id]);assert.equal(s.equipmentChecks(plan.id).length,1);
    s.deleteEquipmentAttachment(site.id,source.id,file);assert.equal(s.equipmentAttachments(site.id,copied.id).length,1);s.close();s=new Store(path);assert.equal(s.equipment(site.id).length,2);assert.equal(Buffer.from(s.equipmentAttachment(site.id,copied.id,copyFile.id).data).toString(),'자료 B');
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('장비 복사 API는 관리자 인증과 원본 변경 검사를 적용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-equipment-copy-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),source=await (await call('/api/equipment','POST',{siteId:site.id,kind:'가상 장비',model:'모델 A',capacity:'',manufacturer:'',registration:'가상 번호'},admin)).json(),path=`/api/equipment/${source.id}/copy`;
    assert.equal((await call(`${path}?siteId=${site.id}`)).status,401);assert.equal((await call(`${path}?siteId=${other.id}`,'GET',null,admin)).status,400);const snapshot=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),input={siteId:site.id,version:snapshot.version,kind:source.kind,model:'모델 B',registration:'새 번호'};assert.equal((await call(path,'POST',input)).status,401);
    assert.equal((await call(`/api/equipment/${source.id}`,'PUT',{siteId:site.id,kind:'가상 장비',model:'변경 모델',capacity:'',manufacturer:'',registration:'가상 번호'},admin)).status,200);assert.equal((await call(path,'POST',input,admin)).status,409);const updated=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),response=await call(path,'POST',{...input,version:updated.version},admin);assert.equal(response.status,201);assert.equal((await response.json()).model,'모델 B');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
