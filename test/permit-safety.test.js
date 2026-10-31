import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('허가서 안전대책은 유효한 항목만 저장하고 결재 당시 사본을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-safety-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),adminLogin=async()=>(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    let admin=await adminLogin();const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),makeReviewer=async(siteId,loginId)=>await (await call('/api/reviewers','POST',{siteId,loginId,name:'가상 결재자',password:'virtual-password-123'},admin)).json(),reviewer=await makeReviewer(site.id,'permit_reviewer'),outsider=await makeReviewer(other.id,'permit_outsider');
    const rows=[{accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 조치'},{accidentType:'',hazard:'추가 위험',measure:''}],input={siteId:site.id,type:'permit',title:'가상 허가',date:'2026-10-30',details:{kinds:['화기작업'],safetyMeasures:rows}},created=await call('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json(),path=`/api/documents/${doc.id}`;assert.deepEqual(JSON.parse(doc.details).safetyMeasures,rows);
    for(const invalid of [[{accidentType:'',hazard:'',measure:''}],[{...rows[0],hazard:'가'.repeat(2001)}],Array.from({length:101},()=>rows[0])])assert.equal((await call(path,'PUT',{...input,details:{...input.details,safetyMeasures:invalid}},admin)).status,400);
    assert.equal((await call(path,'PUT',{...input,details:{kinds:['화기작업']}},admin)).status,200);assert.deepEqual(JSON.parse((await (await call(path,'GET',undefined,admin)).json()).details).safetyMeasures,rows);
    assert.equal((await call(path,'PUT',{...input,details:{...input.details,directWork:true,personnel:'2',periodFrom:'2026-10-30',periodTo:'2026-10-30',place:'가상 장소',work:'가상 작업'}},admin)).status,200);
    const roleState=await (await call(`${path}/permit-roles`,'GET',undefined,admin)).json();assert.equal((await call(`${path}/permit-roles`,'PUT',{expectedVersion:roleState.version,roles:{...roleState.roles,siteManager:reviewer.id}},admin)).status,200);assert.equal((await call(`${path}/transition`,'POST',{action:'submit'},admin)).status,200);const submitted=await (await call(path,'GET',undefined,admin)).json(),cycle=submitted.approval_cycle_id;
    const login=async loginId=>(await call('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],review=await login('permit_reviewer'),foreign=await login('permit_outsider'),reviewPath=`/api/reviewer/documents/${doc.id}`;
    assert.equal((await call(reviewPath)).status,401);assert.equal((await call(reviewPath,'GET',undefined,foreign)).status,404);assert.deepEqual(JSON.parse((await (await call(reviewPath,'GET',undefined,review)).json()).document.details).safetyMeasures,rows);
    assert.equal((await call(`${path}/transition`,'POST',{action:'withdraw'},admin)).status,200);assert.equal((await call(path,'PUT',{...input,details:{...input.details,directWork:false,safetyMeasures:[{...rows[0],measure:'수정 조치'}]}},admin)).status,200);await stop();await start();admin=await adminLogin();
    assert.equal(JSON.parse((await (await call(path,'GET',undefined,admin)).json()).details).safetyMeasures[0].measure,'수정 조치');assert.deepEqual(JSON.parse((await (await call(`${path}/approval-cycles/${cycle}`,'GET',undefined,admin)).json()).document.details).safetyMeasures,rows);
    assert.equal((await call(path,'PUT',{...input,details:{...input.details,safetyMeasures:[]}},admin)).status,200);assert.deepEqual(JSON.parse((await (await call(path,'GET',undefined,admin)).json()).details).safetyMeasures,[]);assert.deepEqual(JSON.parse((await (await call(`${path}/approval-cycles/${cycle}`,'GET',undefined,admin)).json()).document.details).safetyMeasures,rows);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
