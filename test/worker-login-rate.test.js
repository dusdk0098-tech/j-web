import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const secret='virtual-proxy-secret-for-tests-123456';
async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
async function start(file,env,imports=[]){const child=spawn(process.execPath,[...imports,file],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('가상 시험 서버 시작 실패');})]);return child;}

for(const tls of [false,true])test(`${tls?'HTTPS 중계':'HTTP 직접'}: 발신자 격리·위조 헤더·계정 10회·동시 요청·5분 만료`,{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-rate-')),clock=join(dir,'clock'),backendPort=await port(),proxyPort=tls?await port():null,origin=`${tls?'https':'http'}://127.0.0.1:${tls?proxyPort:backendPort}`;let child,proxy;
  try{
    writeFileSync(clock,'0');const preload=`import {readFileSync} from 'node:fs';const original=Date.now;Date.now=()=>original()+Number(readFileSync(${JSON.stringify(clock)},'utf8'));`;
    child=await start('server.js',{PORT:String(backendPort),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password',JWEB_PROXY_SECRET:secret,...(tls?{JWEB_PUBLIC_ORIGIN:origin}:{JWEB_PUBLIC_ORIGIN:''})},['--import',`data:text/javascript,${encodeURIComponent(preload)}`]);
    let cert;
    if(tls){
      const key=join(dir,'key.pem'),certificate=join(dir,'cert.pem');assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',key,'-out',certificate,'-days','1','-nodes','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'}).status,0,'시험용 OpenSSL 인증서 생성');cert=readFileSync(certificate);
      proxy=await start('https-proxy.js',{PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:origin,JWEB_PROXY_SECRET:secret,JWEB_PROXY_BIND:'127.0.0.1',JWEB_TLS_CERT:certificate,JWEB_TLS_KEY:key});
    }
    const send=(path,method='GET',data,cookie='',address='127.0.0.1',extra={})=>new Promise((resolve,reject)=>{
      const req=(tls?httpsRequest:httpRequest)(origin+path,{method,localAddress:address,agent:false,...(tls?{ca:cert}:{}),headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...extra}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);
    });
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers['set-cookie'][0].split(';')[0];
    const makeSite=async name=>{const site=(await send('/api/sites','POST',{name},admin)).body,invite=(await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).body,token=new URL(invite.link).searchParams.get('token'),siteKey=(await send(`/api/join?token=${token}`)).body.siteKey;const user={token,loginId:'virtual_worker',name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',user)).status,201);return {siteKey,loginId:user.loginId,password:user.password};};
    const a=await makeSite('가상 A'),b=await makeSite('가상 B'),login=(input,address='127.0.0.1',headers={})=>send('/api/worker/login','POST',input,'',address,headers);
    assert.equal((await login(a)).status,200);
    for(let i=0;i<100;i++){const response=await login({...a,loginId:`missing_${i}`,password:'wrong'},'127.0.0.1',{'x-forwarded-for':`192.0.2.${i+1}`,...(tls?{'x-jweb-client-address':`192.0.2.${i+1}`,'x-jweb-proxy-secret':'forged'}:{})});assert.equal(response.status,401);assert.deepEqual(response.body,{error:'가입 링크 또는 로그인 정보를 확인해 주세요.'});assert.equal(response.headers['set-cookie'],undefined);}
    for(let i=0;i<5;i++)assert.equal((await login(i%2?a:b)).status,429);
    for(const user of [a,b])assert.equal((await login(user,'127.0.0.2')).status,200,'다른 실제 발신자 정상 로그인');
    const concurrent=await Promise.all(Array.from({length:20},()=>login({...a,password:'wrong'},'127.0.0.2')));assert.equal(concurrent.filter(r=>r.status===401).length,10);assert.equal(concurrent.filter(r=>r.status===429).length,10);
    assert.equal((await login(a,'127.0.0.3')).status,429,'계정 제한은 다른 IP에서도 유지');assert.equal((await login(b,'127.0.0.3')).status,200,'동일 아이디의 다른 현장 계정은 격리');
    writeFileSync(clock,String(5*60*1000+1));assert.equal((await login(a)).status,200,'발신자와 계정 제한 모두 만료');
    for(let i=0;i<9;i++)assert.equal((await login({...a,password:'wrong'},'127.0.0.2')).status,401);
    assert.equal((await login(a,'127.0.0.2')).status,200,'성공은 해당 계정 실패만 초기화');
    for(let i=0;i<10;i++)assert.equal((await login({...a,password:'wrong'},'127.0.0.2')).status,401);
    assert.equal((await login(a,'127.0.0.3')).status,429);
    if(tls)for(const backendSecret of [undefined,'different-virtual-secret-1234567890']){
      const stopped=once(child,'exit');child.kill();await stopped;
      const env={PORT:String(backendPort),JWEB_DATA_DIR:dir,JWEB_PUBLIC_ORIGIN:origin};
      child=await start('server.js',{...env,JWEB_PROXY_SECRET:backendSecret});
      const rejected=await login(b,'127.0.0.2');assert.equal(rejected.status,503);assert.deepEqual(rejected.body,{error:'로그인 중계 설정을 확인해 주세요.'});assert.equal(rejected.headers['set-cookie'],undefined);
    }
  }finally{
    for(const process of [proxy,child])if(process&&process.exitCode===null&&process.signalCode===null){const done=once(process,'exit');process.kill();await done;}
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});

test('실패 기록 상한·최초 등록 키 제거·만료 정리 및 프록시 신뢰 경계',()=>{
  const source=readFileSync('server.js','utf8'),helpers=source.slice(source.indexOf('const workerPeerFailures='),source.indexOf('const workerKey='));
  const peerSource=source.slice(source.indexOf('function workerPeer('),source.indexOf('const secureCookie='));
  runInNewContext(`${peerSource}
    const request=(peer,address,secret)=>({socket:{remoteAddress:peer},headers:{'x-jweb-client-address':address,'x-jweb-proxy-secret':secret}});
    assert.equal(workerPeer(request('127.0.0.1','192.0.2.7',secret)),'192.0.2.7');
    assert.equal(workerPeer(request('127.0.0.2','192.0.2.7',secret)),'127.0.0.2');
    assert.equal(workerPeer(request('127.0.0.1','invalid',secret)),null);
    assert.equal(workerPeer(request('127.0.0.1','192.0.2.7','wrong')),null);
    assert.equal(workerPeer(request('::ffff:127.0.0.1','::ffff:192.0.2.7',secret)),'192.0.2.7');
    proxySecretHash=null;assert.equal(workerPeer(request('127.0.0.1','192.0.2.7',secret)),null);assert.equal(workerPeer(request('127.0.0.1',undefined,undefined)),'127.0.0.1');
  `,{assert,secret,isIP,createHash,timingSafeEqual,proxySecretHash:createHash('sha256').update(secret).digest()});
  runInNewContext(`${helpers}
    for(const map of [workerPeerFailures,workerAccountFailures]){
      for(let i=0;i<10000;i++)recordWorkerFailure(map,String(i),[],1000);
      recordWorkerFailure(map,'0',map.get('0'),1001);
      recordWorkerFailure(map,'new',[],1002);
      assert.equal(map.size,10000);assert.equal(map.has('0'),false);assert.equal(map.has('1'),true);
    }
    pruneWorkerFailures(301000);
    assert.equal(workerPeerFailures.size,1);assert.equal(workerAccountFailures.size,1);
    pruneWorkerFailures(301002);assert.equal(workerPeerFailures.size,0);assert.equal(workerAccountFailures.size,0);
  `,{assert});
});

test('HTTPS 중계는 공유 비밀 누락·짧은 값으로 시작하지 않는다',()=>{
  for(const value of [undefined,'short']){const env={...process.env,JWEB_PUBLIC_ORIGIN:'https://localhost:8443'};if(value===undefined)delete env.JWEB_PROXY_SECRET;else env.JWEB_PROXY_SECRET=value;const result=spawnSync(process.execPath,['https-proxy.js'],{env,encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.match(result.stderr,/중계 공유 비밀/);}
});
