import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {PNG} from 'pngjs';

test('본인 신고 사진은 최초 계정 세션과 신고 소유자를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-photo-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie,context)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(context?{'x-worker-report-context':JSON.stringify(context)}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),password='virtual-password-123';
    for(const loginId of ['photo_a','photo_b'])assert.equal((await send('/api/join','POST',{token,name:'가상 사용자',category:'직영',company:'가상',occupation:'가상',loginId,password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
    const login=async loginId=>{const res=await send('/api/worker/login','POST',{token,loginId,password});assert.equal(res.status,200);return {cookie:res.headers.get('set-cookie').split(';')[0],...(await res.json())};},a=await login('photo_a'),b=await login('photo_b'),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),created=await send('/api/worker/hazard-reports','POST',{title:'가상 신고',body:'가상 내용',photo:'data:image/png;base64,'+bytes.toString('base64'),reportContext:a.reportContext},a.cookie);assert.equal(created.status,201);const id=(await created.json()).id,path=`/api/worker/hazard-reports/${id}/photo`;
    assert.equal((await send(path)).status,401);const valid=await send(path,'GET',null,a.cookie,a.reportContext);assert.equal(valid.status,200);assert.deepEqual(Buffer.from(await valid.arrayBuffer()),bytes);
    assert.equal((await send(path,'GET',null,b.cookie,b.reportContext)).status,404);const mismatch=await send(path,'GET',null,b.cookie,a.reportContext);assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).sessionChanged,true);
    const newer=await login('photo_a');assert.equal((await send(path,'GET',null,newer.cookie,a.reportContext)).status,409);assert.equal((await send(path,'GET',null,newer.cookie,newer.reportContext)).status,200);
    const staleLogout=await send('/api/worker/logout','POST',null,b.cookie,a.reportContext);assert.equal(staleLogout.status,409);assert.equal((await staleLogout.json()).sessionChanged,true);assert.equal((await send('/api/worker/hazard-reports','GET',null,b.cookie,b.reportContext)).status,200);
    assert.equal((await send('/api/worker/logout','POST',null,b.cookie,b.reportContext)).status,200);assert.equal((await send('/api/worker/hazard-reports','GET',null,b.cookie,b.reportContext)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
