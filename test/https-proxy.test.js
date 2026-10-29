import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer as reservePort } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

test('로컬 HTTPS 중계로 가상 QR 가입과 로그인이 이어진다', async t => {
  if (spawnSync('openssl', ['version'], { stdio: 'ignore' }).status !== 0) { t.skip('OpenSSL이 없어 로컬 TLS 시험을 건너뜁니다.'); return; }
  const dir=mkdtempSync(join(tmpdir(),'jweb-tls-')),keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');
  let proxy,child;
  try {
    const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-days','1','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
    assert.equal(generated.status,0,'시험용 인증서 생성에 실패했습니다.');
    const key=readFileSync(keyPath),cert=readFileSync(certPath),reservation=reservePort();
    await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const backendPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    proxy=createHttpsServer({key,cert},(incoming,outgoing)=>{
      const upstream=httpRequest({hostname:'127.0.0.1',port:backendPort,path:incoming.url,method:incoming.method,headers:incoming.headers},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
      upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyPort=proxy.address().port,origin=`https://localhost:${proxyPort}`;
    child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(backendPort),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345',JWEB_PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('시험 서버가 종료됐습니다.');})]);
    const send=(path,method='GET',data=null,cookie='')=>new Promise((resolve,reject)=>{
      const body=data===null?null:JSON.stringify(data),headers={host:`localhost:${proxyPort}`,origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})};
      const req=httpsRequest({hostname:'127.0.0.1',port:proxyPort,servername:'localhost',ca:cert,path,method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});
      req.on('error',reject);if(body)req.write(body);req.end();
    });
    const admin=await send('/api/login','POST',{password:'test-password-12345'});assert.equal(admin.status,200);assert.match(admin.headers['set-cookie'][0],/; Secure/);const cookie=admin.headers['set-cookie'][0].split(';')[0];
    const site=JSON.parse((await send('/api/sites','POST',{name:'가상 현장'},cookie)).body),invite=JSON.parse((await send(`/api/sites/${site.id}/invitation`,'POST',{},cookie)).body),url=new URL(invite.link);
    assert.equal(url.origin,origin);const png=PNG.sync.read(Buffer.from(invite.image.split(',')[1],'base64'));assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,invite.link);
    const token=url.searchParams.get('token');assert.equal((await send(`/api/join?token=${encodeURIComponent(token)}`)).status,200);
    const registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true};assert.equal((await send('/api/join','POST',registration)).status,201);
    const login=await send('/api/worker/login','POST',{token,loginId:registration.loginId,password:registration.password});assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/; Secure/);const workerCookie=login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await send('/api/worker/session','GET',null,workerCookie)).status,200);assert.equal((await send('/api/sites','GET',null,workerCookie)).status,401);
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
    if(proxy?.listening)await new Promise(resolve=>proxy.close(resolve));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});
