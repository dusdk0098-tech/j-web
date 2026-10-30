import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
const check={date:'2026-10-30',items:[{name:'가상 점검',result:'fail',action:'가상 조치'}]};
const extension={dateFrom:'2026-10-30',dateTo:'2026-10-31',signature};

test('사전 점검과 연장의 저장·수정·삭제는 잠금 후 권한을 확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'permit',title:'가상 허가서',date:'2026-10-30'}),denied=()=>{throw Error('세션 만료');};
    assert.throws(()=>s.savePermitCheck(doc.id,check,null,denied),/세션 만료/);assert.deepEqual(s.permitChecks(doc.id),[]);
    const checkId=s.savePermitCheck(doc.id,check);
    assert.throws(()=>s.savePermitCheck(doc.id,{...check,date:'2026-10-31'},checkId,denied),/세션 만료/);
    assert.throws(()=>s.deletePermitCheck(doc.id,checkId,denied),/세션 만료/);assert.equal(s.permitChecks(doc.id)[0].date,check.date);
    assert.throws(()=>s.savePermitExtension(doc.id,extension,null,denied),/세션 만료/);assert.deepEqual(s.permitExtensions(doc.id),[]);
    const extensionId=s.savePermitExtension(doc.id,extension);
    assert.throws(()=>s.savePermitExtension(doc.id,{...extension,dateTo:'2026-11-01'},extensionId,denied),/세션 만료/);
    assert.throws(()=>s.deletePermitExtension(doc.id,extensionId,denied),/세션 만료/);assert.equal(s.permitExtensions(doc.id)[0].date_to,extension.dateTo);assert.ok(s.permitExtensionSignature(doc.id,extensionId));
  }finally{s.close();}
});

test('허가서가 바뀌거나 관리 세션이 만료된 뒤에는 대기 중인 점검을 저장하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,auth=pathToFileURL(join(process.cwd(),'auth.js')).href;
  const trace=`import {Store} from ${JSON.stringify(source)};import {LocalAuth} from ${JSON.stringify(auth)};let armed=false,expired=false;process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.includes('expire')){armed=true;expired=false;process.stdout.write('ARMED\\n')}});const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(token,now){return valid.call(this,token,expired?Date.now()+9*60*60*1000:now)};for(const name of ['savePermitCheck','deletePermitCheck','savePermitExtension','deletePermitExtension']){const original=Store.prototype[name];Store.prototype[name]=function(...args){const db=this.db,exec=db.exec,prepare=db.prepare;let signaled=false;const signal=()=>{if(!signaled){signaled=true;process.stdout.write('WAITING\\n')}};db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'){signal();const result=exec.call(this,sql);if(armed){expired=true;armed=false}return result}return exec.call(this,sql)};db.prepare=function(sql){if(/^(INSERT INTO|UPDATE|DELETE FROM) permit_(checks|extensions)/.test(sql))signal();return prepare.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec;db.prepare=prepare}}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['pipe','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),doc=await (await send('/api/documents','POST',{siteId:site.id,type:'permit',title:'가상 허가서',date:'2026-10-30'},admin)).json(),basePath=`/api/documents/${doc.id}`;
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const [part,input,table] of [['permit-checks',check,'permit_checks'],['permit-extensions',extension,'permit_extensions']]){
      db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(`${basePath}/${part}`,'POST',input,admin);pending.catch(()=>{});assert.match(String((await started)[0]),/WAITING/);
      db.prepare("UPDATE documents SET type='tbm' WHERE id=?").run(doc.id);db.exec('COMMIT');locked=false;
      assert.equal((await pending).status,400);assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE document_id=?`).get(doc.id).n,0);db.prepare("UPDATE documents SET type='permit' WHERE id=?").run(doc.id);
    }
    const created=await send(`${basePath}/permit-checks`,'POST',check,admin);assert.equal(created.status,201);const checkId=(await created.json()).id;
    const extended=await send(`${basePath}/permit-extensions`,'POST',extension,admin);assert.equal(extended.status,201);const extensionId=(await extended.json()).id;
    for(const [method,path,input] of [['POST','permit-checks',check],['PUT',`permit-checks/${checkId}`,{...check,date:'2026-10-31'}],['DELETE',`permit-checks/${checkId}`,undefined],['POST','permit-extensions',extension],['PUT',`permit-extensions/${extensionId}`,{...extension,dateTo:'2026-11-01'}],['DELETE',`permit-extensions/${extensionId}`,undefined]]){
      const cookie=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],armed=once(child.stdout,'data');child.stdin.write('expire\n');assert.match(String((await armed)[0]),/ARMED/);
      db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(`${basePath}/${path}`,method,input,cookie);pending.catch(()=>{});assert.match(String((await started)[0]),/WAITING/);db.exec('COMMIT');locked=false;
      assert.equal((await pending).status,401);assert.deepEqual(db.prepare('SELECT date FROM permit_checks WHERE document_id=?').all(doc.id).map(row=>row.date),[check.date]);assert.deepEqual(db.prepare('SELECT date_to FROM permit_extensions WHERE document_id=?').all(doc.id).map(row=>row.date_to),[extension.dateTo]);
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
