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
import { Store } from '../store.js';
import { PNG } from 'pngjs';

test('관리자 결재와 공지 저장 시 세션 재검사에 실패하면 상태와 이력을 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-30'}),notice=s.createDocument({siteId:site.id,type:'notice',title:'가상 공지',date:'2026-10-30',body:'가상 내용'}),deny=()=>{throw Error('세션 만료');},png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    assert.throws(()=>s.managedTransition(doc.id,{action:'submit'},deny),/세션 만료/);assert.throws(()=>s.publishNotice(notice.id,deny),/세션 만료/);assert.equal(s.document(doc.id).status,'draft');assert.equal(s.document(notice.id).status,'draft');assert.deepEqual(s.events(doc.id),[]);assert.deepEqual(s.events(notice.id),[]);s.transition(doc.id,'submit');assert.throws(()=>s.approveDocuments(site.id,[doc.id],signature,deny),/세션 만료/);assert.equal(s.document(doc.id).status,'pending');assert.equal(s.events(doc.id).length,1);
  }finally{s.close();}
});

test('관리자 결재 요청과 공지 게시 대기 중 상태가 바뀌면 기존 상태를 덮어쓰지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-admin-transition-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};let depth=0;for(const method of ['managedTransition','transition','publishNotice']){const original=Store.prototype[method];if(!original)continue;Store.prototype[method]=function(...args){const db=this.db,exec=db.exec,root=depth++===0;if(root)db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'||sql==='SAVEPOINT document_transition'||sql==='SAVEPOINT publish_notice')process.stdout.write('TRANSITION_SAVE\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{depth--;if(root)db.exec=exec}};}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [type,part,data,next] of [['risk','transition',{action:'submit'},'approved'],['notice','publish-notice',{},'pending']]){const doc=await (await send('/api/documents','POST',{siteId:site.id,type,title:'가상 문서',date:'2026-10-30',body:'가상 내용'},admin)).json();db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(`/api/documents/${doc.id}/${part}`,'POST',data,admin);pending.catch(()=>{});assert.match(String((await started)[0]),/TRANSITION_SAVE/);db.prepare('UPDATE documents SET status=? WHERE id=?').run(next,doc.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT status FROM documents WHERE id=?').get(doc.id).status,next);assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE document_id=?').get(doc.id).n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM approval_cycles WHERE document_id=?').get(doc.id).n,0);db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(doc.id);assert.equal((await send(`/api/documents/${doc.id}/${part}`,'POST',data,admin)).status,200);}
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
