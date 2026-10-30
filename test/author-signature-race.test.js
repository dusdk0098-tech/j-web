import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const image=new PNG({width:1,height:1});image.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
const types=[['checklist','checklist-signature','checklist_signatures'],['tbm','tbm-signature','tbm_signatures'],['joint_inspection','joint-signature','joint_inspection_signatures'],['work_council','meeting-signature','meeting_signatures'],['inspection','meeting-signature','meeting_signatures'],['safety_log','meeting-signature','meeting_signatures'],['patrol','meeting-signature','meeting_signatures'],['cost','meeting-signature','meeting_signatures']];

test('작성자 시험 서명은 세션 검사 실패 시 저장하지 않는다',()=>{
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'});for(const [type,path] of types){const doc=store.createDocument({siteId:site.id,type,title:'가상 문서',date:'2026-10-30',details:type==='work_council'?{kind:'정기 회의'}:{}}),method={'checklist-signature':'saveChecklistSignature','tbm-signature':'saveTbmSignature','joint-signature':'saveJointSignature','meeting-signature':'saveMeetingSignature'}[path];assert.throws(()=>store[method](doc.id,signature,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${types.find(row=>row[1]===path)[2]} WHERE document_id=?`).get(doc.id).n,0);}}finally{store.close();}
});

test('작성자 시험 서명은 저장 대기 중 문서가 제출되면 저장하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-author-signature-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.saveAuthorSignature;Store.prototype.saveAuthorSignature=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('SIGNATURE_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [type,path,table] of types){const response=await send('/api/documents','POST',{siteId:site.id,type,title:'가상 문서',date:'2026-10-30',details:type==='work_council'?{kind:'정기 회의'}:{}},admin);assert.equal(response.status,201);const doc=await response.json();db.exec('BEGIN IMMEDIATE');locked=true;const entered=once(child.stdout,'data'),pending=send(`/api/documents/${doc.id}/${path}`,'POST',{signature},admin);pending.catch(()=>{});assert.match(String((await entered)[0]),/SIGNATURE_LOCK/);db.prepare("UPDATE documents SET status='pending' WHERE id=?").run(doc.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id=?`).get(doc.id).n,0);}
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('안전 점검·업무·순회 일지의 시험 서명은 지정된 결재자만 조회한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-inspection-signature-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'inspection_sign_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:'inspection_sign_reviewer',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    for(const type of ['inspection','safety_log','patrol']){const doc=await (await send('/api/documents','POST',{siteId:site.id,type,title:'가상 일지',date:'2026-10-30'},admin)).json(),path=`/api/documents/${doc.id}`;assert.equal((await send(`${path}/meeting-signature`,'POST',{signature})).status,401);assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await send(`${path}/meeting-signature`,'POST',{signature},admin)).status,200);assert.equal((await send(`${path}/transition`,'POST',{action:'submit'},admin)).status,200);const reviewPath=`/api/reviewer/documents/${doc.id}`;assert.equal((await (await send(reviewPath,'GET',undefined,cookie)).json()).linked.authorSignature,true);assert.deepEqual(Buffer.from(await (await send(`${reviewPath}/signatures/author/0`,'GET',undefined,cookie)).arrayBuffer()),PNG.sync.write(image));assert.equal((await send(`${reviewPath}/signatures/author/0`)).status,401);}
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
