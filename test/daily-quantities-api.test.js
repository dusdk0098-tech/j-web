import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('일보 수량은 서버 재시작 후 보존되고 잘못된 수정은 저장되지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-daily-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0];
    let admin=await login();const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),row={name:'가상 자재',quantity:'',previous:'12.3',day:'0.4',unit:'개',specification:'가상 규격'},input={siteId:site.id,type:'daily_report',title:'가상 일보',date:'2026-10-30',details:{materials:[row]}};
    const created=await call('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json();assert.deepEqual(JSON.parse(doc.details).materials,[row]);
    assert.equal((await call(`/api/documents/${doc.id}`,'PUT',{...input,details:{materials:[{...row,day:'-4'}]}},admin)).status,400);
    await stop();await start();admin=await login();const loaded=await call(`/api/documents/${doc.id}`,'GET',undefined,admin);assert.equal(loaded.status,200);assert.deepEqual(JSON.parse((await loaded.json()).details).materials,[row]);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
