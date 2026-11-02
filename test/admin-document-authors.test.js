import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';
import {Store} from '../store.js';

test('관리자 작성자는 문서와 함께 저장하고 실패·삭제 시 함께 정리한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-03',body:'내용'},one={id:1,name:'가상 관리자 A'},two={id:2,name:'가상 관리자 B'};
    const legacy=store.createDocument(input);assert.equal(store.documents(site.id).find(row=>row.id===legacy.id).author_name,null);
    assert.throws(()=>store.createAuthorizedDocument(input,()=>{},()=>({id:0,name:'가상'})),/관리자 계정/);assert.equal(store.documents(site.id).length,1);
    store.db.exec("CREATE TRIGGER fail_admin_author BEFORE INSERT ON admin_document_authors BEGIN SELECT RAISE(ABORT,'작성자 저장 실패'); END");assert.throws(()=>store.createAuthorizedDocument(input,()=>{},()=>one),/작성자 저장 실패/);assert.equal(store.documents(site.id).length,1);store.db.exec('DROP TRIGGER fail_admin_author');
    const original=store.createAuthorizedDocument(input,()=>{},()=>one),copy=store.copyWorkPlan(original.id,{siteId:site.id,title:'복사본',date:input.date},()=>{},()=>two),authors=store.documents(site.id);assert.equal(authors.find(row=>row.id===original.id).author_name,one.name);assert.equal(authors.find(row=>row.id===copy.id).author_name,two.name);
    const count=authors.length;assert.throws(()=>store.copyWorkPlan(original.id,{siteId:site.id,title:'거절된 복사',date:input.date},()=>{throw Error('세션 만료');},()=>two),/세션 만료/);assert.equal(store.documents(site.id).length,count);
    store.db.prepare('DELETE FROM work_plan_copies WHERE document_id=?').run(copy.id);store.db.prepare('DELETE FROM documents WHERE id=?').run(copy.id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM admin_document_authors WHERE document_id=?').get(copy.id).n,0);const replacement=store.createDocument(input);assert.equal(replacement.id,copy.id);assert.equal(store.documents(site.id).find(row=>row.id===replacement.id).author_name,null);
  }finally{store.close();}
});

test('이전 데이터베이스를 열면 기존 문서는 작성자 미기록으로 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-author-migration-')),file=join(dir,'jweb.sqlite');let store;
  try{store=new Store(file);const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'notice',title:'이전 가상 문서',date:'2026-11-03',body:'내용'});store.db.exec('DROP TABLE admin_document_authors');store.close();store=new Store(file);assert.equal(store.documents(site.id).find(row=>row.id===doc.id).author_name,null);assert.equal(store.db.prepare('SELECT count(*) AS n FROM admin_document_authors').get().n,0);}finally{store?.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('관리자 HTTP 문서와 복사본은 요청이 아닌 로그인 계정의 작성자를 기록한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-document-author-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async(id,password='virtual-admin-password')=>{const response=await send('/api/login','POST',{loginId:id,password});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];},json=async(response,status=200)=>{assert.equal(response.status,status);return response.json();};
    const first=await login('admin'),site=await json(await send('/api/sites','POST',{name:'가상 현장'},first),201),outside=await json(await send('/api/sites','POST',{name:'다른 가상 현장'},first),201),secondAccount=await json(await send('/api/admin-accounts','POST',{loginId:'author_admin',name:'가상 관리자 B',password:'virtual-admin-password'},first),201),second=await login('author_admin');
    const input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-03',body:'가상 내용',author_name:'위조 이름',admin_id:999},original=await json(await send('/api/documents','POST',input,first),201),copy=await json(await send(`/api/documents/${original.id}/copy-work-plan`,'POST',{siteId:site.id,title:'계획 복사',date:input.date},second),201),office=await json(await send('/api/documents','POST',{...input,type:'office',title:'가상 업무',details:{kind:'품의서'}},first),201),officeCopy=await json(await send(`/api/documents/${office.id}/copy-office`,'POST',{siteId:site.id,title:'업무 복사',date:input.date},second),201);
    const reviewer=await json(await send('/api/reviewers','POST',{siteId:site.id,loginId:'author_reviewer',name:'가상 결재자',password:'virtual-password-123'},first),201),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,signed=await json(await send('/api/documents','POST',{...input,type:'office',details:{kind:'품의서'},officeSetup:{reviewerIds:[reviewer.id],referenceIds:[],signature}},second),201);
    const rows=await json(await send(`/api/documents?siteId=${site.id}`,'GET',undefined,first));for(const id of [original.id,office.id])assert.equal(rows.find(row=>row.id===id).author_name,'최초 관리자');for(const id of [copy.id,officeCopy.id,signed.id])assert.equal(rows.find(row=>row.id===id).author_name,'가상 관리자 B');assert.ok(!rows.some(row=>row.author_name==='위조 이름'));
    assert.equal((await send('/api/documents','POST',input)).status,401);await json(await send(`/api/admin-accounts/${secondAccount.id}`,'PUT',{version:secondAccount.version,name:'변경된 관리자'},first));const later=await json(await send('/api/documents','POST',{...input,title:'이름 변경 후'},second),201),updated=await json(await send(`/api/documents?siteId=${site.id}`,'GET',undefined,first));assert.equal(updated.find(row=>row.id===copy.id).author_name,'가상 관리자 B');assert.equal(updated.find(row=>row.id===later.id).author_name,'변경된 관리자');
    const limitedAccount=await json(await send('/api/admin-accounts','POST',{loginId:'author_limited',name:'현장 관리자',password:'virtual-admin-password',scope:'restricted',siteIds:[site.id]},first),201),limited=await login('author_limited');assert.equal((await send('/api/documents','POST',{...input,siteId:outside.id},limited)).status,403);const limitedDoc=await json(await send('/api/documents','POST',{siteId:site.id,type:'notice',title:'가상 공지',date:input.date,body:'내용'},limited),201);assert.equal((await json(await send(`/api/documents?siteId=${site.id}`,'GET',undefined,limited))).find(row=>row.id===limitedDoc.id).author_name,'현장 관리자');
    await stop();const db=new DatabaseSync(join(dir,'jweb.sqlite'));try{const record=db.prepare('SELECT admin_id,author_name FROM admin_document_authors WHERE document_id=?').get(limitedDoc.id);assert.equal(record.admin_id,limitedAccount.id);assert.equal(record.author_name,'현장 관리자');}finally{db.close();}await start();assert.equal((await json(await send(`/api/documents?siteId=${site.id}`,'GET',undefined,first))).find(row=>row.id===copy.id).author_name,'가상 관리자 B');
  }finally{await stop();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
