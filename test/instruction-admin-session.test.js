import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

test('관리자 조치는 본문 수신 중 로그아웃과 잠금 대기 중 문서 변경을 확인한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-instruction-admin-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const storeUrl=pathToFileURL(join(process.cwd(),'store.js')).href;
  const trace=`import http from 'node:http';import {Store} from ${JSON.stringify(storeUrl)};const original=Store.prototype.addAuthorizedInstructionResult;Store.prototype.addAuthorizedInstructionResult=function(...args){process.stdout.write('INSERT_STARTED');return original.apply(this,args)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,(req,res)=>{if(req.headers['x-slow'])req.once('data',()=>process.stdout.write('BODY_STARTED'));return handler(req,res)});server.once('listening',()=>process.stdout.write('SERVER_READY'));return server}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db;
  try{
    assert.match(String((await once(child.stdout,'data'))[0]),/SERVER_READY/);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    let admin=await login();const site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),doc=await(await send('/api/documents','POST',{siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-10-30'},admin)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(doc.id);
    const payload=JSON.stringify({date:'2026-10-30',actor:'가상 담당자',content:'가상 조치'}),started=once(child.stdout,'data');let finish;
    const pending=new Promise((resolve,reject)=>{const req=request(base+`/api/documents/${doc.id}/instruction-result`,{method:'POST',headers:{cookie:admin,'x-slow':'1','content-type':'application/json','content-length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,-1));finish=()=>req.end(payload.slice(-1));});
    assert.match(String((await started)[0]),/BODY_STARTED/);assert.equal((await send('/api/logout','POST',{},admin)).status,200);finish();assert.equal(await pending,401);
    assert.equal(db.prepare('SELECT count(*) AS n FROM instruction_results WHERE document_id=?').get(doc.id).n,0);
    admin=await login();assert.equal((await send(`/api/documents/${doc.id}/instruction-result`,'POST',JSON.parse(payload),admin)).status,201);
    const photoPath=base+`/api/documents/${doc.id}/instruction-photos?phase=before`,large=Buffer.alloc(50*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(large);const added=await fetch(photoPath,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.png'},body:large});assert.equal(added.status,201);const fileId=(await added.json()).id,download=await fetch(base+`/api/documents/${doc.id}/instruction-photos/${fileId}`,{headers:{cookie:admin}});assert.ok(Buffer.from(await download.arrayBuffer()).equals(large));
    const tooLarge=await new Promise((resolve,reject)=>{const req=request(photoPath,{method:'POST',headers:{cookie:admin,'x-file-name':'oversize.png','content-length':50*1024*1024+1}},res=>{res.resume();res.on('end',()=>{resolve(res.statusCode);req.destroy();});});req.on('error',reject);req.flushHeaders();});assert.equal(tooLarge,400);
    const startedPhoto=once(child.stdout,'data'),head=Buffer.from('89504e470d0a1a0a','hex');let endPhoto;const pendingPhoto=new Promise((resolve,reject)=>{const req=request(photoPath,{method:'POST',headers:{cookie:admin,'x-slow':'1','x-file-name':'slow.png','content-length':head.length}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write(head.subarray(0,4));endPhoto=()=>req.end(head.subarray(4));});assert.match(String((await startedPhoto)[0]),/BODY_STARTED/);const busy=await fetch(photoPath,{method:'POST',headers:{cookie:admin,'x-file-name':'second.png'},body:head});assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'1');endPhoto();const slowResult=await pendingPhoto;assert.equal(slowResult.status,400);assert.match(slowResult.body,/PNG 또는 JPEG/);assert.equal((await fetch(photoPath,{method:'POST',headers:{cookie:admin,'x-file-name':'retry.png'},body:head})).status,201);
    const startedAbort=once(child.stdout,'data'),aborted=request(photoPath,{method:'POST',headers:{cookie:admin,'x-slow':'1','x-file-name':'abort.png','content-length':head.length}});aborted.on('error',()=>{});aborted.write(head.subarray(0,4));assert.match(String((await startedAbort)[0]),/BODY_STARTED/);aborted.destroy();let afterAbort;for(let i=0;i<100;i++){afterAbort=await fetch(photoPath,{method:'POST',headers:{cookie:admin,'x-file-name':'after-abort.png'},body:head});if(afterAbort.status!==503)break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(afterAbort.status,201);
    const other=await(await send('/api/documents','POST',{siteId:site.id,type:'instruction',title:'다른 가상 지시',date:'2026-10-30'},admin)).json();
    db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(other.id);db.exec('BEGIN IMMEDIATE');
    const startedInsert=once(child.stdout,'data'),pendingInsert=send(`/api/documents/${other.id}/instruction-result`,'POST',JSON.parse(payload),admin);pendingInsert.catch(()=>{});
    assert.match(String((await startedInsert)[0]),/INSERT_STARTED/);db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(other.id);db.exec('COMMIT');
    assert.equal((await pendingInsert).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM instruction_results WHERE document_id=?').get(other.id).n,0);
  }finally{if(db)db.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
