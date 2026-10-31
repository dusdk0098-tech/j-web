import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';

test('대상과 서명 저장 중 교육 권한이 회수되면 기록하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-training-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};for(const method of ['setTrainingTargets','saveAuthorSignature']){const original=Store.prototype[method];Store.prototype[method]=function(...args){const exec=this.db.exec;this.db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('TRAINING_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{this.db.exec=exec}}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상 근로자',category:'직영',occupation:'목공',loginId:'train_race',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await call('/api/join','POST',person)).status,201);
    const login=await call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password}),cookie=login.headers.get('set-cookie').split(';')[0],worker=(await login.json()).worker,grant=()=>call(`/api/workers/${worker.id}/permissions`,'PUT',{siteId:site.id,permissions:['training']},admin);assert.equal((await grant()).status,200);
    const doc=await (await call('/api/worker/documents','POST',{type:'tbm',title:'가상',date:'2026-11-01',details:{}},cookie)).json(),path=`/api/worker/documents/${doc.id}/training`,png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const kind of ['targets','signature']){const state=await (await call(path,'GET',null,cookie)).json();db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=kind==='targets'?call(path,'PUT',{workerIds:[worker.id],expectedVersion:state.version},cookie):call(`${path}/signature`,'POST',{signature,expectedVersion:state.version},cookie);pending.catch(()=>{});assert.match(String((await started)[0]),/TRAINING_LOCK/);db.prepare("DELETE FROM worker_permissions WHERE worker_id=? AND permission='training'").run(worker.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM training_target_config WHERE document_id=?').get(doc.id).n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tbm_signatures WHERE document_id=?').get(doc.id).n,0);assert.equal((await grant()).status,200);}
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
