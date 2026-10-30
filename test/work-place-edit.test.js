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
