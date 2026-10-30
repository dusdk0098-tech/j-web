import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';

test('근로자의 작업계획서 시험 서명은 권한과 연결 자료를 확인하고 결재 요청별로 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-plan-signature-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),token=new URL((await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json()).link).searchParams.get('token');
    const worker=async loginId=>{const input={token,name:loginId,category:'직영',company:'가상 업체',occupation:'가상 직종',loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',input)).status,201);const response=await send('/api/worker/login','POST',{token,loginId,password:input.password}),cookie=response.headers.get('set-cookie').split(';')[0],person=(await response.json()).worker;assert.equal((await send(`/api/workers/${person.id}/permissions`,'PUT',{siteId:site.id,permissions:['work_plan']},admin)).status,200);return {cookie,person};};
    const first=await worker('plan_author'),other=await worker('plan_other');
    const equipmentInput={siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''},equipment=await (await send('/api/equipment','POST',equipmentInput,admin)).json();
    const input={type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}},created=await send('/api/worker/documents','POST',input,first.cookie);assert.equal(created.status,201);const doc=await created.json(),path=`/api/worker/documents/${doc.id}`,signaturePath=`${path}/author-signature`;
    const png=new PNG({width:2,height:2});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    assert.equal((await send(signaturePath)).status,401);assert.equal((await send(signaturePath,'GET',undefined,other.cookie)).status,400);assert.equal((await send(signaturePath,'POST',{signature},other.cookie)).status,400);
    const info=await (await send(signaturePath,'GET',undefined,first.cookie)).json();assert.equal(info.hasSignature,false);assert.equal((await send(signaturePath,'POST',{signature},first.cookie)).status,409);
    assert.equal((await send(signaturePath,'POST',{signature,expectedVersion:info.version},first.cookie)).status,200);assert.deepEqual(Buffer.from(await (await send(`${signaturePath}/image`,'GET',undefined,first.cookie)).arrayBuffer()),bytes);assert.equal((await send(`${signaturePath}/image`,'GET',undefined,other.cookie)).status,400);
    assert.equal((await send(signaturePath,'POST',{signature:'invalid',expectedVersion:info.version},first.cookie)).status,400);assert.deepEqual(Buffer.from(await (await send(`${signaturePath}/image`,'GET',undefined,first.cookie)).arrayBuffer()),bytes);
    assert.equal((await send(`/api/equipment/${equipment.id}`,'PUT',{...equipmentInput,model:'변경된 가상 모델'},admin)).status,200);const changed=await (await send(signaturePath,'GET',undefined,first.cookie)).json();assert.equal(changed.stale,true);assert.equal((await send(path+'/transition','POST',{action:'submit'},first.cookie)).status,409);assert.equal((await send(signaturePath,'POST',{signature,expectedVersion:info.version},first.cookie)).status,409);
    assert.equal((await send(signaturePath,'POST',{signature,expectedVersion:changed.version},first.cookie)).status,200);
    const reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'plan_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),stranger=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'plan_stranger',name:'다른 결재자',password:'virtual-password-123'},admin)).json();
    const adminPath=`/api/documents/${doc.id}`;assert.equal((await send(adminPath+'/approval-line','PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(path+'/transition','POST',{action:'submit'},first.cookie)).status,200);assert.equal((await send(signaturePath,'POST',{signature,expectedVersion:changed.version},first.cookie)).status,400);
    const reviewerLogin=async loginId=>(await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],reviewerCookie=await reviewerLogin(reviewer.login_id),strangerCookie=await reviewerLogin(stranger.login_id),review=`/api/reviewer/documents/${doc.id}`,payload=await (await send(review,'GET',undefined,reviewerCookie)).json(),cycle=payload.document.approval_cycle_id;
    assert.equal(payload.linked.type,'plan');assert.equal(payload.linked.authorSignature,true);assert.equal(payload.linked.equipment[0].info.model,'변경된 가상 모델');assert.deepEqual(Buffer.from(await (await send(`${review}/signatures/author/0`,'GET',undefined,reviewerCookie)).arrayBuffer()),bytes);assert.equal((await send(`${review}/signatures/author/0`,'GET',undefined,strangerCookie)).status,404);
    assert.equal((await send(path+'/transition','POST',{action:'withdraw'},first.cookie)).status,200);assert.equal((await send(path,'PUT',{...input,title:'수정된 가상 계획'},first.cookie)).status,200);assert.equal((await (await send(signaturePath,'GET',undefined,first.cookie)).json()).hasSignature,false);
    const history=`${adminPath}/approval-cycles/${cycle}/files/author-signature/0/0`;assert.deepEqual(Buffer.from(await (await send(history,'GET',undefined,admin)).arrayBuffer()),bytes);
    const adminSignature=`${adminPath}/meeting-signature`,adminInfo=await (await send(adminSignature,'GET',undefined,admin)).json();assert.equal((await send(adminSignature,'POST',{signature,expectedVersion:adminInfo.version},admin)).status,200);
    const upload=await fetch(base+path+'/attachments',{method:'POST',headers:{cookie:first.cookie,'x-file-name':'virtual.txt'},body:'가상 첨부'});assert.equal(upload.status,201);assert.equal((await (await send(adminSignature,'GET',undefined,admin)).json()).hasSignature,false);
    assert.equal((await send(`/api/workers/${first.person.id}/permissions`,'PUT',{siteId:site.id,permissions:[]},admin)).status,200);assert.equal((await send(signaturePath,'GET',undefined,first.cookie)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
