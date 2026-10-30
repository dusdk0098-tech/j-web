import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('장구 복사는 같은 현장의 정보와 사진을 원자적으로 독립 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-rigging-copy-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),source=s.createRigging({siteId:site.id,category:'줄걸이',kind:'가상 종류',name:'가상 장구',standards:['규격 A'],additional:[{label:'항목',value:'값'}],spec:'가상 제원'}),photo=s.addRiggingPhoto(site.id,source.id,'가상.jpg',Buffer.from('ffd8ff0000','hex')),plan=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{riggingIds:[source.id]}}),snapshot=s.riggingCopySource(site.id,source.id),input={version:snapshot.version,kind:'복사 종류',name:'복사 장구'};
    assert.equal(snapshot.photoCount,1);assert.throws(()=>s.riggingCopySource(other.id,source.id),/현장/);assert.throws(()=>s.copyRigging(other.id,source.id,input),/현장/);assert.throws(()=>s.copyRigging(site.id,source.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);
    s.db.prepare('UPDATE rigging_photos SET data=? WHERE id=?').run(Buffer.from('ffd8ff0001','hex'),photo);assert.throws(()=>s.copyRigging(site.id,source.id,input),/변경/);assert.equal(s.rigging(site.id).length,1);
    const latest=s.riggingCopySource(site.id,source.id);s.db.exec(`CREATE TRIGGER fail_rigging_copy BEFORE INSERT ON rigging_photos WHEN NEW.rigging_id<>${source.id} BEGIN SELECT RAISE(ABORT,'가상 사진 실패'); END`);assert.throws(()=>s.copyRigging(site.id,source.id,{...input,version:latest.version}),/가상 사진 실패/);assert.equal(s.rigging(site.id).length,1);s.db.exec('DROP TRIGGER fail_rigging_copy');
    const copied=s.copyRigging(site.id,source.id,{...input,version:latest.version}),copyPhoto=s.riggingPhotos(site.id,copied.id)[0];assert.notEqual(copied.id,source.id);assert.equal(copied.name,'복사 장구');assert.deepEqual(JSON.parse(copied.details),JSON.parse(source.details));assert.deepEqual(Buffer.from(s.riggingPhoto(site.id,copied.id,copyPhoto.id).data),Buffer.from('ffd8ff0001','hex'));assert.deepEqual(JSON.parse(s.document(plan.id).details).riggingIds,[source.id]);
    s.deleteRiggingPhoto(site.id,source.id,photo);s.close();s=new Store(path);assert.equal(s.rigging(site.id).length,2);assert.deepEqual(Buffer.from(s.riggingPhoto(site.id,copied.id,copyPhoto.id).data),Buffer.from('ffd8ff0001','hex'));
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('장구 복사 API는 인증과 현장 및 원본 변경을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-rigging-copy-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),source=await (await call('/api/rigging','POST',{siteId:site.id,category:'줄걸이',kind:'가상 종류',name:'가상 장구'},admin)).json(),path=`/api/rigging/${source.id}/copy`;
    assert.equal((await call(`${path}?siteId=${site.id}`)).status,401);assert.equal((await call(`${path}?siteId=${other.id}`,'GET',null,admin)).status,400);const snapshot=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),input={siteId:site.id,version:snapshot.version,kind:source.kind,name:'복사 장구'};assert.equal((await call(path,'POST',input)).status,401);
    assert.equal((await call(`/api/rigging/${source.id}`,'PUT',{siteId:site.id,category:'줄걸이',kind:'변경 종류',name:source.name},admin)).status,200);assert.equal((await call(path,'POST',input,admin)).status,409);const updated=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),response=await call(path,'POST',{...input,version:updated.version},admin);assert.equal(response.status,201);assert.equal((await response.json()).name,'복사 장구');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
