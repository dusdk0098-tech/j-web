import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';

test('가상 게시판은 종류와 검색을 구분하고 글을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-')),file=join(dir,'test.sqlite');let store=new Store(file);
  try{
    const question={kind:'question',title:'가상 문의',body:'가상 내용',secret:true},row=store.saveBoardPost(question),notice=store.saveBoardPost({kind:'notice',title:'가상 공지',body:'가상 내용',secret:false});
    assert.equal(store.boardPosts('question','문의')[0].id,row.id);assert.deepEqual(store.boardPosts('general'),[]);assert.deepEqual(store.boardPosts('notice','없는 검색'),[]);assert.throws(()=>store.saveBoardPost({...question,kind:'notice'},row.id),/게시판/);assert.throws(()=>store.deleteBoardPost('notice',row.id),/게시글/);
    assert.throws(()=>store.saveBoardPost({...question,kind:'unknown'}));assert.throws(()=>store.saveBoardPost({...question,secret:'true'}));assert.throws(()=>store.saveBoardPost({...question,title:''}));assert.throws(()=>store.boardPosts('question','x'.repeat(201)));
    store.close();store=new Store(file);assert.equal(store.boardPosts('question')[0].secret,1);assert.equal(store.saveBoardPost({...question,title:'수정'},row.id).title,'수정');store.deleteBoardPost('question',row.id);assert.deepEqual(store.boardPosts('question'),[]);assert.equal(store.boardPosts('notice')[0].id,notice.id);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('게시글 API는 관리자만 읽고 변경할 수 있다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal((await send('/api/board-posts?kind=question')).status,401);const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],input={kind:'question',title:'가상 문의',body:'가상 내용',secret:true},created=await send('/api/board-posts','POST',input,admin);assert.equal(created.status,201);const row=await created.json();
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),workerInput={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공',loginId:'board_worker',password:'virtual-password-123',acknowledged:true};
    assert.equal((await send('/api/join','POST',workerInput)).status,201);const worker=(await send('/api/worker/login','POST',{token,loginId:workerInput.loginId,password:workerInput.password})).headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/api/board-posts?kind=question','GET',undefined,worker)).status,401);assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'},worker)).status,401);
    assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'})).status,401);assert.equal((await send(`/api/board-posts/${row.id}`,'PUT',{...input,title:'가상 수정'},admin)).status,200);assert.equal((await (await send('/api/board-posts?kind=question','GET',undefined,admin)).json())[0].title,'가상 수정');assert.equal((await send(`/api/board-posts/${row.id}`,'DELETE',{kind:'question'},admin)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
