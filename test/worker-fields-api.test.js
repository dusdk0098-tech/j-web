import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('현장 가입 API와 관리자 수정은 구분별 선택 항목을 검증한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-fields-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const input={token,name:'가상 출입자',category:'직영',company:'',occupation:'가상 직종',loginId:'direct_virtual',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',input)).status,201);assert.equal((await call('/api/join','POST',{...input,category:'협력업체 근로자',loginId:'missing_virtual'})).status,400);
    assert.equal((await call('/api/join','POST',{...input,category:'근로를 제공하지 않는 사람',occupation:'',loginId:'visitor_virtual'})).status,201);
    assert.equal((await call('/api/worker/login','POST',{token,loginId:'visitor_virtual',password:input.password})).status,200);
    const workers=await (await call(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json(),visitor=workers.find(row=>row.category==='근로를 제공하지 않는 사람');assert.equal(visitor.company,'');assert.equal(visitor.occupation,'');
    const path=`/api/workers/${visitor.id}`,edit={siteId:site.id,name:'수정한 가상 출입자',category:visitor.category,company:'',occupation:''};assert.equal((await call(path,'PUT',edit,admin)).status,200);
    assert.equal((await call(path,'PUT',{...edit,category:'협력업체 관리자'},admin)).status,400);const after=await (await call(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json();assert.equal(after.find(row=>row.id===visitor.id).category,visitor.category);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
