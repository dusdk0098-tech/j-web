import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

function output(child,needle){return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>{child.stdout.off('data',read);reject(Error('시험 서버 대기 시간 초과: '+needle));},30000);function read(chunk){text+=chunk;if(text.includes(needle)){clearTimeout(timer);child.stdout.off('data',read);resolve();}}child.stdout.on('data',read);});}

test('등록 전환 API는 관리자·현장·버전과 지연 본문/DB 잠금 뒤 세션을 검증한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-registration-api-')),flag=join(dir,'expired'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const trace=`import {existsSync} from 'node:fs';import http from 'node:http';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};import {AdminAccounts} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'admin-accounts.js')).href)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-test-slow'])req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('READY'));return server};const valid=AdminAccounts.prototype.valid;AdminAccounts.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(flag)})?9*60*60*1000:0))};for(const name of ['convertWorkerRegistration','updateWorker']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('SAVE_STARTED');return original.apply(this,args)}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await output(child,'READY');const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await login();
    const site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await(await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),invitation=await(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token'),person={siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 업체',occupation:'가상 직종'},input={...person,token,loginId:'virtual_self',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',input)).status,201);const workerLogin=await send('/api/worker/login','POST',{token,loginId:input.loginId,password:input.password}),workerCookie=workerLogin.headers.get('set-cookie').split(';')[0];
    const read=async()=>(await(await send(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json())[0],initial=await read(),path=`/api/workers/${initial.id}/registration/general`,data={siteId:site.id,version:initial.version};assert.equal(initial.registration_type,'self');
    assert.equal((await send(path,'POST',data)).status,401);assert.equal((await send(path,'POST',data,workerCookie)).status,401);assert.equal((await send(path,'POST',{...data,siteId:other.id},admin)).status,400);assert.equal((await send(path,'POST',{siteId:site.id},admin)).status,409);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [route,method,body] of [[path,'POST',data],[`/api/workers/${initial.id}`,'PUT',{...person,version:initial.version,name:'가상 수정'}]]){
      const raw=JSON.stringify(body),started=output(child,'BODY_STARTED');let finish;const pending=new Promise((resolve,reject)=>{const req=request(base+route,{method,agent:false,headers:{cookie:admin,'x-test-slow':'1','content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(raw.slice(0,-1));finish=()=>req.end(raw.slice(-1));});
      await started;assert.equal((await send('/api/logout','POST',{},admin)).status,200);finish();assert.equal(await pending,401);admin=await login();
      db.exec('BEGIN IMMEDIATE');locked=true;const saving=output(child,'SAVE_STARTED'),delayed=send(route,method,body,admin);await saving;writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;assert.equal((await delayed).status,401);unlinkSync(flag);admin=await login();assert.deepEqual(await read(),initial);
    }
    const outcomes=await Promise.all([send(path,'POST',data,admin),send(path,'POST',data,admin)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.equal((await read()).registration_type,'general');assert.equal((await read()).has_account,1);assert.equal((await send('/api/worker/session','GET',undefined,workerCookie)).status,200);assert.equal((await send('/api/worker/login','POST',{token,loginId:input.loginId,password:input.password})).status,200);
    assert.equal((await send(`/api/workers/${initial.id}`,'PUT',{...person,name:'가상 구형 수정'},admin)).status,200);assert.equal((await read()).registration_type,'general');
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
