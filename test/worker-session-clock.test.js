import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

const cases=[
  {zone:'Asia/Seoul',now:'2026-10-31T14:59:59.500Z',date:'2026-10-31',next:'2026-10-31T15:00:00.000Z',afterDate:'2026-11-01',afterNext:'2026-11-01T15:00:00.000Z'},
  {zone:'UTC',now:'2026-12-31T23:59:59.500Z',date:'2026-12-31',next:'2027-01-01T00:00:00.000Z',afterDate:'2027-01-01',afterNext:'2027-01-02T00:00:00.000Z'},
  {zone:'America/New_York',now:'2026-03-08T05:00:00.000Z',date:'2026-03-08',next:'2026-03-09T04:00:00.000Z'},
  {zone:'America/New_York',now:'2026-11-01T04:00:00.000Z',date:'2026-11-01',next:'2026-11-02T05:00:00.000Z'},
];

for(const scenario of cases)test(`근로자 세션 서버 시계: ${scenario.zone} ${scenario.date}`,{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-session-clock-')),clock=join(dir,'clock.txt'),reservation=createServer();
  writeFileSync(clock,scenario.now);
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const preload=`import {readFileSync} from 'node:fs';const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]))}static now(){return NativeDate.parse(readFileSync(${JSON.stringify(clock)},'utf8'))}};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(preload)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,TZ:scenario.zone,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(`시험 서버 종료: ${stderr}`);})]);
    const call=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const absent=await call('/api/worker/session');assert.equal(absent.status,401);assert.deepEqual(await absent.json(),{error:'근로자 로그인이 필요합니다.'});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await (await call('/api/sites','POST',{name:'가상 시계 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const person={token,name:'가상 근로자',category:'직영',occupation:'목공',loginId:'clock_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',person)).status,201);
    const logged=await call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password});assert.equal(logged.status,200);
    const cookie=logged.headers.get('set-cookie').split(';')[0],{worker,reportContext}=await logged.json(),raw=cookie.slice('jweb_worker='.length);
    assert.equal(logged.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(reportContext).sort(),['generation','siteId','workerId']);assert.equal(reportContext.workerId,worker.id);assert.equal(reportContext.siteId,worker.site_id);assert.match(reportContext.generation,/^[a-f0-9]{64}$/);assert.notEqual(reportContext.generation,raw);assert.notEqual(reportContext.generation,createHash('sha256').update(raw).digest('hex'));
    assert.ok(!JSON.stringify({worker,reportContext}).includes(raw));
    const check=async(now,date,next)=>{
      writeFileSync(clock,now);
      const response=await call('/api/worker/session','GET',null,cookie);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      assert.deepEqual(await response.json(),{worker,reportContext,date,nextDayAt:next,serverNow:now});
    };
    await check(scenario.now,scenario.date,scenario.next);
    if(scenario.afterDate)await check(scenario.next,scenario.afterDate,scenario.afterNext);
    const date=scenario.afterDate||scenario.date;
    assert.equal((await call(`/api/sites/${site.id}/worker-access-blocks`,'PUT',{date,kind:'ended',blocked:true},admin)).status,200);
    const blocked=await call('/api/worker/session','GET',null,cookie);assert.equal(blocked.status,403);assert.deepEqual(await blocked.json(),{error:'해당 현장은 오늘 근로자 접속이 차단되었습니다.'});
    assert.equal((await call(`/api/sites/${site.id}/worker-access-blocks`,'PUT',{date,kind:'ended',blocked:false},admin)).status,200);
    writeFileSync(clock,new Date(Date.parse(scenario.now)+8*60*60*1000).toISOString());
    const expired=await call('/api/worker/session','GET',null,cookie);assert.equal(expired.status,401);assert.deepEqual(await expired.json(),{error:'근로자 로그인이 필요합니다.'});
  }finally{
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    rmSync(dir,{recursive:true,force:true});
  }
});
