import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'가상 보강',obstacles:'',protection:'',reinforcementChoices:['철판설치'],groundExtra:'가상 지반'},input=siteId=>({siteId,name:'가상 장소',work:area,route:{...area,terrain:'경사지'},additional:[{label:'가상 항목',value:'가상 값'}]}),expected=place=>({name:place.name,details:place.details});

test('작업장소 수정은 사진을 유지하고 변경 충돌과 연결된 계획서를 검사한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-place-edit-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),place=s.createWorkPlace(input(site.id)),photo=s.addWorkPlacePhoto(site.id,place.id,'가상.jpg',Buffer.from('ffd8ff0000','hex')),update={...input(site.id),name:'수정된 장소',expected:expected(place)};
    assert.throws(()=>s.createWorkPlace({...update,siteId:other.id},place.id),/현장/);assert.throws(()=>s.createWorkPlace(update,place.id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.throws(()=>s.createWorkPlace({...update,work:{...area,ground:'잘못된 지반'}},place.id),/지형/);
    const changed=s.createWorkPlace(update,place.id);assert.equal(changed.name,'수정된 장소');assert.deepEqual(JSON.parse(changed.details).additional,[{label:'가상 항목',value:'가상 값'}]);assert.equal(JSON.parse(changed.details).route.terrain,'경사지');assert.equal(s.workPlacePhotos(site.id,place.id)[0].id,photo);assert.throws(()=>s.createWorkPlace(update,place.id),/변경/);
    s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{workPlaceId:place.id}});assert.throws(()=>s.createWorkPlace({...update,expected:expected(changed)},place.id),/계획서/);s.close();s=new Store(path);assert.equal(s.workPlaces(site.id)[0].name,'수정된 장소');assert.deepEqual(Buffer.from(s.workPlacePhoto(site.id,place.id,photo).data),Buffer.from('ffd8ff0000','hex'));
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('작업장소 수정 API는 관리자 인증과 변경 충돌을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-place-edit-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),place=await (await call('/api/work-places','POST',input(site.id),admin)).json(),path=`/api/work-places/${place.id}`,update={...input(site.id),name:'첫 수정',expected:expected(place)};
    assert.equal((await call(path,'PUT',update)).status,401);const response=await call(path,'PUT',update,admin);assert.equal(response.status,200);assert.equal((await response.json()).name,'첫 수정');assert.equal((await call(path,'PUT',update,admin)).status,409);assert.equal((await (await call(`/api/work-places?siteId=${site.id}`,'GET',null,admin)).json())[0].name,'첫 수정');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('작업장소 복사는 사진과 정보를 독립 보존하며 작업계획서 연결을 복사하지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-place-copy-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),place=s.createWorkPlace(input(site.id)),photo=s.addWorkPlacePhoto(site.id,place.id,'가상.jpg',Buffer.from('ffd8ff0000','hex')),plan=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{workPlaceId:place.id}}),snapshot=s.workPlaceCopySource(site.id,place.id),copyInput={version:snapshot.version,name:'복사 장소'};
    assert.equal(snapshot.photoCount,1);assert.throws(()=>s.workPlaceCopySource(other.id,place.id),/현장/);assert.throws(()=>s.copyWorkPlace(other.id,place.id,copyInput),/현장/);assert.throws(()=>s.copyWorkPlace(site.id,place.id,copyInput,()=>{throw Error('세션 만료');}),/세션 만료/);
    s.db.prepare('UPDATE work_place_photos SET data=? WHERE id=?').run(Buffer.from('ffd8ff0001','hex'),photo);assert.throws(()=>s.copyWorkPlace(site.id,place.id,copyInput),/변경/);assert.equal(s.workPlaces(site.id).length,1);
    const latest=s.workPlaceCopySource(site.id,place.id);s.db.exec(`CREATE TRIGGER fail_place_copy BEFORE INSERT ON work_place_photos WHEN NEW.place_id<>${place.id} BEGIN SELECT RAISE(ABORT,'가상 사진 실패'); END`);assert.throws(()=>s.copyWorkPlace(site.id,place.id,{...copyInput,version:latest.version}),/가상 사진 실패/);assert.equal(s.workPlaces(site.id).length,1);s.db.exec('DROP TRIGGER fail_place_copy');
    const copied=s.copyWorkPlace(site.id,place.id,{...copyInput,version:latest.version}),copyPhoto=s.workPlacePhotos(site.id,copied.id)[0];assert.notEqual(copied.id,place.id);assert.equal(copied.name,'복사 장소');assert.deepEqual(JSON.parse(copied.details),JSON.parse(place.details));assert.equal(JSON.parse(s.document(plan.id).details).workPlaceId,place.id);s.deleteWorkPlacePhoto(site.id,place.id,photo);s.close();s=new Store(path);assert.equal(s.workPlaces(site.id).length,2);assert.deepEqual(Buffer.from(s.workPlacePhoto(site.id,copied.id,copyPhoto.id).data),Buffer.from('ffd8ff0001','hex'));
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('작업장소 복사 API는 관리자 인증과 현장 및 원본 변경을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-place-copy-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),place=await (await call('/api/work-places','POST',input(site.id),admin)).json(),path=`/api/work-places/${place.id}/copy`;
    assert.equal((await call(`${path}?siteId=${site.id}`)).status,401);assert.equal((await call(`${path}?siteId=${other.id}`,'GET',null,admin)).status,400);const snapshot=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),copyInput={siteId:site.id,version:snapshot.version,name:'복사 장소'};assert.equal((await call(path,'POST',copyInput)).status,401);
    assert.equal((await call(`/api/work-places/${place.id}`,'PUT',{...input(site.id),name:'변경 장소',expected:expected(place)},admin)).status,200);assert.equal((await call(path,'POST',copyInput,admin)).status,409);const updated=await (await call(`${path}?siteId=${site.id}`,'GET',null,admin)).json(),response=await call(path,'POST',{...copyInput,version:updated.version},admin);assert.equal(response.status,201);assert.equal((await response.json()).name,'복사 장소');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
