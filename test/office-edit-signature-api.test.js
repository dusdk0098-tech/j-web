import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';
const png=new PNG({width:1,height:1});png.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');

test('관리자와 직원 수정 API는 원자 서명과 잠금 뒤 권한·참조 변경을 검증한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-edit-')),reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.updateDocument;Store.prototype.updateDocument=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('EDIT_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async(path,data)=>(await send(path,'POST',data)).headers.get('set-cookie').split(';')[0],admin=await login('/api/login',{password:'virtual-admin-password'}),site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),make=async name=>await(await send('/api/reviewers','POST',{siteId:site.id,loginId:name,name,password:'virtual-password-123'},admin)).json(),author=await make('edit_api_author'),reviewer=await make('edit_api_reviewer'),other=await make('edit_api_other'),cookie=await login('/api/reviewer/login',{loginId:author.login_id,password:'virtual-password-123'}),alien=await login('/api/reviewer/login',{loginId:other.login_id,password:'virtual-password-123'});
    const base={title:'가상 문서',date:'2026-11-01',body:'가상 본문',details:{kind:'품의서'}},created=await(await send('/api/reviewer/office-documents','POST',{...base,officeSetup:{reviewerIds:[reviewer.id],referenceIds:[other.id],signature}},cookie)).json(),id=created.document.id,path=`/api/reviewer/office-documents/${id}`,adminPath=`/api/documents/${id}`;
    const edit=detail=>({...base,title:'수정한 가상 문서',expectedEditVersion:detail.document.edit_version,version:detail.version,officeEditSignature:{signature,version:detail.editSignatureVersion,referenceVersion:null}});
    assert.equal((await send(path,'PUT',edit(created))).status,401);assert.notEqual((await send(path,'PUT',edit(created),alien)).status,200);
    let response=await send(path,'PUT',edit(created),cookie);let detail=await response.json();assert.equal(response.status,200,JSON.stringify(detail));assert.equal(detail.hasSignature,true);assert.equal(detail.document.title,'수정한 가상 문서');assert.equal((await send(path,'PUT',edit(created),cookie)).status,409);
    const info=await(await send(adminPath+'/meeting-signature','GET',undefined,admin)).json(),input={...base,type:'office',siteId:site.id,title:'관리자 수정',expectedEditVersion:detail.document.edit_version,officeEditSignature:{signature,version:info.editSignatureVersion,referenceVersion:null}};response=await send(adminPath,'PUT',input,admin);assert.equal(response.status,200);const saved=await response.json();detail=await(await send(path,'GET',undefined,cookie)).json();assert.equal(saved.edit_version,detail.document.edit_version);assert.equal(detail.hasSignature,true);assert.equal(detail.line[0].reviewer_id,reviewer.id);assert.equal(detail.references[0].id,other.id);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const snapshot=()=>JSON.stringify(['documents','approval_steps','office_document_authors','office_reference_recipients','meeting_signatures','office_reference_signature_versions'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
    for(const scenario of ['reference','session']){
      detail=await(await send(path,'GET',undefined,cookie)).json();const before=snapshot();db.exec('BEGIN IMMEDIATE');locked=true;const entered=once(child.stdout,'data'),pending=send(path,'PUT',edit(detail),cookie);pending.catch(()=>{});assert.match(String((await entered)[0]),/EDIT_LOCK/);
      if(scenario==='reference')db.prepare('UPDATE reviewers SET active=0 WHERE id=?').run(other.id);else db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(author.id);
      db.exec('COMMIT');locked=false;response=await pending;assert.equal(response.status,scenario==='reference'?409:401);assert.equal(snapshot(),before);if(scenario==='reference')db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(other.id);
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
