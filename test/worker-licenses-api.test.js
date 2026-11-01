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

function output(child,needle,timeout=8000){
  const began=performance.now();
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='';
    const timer=setTimeout(()=>fail('대기 시간 초과'),timeout);
    function cleanup(){clearTimeout(timer);child.stdout.off('data',read);child.stderr.off('data',readError);child.off('error',failed);child.off('close',closed);}
    function fail(reason){cleanup();reject(Error(`시험 서버 ${reason}: ${needle}; elapsed=${Math.round(performance.now()-began)}ms; pid=${child.pid}; exit=${child.exitCode}; signal=${child.signalCode}; stdout=${stdout}; stderr=${stderr}`));}
    function read(chunk){stdout+=chunk;if(stdout.includes(needle)){cleanup();resolve(Math.round(performance.now()-began));}}
    function readError(chunk){stderr+=chunk;}
    function failed(error){fail(`실행 실패 (${error.message})`);}
    function closed(){fail('준비 신호 전 종료');}
    child.stdout.on('data',read);child.stderr.on('data',readError);child.once('error',failed);child.once('close',closed);
    if(child.exitCode!==null||child.signalCode!==null)closed();
  });
}

test('시험 서버 신호는 분할 출력·조기 종료·실행 오류·무응답을 구분한다',async t=>{
  async function fixture(command,args,check){
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});
    try{await check(child);}finally{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill();await closed;}}
    assert.equal(child.stdout.listenerCount('data'),0);assert.equal(child.stderr.listenerCount('data'),0);
    assert.equal(child.listenerCount('error'),0);assert.equal(child.listenerCount('close'),0);
  }
  await t.test('분할된 READY 뒤에만 준비 완료',()=>fixture(process.execPath,['-e',"process.stdout.write('REA');setTimeout(()=>process.stdout.write('DY'),50)"],async child=>{await output(child,'READY');}));
  await t.test('조기 종료는 종료 코드와 stderr를 보고',()=>fixture(process.execPath,['-e',"process.stderr.write('virtual startup failure');process.exitCode=7"],async child=>{await assert.rejects(output(child,'READY'),error=>/준비 신호 전 종료/.test(error.message)&&/exit=7/.test(error.message)&&/stderr=virtual startup failure/.test(error.message));}));
  await t.test('실행할 수 없는 자식은 즉시 실패',()=>fixture(join(tmpdir(),'jweb-nonexistent-server-binary'),[],async child=>{await assert.rejects(output(child,'READY'),/실행 실패.*ENOENT/);}));
  await t.test('살아 있지만 준비되지 않은 자식은 제한 시간에 실패',()=>fixture(process.execPath,['-e',"process.stdout.write('BOOT');setInterval(()=>{},1000)"],async child=>{await output(child,'BOOT');await assert.rejects(output(child,'READY',50),/대기 시간 초과: READY;.*exit=null; signal=null/);}));
});

