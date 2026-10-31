import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

test('이전 관리자 글은 자동 공개하지 않고 비밀 문의는 작성자만 본다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-users-')),file=join(dir,'test.sqlite');let store=new Store(file);try{
    const a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),make=(siteId,id)=>store.createReviewer({siteId,loginId:id,name:id,password:'virtual-password-123'}),one=make(a.id,'board_author'),two=make(b.id,'board_other'),legacy=store.saveBoardPost({kind:'notice',title:'이전 공지',body:'관리자 전용',secret:false}),input={kind:'question',title:'가상 문의',body:'가상 비밀',secret:true};
    store.close();const old=new DatabaseSync(file);old.exec('ALTER TABLE board_posts DROP COLUMN shared');old.exec('ALTER TABLE board_posts DROP COLUMN version');old.exec('ALTER TABLE board_posts DROP COLUMN author_name');old.exec('ALTER TABLE board_posts DROP COLUMN author_id');old.close();store=new Store(file);assert.deepEqual(store.reviewerBoardPosts(one,'notice'),[]);assert.equal(store.boardPosts('notice')[0].id,legacy.id);store.saveBoardPost({kind:'notice',title:'이전 공지',body:'관리자 전용',secret:false},legacy.id);assert.deepEqual(store.reviewerBoardPosts(one,'notice'),[]);store.saveBoardPost({kind:'notice',title:'공개 공지',body:'공개 내용',secret:false,shared:true},legacy.id);assert.equal(store.reviewerBoardPosts(two,'notice')[0].title,'공개 공지');
    const secret=store.saveReviewerBoardPost(one,input),publicPost=store.saveReviewerBoardPost(one,{kind:'general',title:'가상 공개',body:'공개 글',secret:false});assert.equal(store.reviewerBoardPosts(one,'question')[0].id,secret.id);assert.deepEqual(store.reviewerBoardPosts(two,'question'),[]);assert.deepEqual(store.reviewerBoardPosts(two,'question','가상 비밀'),[]);assert.equal(store.reviewerBoardPosts(two,'general')[0].id,publicPost.id);assert.throws(()=>store.saveReviewerBoardPost(two,{...input,version:secret.version},secret.id),/게시글/);assert.throws(()=>store.deleteReviewerBoardPost(two,'question',secret.id,secret.version),/게시글/);assert.throws(()=>store.saveReviewerBoardPost(one,{kind:'notice',title:'가상 공지',body:'내용',secret:false}),/권한/);
    store.saveBoardPost({...input,title:'관리자 수정'},secret.id);assert.throws(()=>store.saveReviewerBoardPost(one,{...input,version:secret.version},secret.id),error=>error.sessionStatus===409);assert.throws(()=>store.saveBoardPost({...input,title:'오래된 관리자 수정',expectedVersion:secret.version},secret.id),error=>error.sessionStatus===409);assert.throws(()=>store.deleteBoardPost('question',secret.id,()=>{},secret.version),error=>error.sessionStatus===409);const current=store.reviewerBoardPosts(one,'question')[0];assert.throws(()=>store.saveReviewerBoardPost(one,{...input,version:current.version},secret.id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.reviewerBoardPosts(one,'question')[0].title,'관리자 수정');store.deleteReviewerBoardPost(one,'question',secret.id,current.version);assert.deepEqual(store.reviewerBoardPosts(one,'question'),[]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('가상 게시판은 종류와 검색을 구분하고 글을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-')),file=join(dir,'test.sqlite');let store=new Store(file);
  try{
    const question={kind:'question',title:'가상 문의',body:'가상 내용',secret:true},row=store.saveBoardPost(question),notice=store.saveBoardPost({kind:'notice',title:'가상 공지',body:'가상 내용',secret:false});
    assert.equal(store.boardPosts('question','문의')[0].id,row.id);assert.deepEqual(store.boardPosts('general'),[]);assert.deepEqual(store.boardPosts('notice','없는 검색'),[]);assert.throws(()=>store.saveBoardPost({...question,kind:'notice'},row.id),/게시판/);assert.throws(()=>store.deleteBoardPost('notice',row.id),/게시글/);
    assert.throws(()=>store.saveBoardPost({...question,kind:'unknown'}));assert.throws(()=>store.saveBoardPost({...question,secret:'true'}));assert.throws(()=>store.saveBoardPost({...question,title:''}));assert.throws(()=>store.boardPosts('question','x'.repeat(201)));
    store.close();store=new Store(file);assert.equal(store.boardPosts('question')[0].secret,1);assert.equal(store.saveBoardPost({...question,title:'수정'},row.id).title,'수정');store.deleteBoardPost('question',row.id);assert.deepEqual(store.boardPosts('question'),[]);assert.equal(store.boardPosts('notice')[0].id,notice.id);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('시험 계정 게시판 API는 공개·비밀과 작성자 변경 권한을 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-reviewer-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),make=async(siteId,id)=>await (await send('/api/reviewers','POST',{siteId,loginId:id,name:id,password:'virtual-password-123'},admin)).json(),author=await make(site.id,'board_api_author'),other=await make(otherSite.id,'board_api_other'),login=async id=>(await send('/api/reviewer/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],one=await login(author.login_id),two=await login(other.login_id),path='/api/reviewer/board-posts',secret={kind:'question',title:'가상 비밀',body:'<script>가상 내용</script>',secret:true};
    assert.equal((await send(`${path}?kind=question`)).status,401);assert.equal((await send('/board-view.js')).status,200);assert.equal((await send(path,'POST',{...secret,kind:'notice',secret:false},one)).status,403);const created=await send(path,'POST',secret,one);assert.equal(created.status,201);const row=await created.json();assert.equal((await (await send(`${path}?kind=question`,'GET',undefined,one)).json())[0].body,secret.body);assert.deepEqual(await (await send(`${path}?kind=question&q=${encodeURIComponent('가상')}`,'GET',undefined,two)).json(),[]);assert.equal((await send(`${path}/${row.id}`,'PUT',{...secret,version:row.version},two)).status,400);assert.equal((await send(`${path}/${row.id}`,'DELETE',{kind:'question',version:row.version},two)).status,400);
    const adminRows=await (await send('/api/board-posts?kind=question','GET',undefined,admin)).json();assert.equal(adminRows[0].body,secret.body);assert.equal((await send(`/api/board-posts/${row.id}`,'PUT',{...secret,title:'관리자 수정'},admin)).status,200);assert.equal((await send(`${path}/${row.id}`,'PUT',{...secret,version:row.version},one)).status,409);const current=(await (await send(`${path}?kind=question`,'GET',undefined,one)).json())[0];assert.equal(current.title,'관리자 수정');assert.equal((await send(`${path}/${row.id}`,'DELETE',{kind:'question',version:current.version},one)).status,200);
    const systemInput={kind:'system_notice',title:'가상 시스템 공지',body:'가상 시스템 내용',secret:false,shared:false};
    const draftResponse=await send('/api/board-posts','POST',systemInput,admin);assert.equal(draftResponse.status,201);const systemDraft=await draftResponse.json();
    assert.deepEqual(await (await send(`${path}?kind=system_notice`,'GET',undefined,two)).json(),[]);
    assert.equal((await send(path,'POST',{...systemInput,shared:true},one)).status,400);
    assert.equal((await send(`${path}/${systemDraft.id}`,'PUT',{...systemInput,version:systemDraft.version},one)).status,400);
    assert.equal((await send(`${path}/${systemDraft.id}`,'DELETE',{kind:'system_notice',version:systemDraft.version},one)).status,400);
    const publish=await send(`/api/board-posts/${systemDraft.id}`,'PUT',{...systemInput,shared:true,expectedVersion:systemDraft.version},admin);assert.equal(publish.status,200);const published=await publish.json();
    assert.equal((await (await send(`${path}?kind=system_notice&q=${encodeURIComponent('시스템')}`,'GET',undefined,two)).json())[0].id,published.id);
    assert.deepEqual(await (await send(`${path}?kind=notice`,'GET',undefined,two)).json(),[]);
    assert.equal((await send(`${path}/${published.id}`,'PUT',{...secret,version:published.version},one)).status,400);
    assert.equal((await send(`/api/board-posts/${published.id}`,'DELETE',{kind:'system_notice',expectedVersion:published.version},admin)).status,200);
    assert.deepEqual(await (await send(`${path}?kind=system_notice`,'GET',undefined,two)).json(),[]);
    const publicRow=await (await send('/api/board-posts','POST',{kind:'notice',title:'가상 공개 공지',body:'공지',secret:false,shared:true},admin)).json();assert.equal((await (await send(`${path}?kind=notice`,'GET',undefined,two)).json())[0].id,publicRow.id);assert.equal((await send(`/api/reviewers/${other.id}`,'PUT',{siteId:otherSite.id,active:false},admin)).status,200);assert.equal((await send(`${path}?kind=notice`,'GET',undefined,two)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('게시글 API는 관리자만 읽고 변경할 수 있다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/api/board-posts?kind=question')).status,401);const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],input={kind:'question',title:'가상 문의',body:'가상 내용',secret:true},created=await send('/api/board-posts','POST',input,admin);assert.equal(created.status,201);const row=await created.json();
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),workerInput={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공',loginId:'board_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',workerInput)).status,201);const worker=(await send('/api/worker/login','POST',{token,loginId:workerInput.loginId,password:workerInput.password})).headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/api/board-posts?kind=question','GET',undefined,worker)).status,401);assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'},worker)).status,401);
    assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'})).status,401);assert.equal((await send(`/api/board-posts/${row.id}`,'PUT',{...input,title:'가상 수정'},admin)).status,200);assert.equal((await (await send('/api/board-posts?kind=question','GET',undefined,admin)).json())[0].title,'가상 수정');assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'},admin)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
