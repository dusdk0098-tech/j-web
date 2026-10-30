import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir,networkInterfaces } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer as reservePort } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

test('중계는 인증서나 올바른 주소가 없으면 시작하지 않는다',()=>{
  const env={...process.env,JWEB_PUBLIC_ORIGIN:'https://localhost:8443',PORT:'4173'};delete env.JWEB_TLS_CERT;delete env.JWEB_TLS_KEY;
  assert.notEqual(spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env,stdio:'ignore'}).status,0);
  assert.notEqual(spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...env,JWEB_PUBLIC_ORIGIN:'http://localhost:8443'},stdio:'ignore'}).status,0);
  assert.notEqual(spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...env,JWEB_PROXY_BIND:'invalid'},stdio:'ignore'}).status,0);
});

test('중계는 주소·기간·개인키가 맞지 않는 인증서로 시작하지 않는다',async t=>{
  if(spawnSync('openssl',['version'],{stdio:'ignore'}).status!==0){t.skip('OpenSSL이 없어 인증서 시험을 건너뜁니다.');return;}
  const dir=mkdtempSync(join(tmpdir(),'jweb-tls-host-')),keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');
  try{
    assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-days','1','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'}).status,0);
    const backend=reservePort(),proxy=reservePort();await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const backendPort=backend.address().port,proxyPort=proxy.address().port;await new Promise(resolve=>backend.close(resolve));await new Promise(resolve=>proxy.close(resolve));
    for(const host of ['wrong.test','127.0.0.2']){
      const result=spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:`https://${host}:${proxyPort}`,JWEB_PROXY_BIND:'127.0.0.1',JWEB_TLS_CERT:certPath,JWEB_TLS_KEY:keyPath},encoding:'utf8',timeout:2000});
      assert.notEqual(result.error?.code,'ETIMEDOUT','주소에 맞지 않는 인증서로 중계가 시작되었습니다.');assert.notEqual(result.status,0);assert.match(result.stderr,/인증서.*주소/);
    }
    const env={...process.env,PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:`https://localhost:${proxyPort}`,JWEB_PROXY_BIND:'127.0.0.1',JWEB_TLS_CERT:certPath,JWEB_TLS_KEY:keyPath},clock=encodeURIComponent('Date.now=()=>4102444800000'),expired=spawnSync(process.execPath,['--import',`data:text/javascript,${clock}`,'https-proxy.js'],{cwd:process.cwd(),env,encoding:'utf8',timeout:2000});assert.notEqual(expired.error?.code,'ETIMEDOUT');assert.notEqual(expired.status,0);assert.match(expired.stderr,/유효 기간/);
    const otherKey=join(dir,'other.pem');assert.equal(spawnSync('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',otherKey],{stdio:'ignore'}).status,0);const wrongKey=spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...env,JWEB_TLS_KEY:otherKey},encoding:'utf8',timeout:2000});assert.notEqual(wrongKey.error?.code,'ETIMEDOUT');assert.notEqual(wrongKey.status,0);assert.match(wrongKey.stderr,/인증서.*개인키/);
  }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('네트워크 IP의 HTTPS 중계에서 가상 QR 가입과 로그인이 이어진다',{timeout:30000},async t=>{
  if(spawnSync('openssl',['version'],{stdio:'ignore'}).status!==0){t.skip('OpenSSL이 없어 IP 연결 시험을 건너뜁니다.');return;}
  const address=Object.values(networkInterfaces()).flat().find(item=>item&&item.family==='IPv4'&&!item.internal)?.address;if(!address){t.skip('접속 가능한 IPv4가 없어 IP 연결 시험을 건너뜁니다.');return;}
  const dir=mkdtempSync(join(tmpdir(),'jweb-tls-ip-')),keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');let child,proxy;
  try{
    assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-days','1','-nodes','-subj','/CN=jweb-test','-addext',`subjectAltName=IP:${address}`],{stdio:'ignore'}).status,0);
    const cert=readFileSync(certPath),backendReservation=reservePort(),proxyReservation=reservePort();await new Promise(resolve=>backendReservation.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>proxyReservation.listen(0,'127.0.0.1',resolve));const backendPort=backendReservation.address().port,proxyPort=proxyReservation.address().port,origin=`https://${address}:${proxyPort}`;await new Promise(resolve=>backendReservation.close(resolve));await new Promise(resolve=>proxyReservation.close(resolve));
    child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345',JWEB_PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    proxy=spawn(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:origin,JWEB_PROXY_BIND:address,JWEB_TLS_CERT:certPath,JWEB_TLS_KEY:keyPath},stdio:['ignore','pipe','pipe']});await Promise.race([once(proxy.stdout,'data'),once(proxy,'exit').then(()=>{throw Error('시험 중계가 종료됐습니다.');})]);
    const send=(path,method='GET',data=null,cookie='')=>new Promise((resolve,reject)=>{const payload=data===null?null:JSON.stringify(data),headers={origin,...(cookie?{cookie}:{}),...(payload?{'content-type':'application/json'}:{})},req=httpsRequest({hostname:address,port:proxyPort,ca:cert,path,method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);if(payload)req.write(payload);req.end();});
    const login=await send('/api/login','POST',{password:'test-password-12345'});assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/; Secure/);const cookie=login.headers['set-cookie'][0].split(';')[0],site=JSON.parse((await send('/api/sites','POST',{name:'가상 현장'},cookie)).body),invite=JSON.parse((await send(`/api/sites/${site.id}/invitation`,'POST',{},cookie)).body),url=new URL(invite.link),png=PNG.sync.read(Buffer.from(invite.image.split(',')[1],'base64'));
    assert.equal(url.origin,origin);assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,invite.link);assert.equal((await send('/join.js')).status,200);assert.equal((await send('/worker-location.js')).status,200);
    assert.equal((await send(`/api/sites/${site.id}/location-policy`,'PUT',{enabled:true,latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:50,expectedVersion:null},cookie)).status,200);
    const token=url.searchParams.get('token'),registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'ip_virtual_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',registration)).status,201);
    const credentials={token,loginId:registration.loginId,password:registration.password};assert.equal((await send('/api/worker/login','POST',credentials)).status,400);
    const worker=await send('/api/worker/login','POST',{...credentials,location:{latitude:0,longitude:0,accuracyMeters:10,timestamp:Date.now()}});assert.equal(worker.status,200);assert.match(worker.headers['set-cookie'][0],/; Secure/);assert.equal((await send('/api/worker/session','GET',null,worker.headers['set-cookie'][0].split(';')[0])).status,200);
    const day=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),events=await send(`/api/sites/${site.id}/location-events?date=${day}`,'GET',null,cookie);assert.equal(events.status,200);assert.equal(JSON.parse(events.body).length,1);
  }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}if(proxy&&proxy.exitCode===null&&proxy.signalCode===null){const exited=once(proxy,'exit');proxy.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('로컬 HTTPS 중계로 가상 QR 가입과 로그인이 이어진다', async t => {
  if (spawnSync('openssl', ['version'], { stdio: 'ignore' }).status !== 0) { t.skip('OpenSSL이 없어 로컬 TLS 시험을 건너뜁니다.'); return; }
  const dir=mkdtempSync(join(tmpdir(),'jweb-tls-')),keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');
  let proxy,child;
  try {
    const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-days','1','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
    assert.equal(generated.status,0,'시험용 인증서 생성에 실패했습니다.');
    const cert=readFileSync(certPath),backendReservation=reservePort(),proxyReservation=reservePort();
    await new Promise(resolve=>backendReservation.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>proxyReservation.listen(0,'127.0.0.1',resolve));const backendPort=backendReservation.address().port,proxyPort=proxyReservation.address().port,origin=`https://localhost:${proxyPort}`;await new Promise(resolve=>backendReservation.close(resolve));await new Promise(resolve=>proxyReservation.close(resolve));
    const invalid=spawnSync(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:`http://localhost:${proxyPort}`,JWEB_TLS_CERT:certPath,JWEB_TLS_KEY:keyPath},stdio:'ignore'});assert.notEqual(invalid.status,0);
    child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345',JWEB_PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('시험 서버가 종료됐습니다.');})]);
    proxy=spawn(process.execPath,['https-proxy.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_PUBLIC_ORIGIN:origin,JWEB_PROXY_BIND:'127.0.0.1',JWEB_TLS_CERT:certPath,JWEB_TLS_KEY:keyPath},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(proxy.stdout,'data'),once(proxy,'exit').then(()=>{throw new Error('시험 중계가 종료됐습니다.');})]);
    const send=(path,method='GET',data=null,cookie='',host=`localhost:${proxyPort}`)=>new Promise((resolve,reject)=>{
      const body=data===null?null:JSON.stringify(data),headers={host,origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})};
      const req=httpsRequest({hostname:'127.0.0.1',port:proxyPort,servername:'localhost',ca:cert,path,method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});
      req.on('error',reject);if(body)req.write(body);req.end();
    });
    assert.equal((await send('/api/session','GET',null,'','other.test')).status,403);
    const admin=await send('/api/login','POST',{password:'test-password-12345'});assert.equal(admin.status,200);assert.match(admin.headers['set-cookie'][0],/; Secure/);const cookie=admin.headers['set-cookie'][0].split(';')[0];
    const site=JSON.parse((await send('/api/sites','POST',{name:'가상 현장'},cookie)).body),invite=JSON.parse((await send(`/api/sites/${site.id}/invitation`,'POST',{},cookie)).body),url=new URL(invite.link);
    assert.equal(url.origin,origin);const png=PNG.sync.read(Buffer.from(invite.image.split(',')[1],'base64'));assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,invite.link);
    const token=url.searchParams.get('token'),joinInfo=await send(`/api/join?token=${encodeURIComponent(token)}`);assert.equal(joinInfo.status,200);const siteKey=JSON.parse(joinInfo.body).siteKey,manifestResponse=await send(`/worker.webmanifest?site=${encodeURIComponent(siteKey)}`);assert.equal(manifestResponse.status,200);const manifest=JSON.parse(manifestResponse.body),homeUrl=new URL(manifest.start_url,origin);assert.equal(homeUrl.origin,origin);assert.equal(homeUrl.searchParams.get('site'),siteKey);assert.equal(homeUrl.searchParams.has('token'),false);assert.equal((await send(homeUrl.pathname+homeUrl.search)).status,200);
    for(const size of [192,512]){const icon=await send(`/jweb-icon-${size}.png`);assert.equal(icon.status,200);assert.equal(icon.headers['content-type'],'image/png');}
    const registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',registration)).status,201);
    const login=await send('/api/worker/login','POST',{token,loginId:registration.loginId,password:registration.password});assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/; Secure/);const workerCookie=login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await send('/api/worker/session','GET',null,workerCookie)).status,200);assert.equal((await send('/api/sites','GET',null,workerCookie)).status,401);
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
    if(proxy&&proxy.exitCode===null&&proxy.signalCode===null){const exited=once(proxy,'exit');proxy.kill();await exited;}
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});