test('면허 API는 왕복·검증·권한·현장·버전·지연 본문 및 DB 잠금 뒤 인증을 검증한다',{timeout:30000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-license-api-')),flag=join(dir,'expired'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const trace=`import {existsSync} from 'node:fs';import http from 'node:http';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};import {AdminAccounts} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'admin-accounts.js')).href)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-test-slow'])req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('READY'));return server};const valid=AdminAccounts.prototype.valid;AdminAccounts.prototype.valid=function(token){return valid.call(this,token,Date.now()+(existsSync(${JSON.stringify(flag)})?9*60*60*1000:0))};for(const name of ['convertWorkerRegistration','updateWorker']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('SAVE_STARTED');return original.apply(this,args)}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    // 병렬 실행에서 기동만 8초를 넘을 수 있어 전체 30초 중 20초를 배정한다. 요청 단계는 기존 8초 제한을 유지한다.
    t.diagnostic(`시험 서버 READY: ${await output(child,'READY',20000)}ms`);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await login();
    const site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await(await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),invitation=await(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token'),person={siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 업체',occupation:'가상 직종'},input={...person,token,loginId:'virtual_self',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',{...input,licenses:[{name:'주입 면허'}]})).status,201);const workerLogin=await send('/api/worker/login','POST',{token,loginId:input.loginId,password:input.password}),workerCookie=workerLogin.headers.get('set-cookie').split(';')[0];
    const read=async()=>(await(await send(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json())[0],initial=await read(),path=`/api/workers/${initial.id}/registration/general`,data={siteId:site.id,version:initial.version};assert.equal(initial.registration_type,'self');assert.deepEqual(initial.licenses,[]);
    assert.equal((await send(path,'POST',data)).status,401);assert.equal((await send(path,'POST',data,workerCookie)).status,401);assert.equal((await send(path,'POST',{...data,siteId:other.id},admin)).status,400);assert.equal((await send(path,'POST',{siteId:site.id},admin)).status,409);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [route,method,body] of [[path,'POST',data],[`/api/workers/${initial.id}`,'PUT',{...person,version:initial.version,name:'가상 수정',licenses:[{name:'가상 면허',number:'가상-01'}]}]]){
      const raw=JSON.stringify(body),started=output(child,'BODY_STARTED');let finish;const pending=new Promise((resolve,reject)=>{const req=request(base+route,{method,agent:false,headers:{cookie:admin,'x-test-slow':'1','content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(raw.slice(0,-1));finish=()=>req.end(raw.slice(-1));});
      await started;assert.equal((await send('/api/logout','POST',{},admin)).status,200);finish();assert.equal(await pending,401);admin=await login();
      db.exec('BEGIN IMMEDIATE');locked=true;const saving=output(child,'SAVE_STARTED'),delayed=send(route,method,body,admin);await saving;writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;assert.equal((await delayed).status,401);unlinkSync(flag);admin=await login();assert.deepEqual(await read(),initial);
    }
    const licensePath='/api/workers/'+initial.id,licenseInput={...person,version:initial.version,licenses:[{name:' 가상 면허 ',number:' 가상-01 '},{name:'이름만'},{number:'번호만'},{name:'',number:''}]};
    assert.equal((await send(licensePath,'PUT',licenseInput)).status,401);assert.equal((await send(licensePath,'PUT',licenseInput,workerCookie)).status,401);
    assert.equal((await send(licensePath,'PUT',{...licenseInput,siteId:other.id},admin)).status,400);assert.equal((await send(licensePath,'PUT',{...licenseInput,licenses:[{name:3}]},admin)).status,400);assert.deepEqual(await read(),initial);
    const savedResponse=await send(licensePath,'PUT',licenseInput,admin);assert.equal(savedResponse.status,200);const saved=await savedResponse.json();assert.deepEqual(saved.licenses,[{name:'가상 면허',number:'가상-01'},{name:'이름만',number:''},{name:'',number:'번호만'}]);assert.deepEqual((await read()).licenses,saved.licenses);assert.equal(saved.registration_type,'general');
    assert.equal((await send(licensePath,'PUT',licenseInput,admin)).status,409);assert.equal((await send(licensePath,'PUT',person,admin)).status,200);assert.deepEqual((await read()).licenses,saved.licenses);
    const cleared=await send(licensePath,'PUT',{...person,licenses:[]},admin);assert.equal(cleared.status,200);assert.deepEqual((await read()).licenses,[]);
    data.version=(await read()).version;
    const outcomes=await Promise.all([send(licensePath,'PUT',{...person,version:data.version,licenses:[{name:'경합 면허'}]},admin),send(licensePath,'PUT',{...person,version:data.version,licenses:[{name:'경합 면허'}]},admin)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.equal((await read()).registration_type,'general');assert.equal((await read()).has_account,1);assert.equal((await send('/api/worker/session','GET',undefined,workerCookie)).status,200);assert.equal((await send('/api/worker/login','POST',{token,loginId:input.loginId,password:input.password})).status,200);
    assert.equal((await send(`/api/workers/${initial.id}`,'PUT',{...person,name:'가상 구형 수정'},admin)).status,200);assert.equal((await read()).registration_type,'general');
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
