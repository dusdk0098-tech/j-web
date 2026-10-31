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

test('이전 직원 계정은 공지 권한이 없으며 권한과 작성자를 구분한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-permission-')),file=join(dir,'test.sqlite');let store=new Store(file);
  try{
    const site=store.createSite({name:'가상 현장'}),otherSite=store.createSite({name:'다른 현장'}),create=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),author=create('notice_author'),other=create('notice_other');
    store.close();store=null;const old=new DatabaseSync(file);old.exec('DROP TABLE reviewer_notice_permissions');old.close();store=new Store(file);
    const account=store.reviewers(site.id).find(row=>row.id===author.id),input={kind:'notice',title:'가상 공지',body:'가상 내용',secret:false};
    assert.equal(account.notice_write_enabled,0);assert.equal(account.notice_write_version,'');
    assert.throws(()=>store.saveReviewerBoardPost(author,input),error=>error.sessionStatus===403);
    assert.throws(()=>store.setReviewerNoticeWrite(otherSite.id,author.id,{enabled:true,expectedVersion:''}),/현장/);
    const grant=store.setReviewerNoticeWrite(site.id,author.id,{enabled:true,expectedVersion:''});assert.equal(grant.enabled,true);
    store.setReviewerNoticeWrite(site.id,other.id,{enabled:true,expectedVersion:''});
    const post=store.saveReviewerBoardPost(author,input);assert.equal(store.reviewerBoardPosts(other,'notice')[0].id,post.id);
    assert.throws(()=>store.saveReviewerBoardPost(other,{...input,version:post.version},post.id),/게시글/);
    assert.throws(()=>store.saveReviewerBoardPost(author,{...input,kind:'system_notice'}),/게시판/);
    const revised=store.saveReviewerBoardPost(author,{...input,title:'수정된 공지',version:post.version},post.id);
    const revoked=store.setReviewerNoticeWrite(site.id,author.id,{enabled:false,expectedVersion:grant.version});
    assert.throws(()=>store.saveReviewerBoardPost(author,{...input,version:revised.version},post.id),error=>error.sessionStatus===403);
    assert.throws(()=>store.deleteReviewerBoardPost(author,'notice',post.id,revised.version),error=>error.sessionStatus===403);
    assert.throws(()=>store.setReviewerNoticeWrite(site.id,author.id,{enabled:true,expectedVersion:grant.version}),error=>error.sessionStatus===409);
    store.updateReviewer(site.id,author.id,{active:false});
    assert.throws(()=>store.setReviewerNoticeWrite(site.id,author.id,{enabled:true,expectedVersion:revoked.version}),/활성/);
    store.updateReviewer(site.id,author.id,{active:true});
    const again=store.setReviewerNoticeWrite(site.id,author.id,{enabled:true,expectedVersion:revoked.version});
    store.close();store=new Store(file);assert.equal(store.reviewerCanWriteNotice(author.id),true);assert.equal(store.reviewers(site.id).find(row=>row.id===author.id).notice_write_version,again.version);
    store.deleteReviewerBoardPost(author,'notice',post.id,revised.version);assert.deepEqual(store.reviewerBoardPosts(author,'notice'),[]);
  }finally{if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});

test('공지 권한 API는 관리자만 변경하고 저장 대기 중 해제도 적용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href;
  const trace="import {Store} from "+JSON.stringify(source)+";const original=Store.prototype.saveReviewerBoardPost;Store.prototype.saveReviewerBoardPost=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'&&args[1].title==='대기 중 수정')process.stdout.write('NOTICE_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}";
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(trace),'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base='http://127.0.0.1:'+port,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'notice_api',name:'가상 직원',password:'virtual-password-123'},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:'notice_api',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    const path='/api/reviewer/board-posts',permission='/api/reviewers/'+reviewer.id+'/notice-write',input={kind:'notice',title:'가상 공지',body:'가상 내용',secret:false};
    assert.equal((await send('/api/reviewer/board-permissions')).status,401);assert.equal((await (await send('/api/reviewer/board-permissions','GET',undefined,cookie)).json()).canWriteNotice,false);
    assert.equal((await send(path,'POST',input,cookie)).status,403);assert.equal((await send(permission,'PUT',{siteId:site.id,enabled:true,expectedVersion:''},cookie)).status,401);
    assert.equal((await send(permission,'PUT',{siteId:otherSite.id,enabled:true,expectedVersion:''},admin)).status,400);
    const grantResponse=await send(permission,'PUT',{siteId:site.id,enabled:true,expectedVersion:''},admin);assert.equal(grantResponse.status,200);const grant=await grantResponse.json();
    assert.equal((await (await send('/api/reviewer/board-permissions','GET',undefined,cookie)).json()).canWriteNotice,true);
    assert.equal((await send(permission,'PUT',{siteId:site.id,enabled:false,expectedVersion:''},admin)).status,409);
    assert.equal((await send(path,'POST',{...input,kind:'system_notice'},cookie)).status,400);
    const created=await send(path,'POST',input,cookie);assert.equal(created.status,201);const post=await created.json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;
    const waiting=once(child.stdout,'data'),pending=send(path+'/'+post.id,'PUT',{...input,title:'대기 중 수정',version:post.version},cookie);pending.catch(()=>{});
    assert.match(String((await waiting)[0]),/NOTICE_LOCK/);db.prepare("UPDATE reviewer_notice_permissions SET enabled=0,version='changed-while-waiting' WHERE reviewer_id=?").run(reviewer.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,403);assert.equal(db.prepare('SELECT title FROM board_posts WHERE id=?').get(post.id).title,input.title);
    assert.equal((await (await send('/api/reviewer/board-permissions','GET',undefined,cookie)).json()).canWriteNotice,false);
    assert.equal((await send(path+'/'+post.id,'DELETE',{kind:'notice',version:post.version},cookie)).status,403);
    assert.equal((await send(permission,'PUT',{siteId:site.id,enabled:true,expectedVersion:grant.version},admin)).status,409);
    assert.equal((await send(permission,'PUT',{siteId:site.id,enabled:true,expectedVersion:'changed-while-waiting'},admin)).status,200);
    assert.equal((await send(path+'/'+post.id,'DELETE',{kind:'notice',version:post.version},cookie)).status,200);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
