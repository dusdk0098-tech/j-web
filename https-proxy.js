import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { X509Certificate, createPrivateKey } from 'node:crypto';

const rawOrigin=process.env.JWEB_PUBLIC_ORIGIN;
let origin;try{origin=new URL(rawOrigin);}catch{throw new Error('HTTPS 접속 주소를 확인해 주세요.');}
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.origin!==rawOrigin)throw new Error('HTTPS 접속 주소는 경로 없이 입력해 주세요.');
const bind=process.env.JWEB_PROXY_BIND||'127.0.0.1',backendPort=Number(process.env.PORT||4173),proxyPort=Number(origin.port||443);
if(!isIP(bind)||!Number.isInteger(backendPort)||backendPort<1||backendPort>65535||!Number.isInteger(proxyPort)||proxyPort<1||proxyPort>65535||backendPort===proxyPort)throw new Error('중계 주소와 포트를 확인해 주세요.');
if(!process.env.JWEB_TLS_CERT||!process.env.JWEB_TLS_KEY)throw new Error('인증서와 개인키 파일 경로를 지정해 주세요.');
const cert=readFileSync(process.env.JWEB_TLS_CERT),key=readFileSync(process.env.JWEB_TLS_KEY),certificate=new X509Certificate(cert),host=origin.hostname.replace(/^\[|\]$/g,'');
if(!(isIP(host)?certificate.checkIP(host):certificate.checkHost(host,{subject:'never',partialWildcards:false})))throw new Error('인증서의 주소가 HTTPS 접속 주소와 일치하지 않습니다.');
if(Date.now()<Date.parse(certificate.validFrom)||Date.now()>Date.parse(certificate.validTo))throw new Error('인증서의 유효 기간을 확인해 주세요.');
if(!certificate.checkPrivateKey(createPrivateKey(key)))throw new Error('인증서와 개인키가 일치하지 않습니다.');

const server=createServer({cert,key},(incoming,outgoing)=>{
  if(incoming.headers.host!==origin.host){outgoing.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'});outgoing.end('접속 주소를 확인해 주세요.');return;}
  const upstream=httpRequest({hostname:'127.0.0.1',port:backendPort,path:incoming.url,method:incoming.method,headers:incoming.headers},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});incoming.on('aborted',()=>upstream.destroy());incoming.pipe(upstream);
});
server.listen(proxyPort,bind,()=>console.log(`J웹 HTTPS 중계: ${origin.origin}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
