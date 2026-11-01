import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {mountBoardComments} from '../public/board-comments.js';

test('댓글은 게시글 열람 권한과 버전을 확인하고 게시글 삭제 시 함께 삭제된다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),author=make('comment_author'),other=make('comment_other'),post=store.saveReviewerBoardPost(author,{kind:'question',title:'가상 문의',body:'내용',secret:true}),input={postVersion:post.version,body:'가상 댓글'};
    assert.throws(()=>store.boardComments(post.id,post.version,other),/게시글/);assert.throws(()=>store.addBoardComment(post.id,input,other),/게시글/);assert.throws(()=>store.addBoardComment(post.id,input,author,()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(store.boardComments(post.id,post.version,author),[]);
    const comment=store.addBoardComment(post.id,input,author),saved=store.boardComments(post.id,post.version,author)[0];assert.equal(saved.id,comment.id);assert.equal(saved.body,input.body);assert.throws(()=>store.deleteBoardComment(post.id,saved.id,{postVersion:post.version,version:saved.version},other),/게시글/);
    const publicPost=store.saveReviewerBoardPost(author,{kind:'general',title:'공개',body:'내용',secret:false}),publicComment=store.addBoardComment(publicPost.id,{postVersion:publicPost.version,body:'가상 댓글'},author),publicRow=store.boardComments(publicPost.id,publicPost.version,other)[0];assert.throws(()=>store.deleteBoardComment(publicPost.id,publicComment.id,{postVersion:publicPost.version,version:publicRow.version},other),/댓글/);
    const changed=store.saveBoardPost({kind:'question',title:'수정',body:'내용',secret:true,expectedVersion:post.version},post.id);assert.throws(()=>store.addBoardComment(post.id,input,author),/변경/);assert.throws(()=>store.deleteBoardComment(post.id,saved.id,{postVersion:changed.version,version:'old'},author),/변경/);store.deleteBoardPost('question',post.id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM board_comments WHERE post_id=?').get(post.id).n,0);
  }finally{store.close();}
});

test('댓글 화면은 내용을 텍스트로 표시하고 게시글 버전을 전송한다',async()=>{
  const previous=globalThis.document;class Element{constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;this.hidden=false;}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(){}}
  globalThis.document={createElement:tag=>new Element(tag)};try{const article=new Element('article'),calls=[],api=async(path,options)=>{calls.push({path,options});return [{id:4,author_id:2,author_name:'<작성자>',created_at:'시각',body:'<script>시험</script>',version:'comment-version'}];};mountBoardComments(article,{row:{id:3,version:'post-version'},base:'/api/board-posts',actorId:2,api,active:()=>true});article.children[0].onclick();await new Promise(resolve=>setImmediate(resolve));const area=article.children[1],item=area.children.find(node=>node.tag==='p');assert.equal(area.hidden,false);assert.match(item.textContent,/<script>시험<\/script>/);assert.match(calls[0].path,/version=post-version/);assert.ok(area.children.some(node=>node.tag==='form'));}finally{globalThis.document=previous;}
});

test('가상 서버 댓글 API는 비밀글을 보호하고 작성자와 관리자의 삭제를 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-comments-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상'},admin)).json();
    const login=async id=>{await send('/api/reviewers','POST',{siteId:site.id,loginId:id,name:id,password:'virtual-password-123'},admin);return (await send('/api/reviewer/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];},one=await login('comment_one'),two=await login('comment_two'),post=await (await send('/api/reviewer/board-posts','POST',{kind:'question',title:'비밀',body:'내용',secret:true},one)).json(),path=`/api/reviewer/board-posts/${post.id}/comments`,adminPath=`/api/board-posts/${post.id}/comments`,query=`?version=${post.version}`;
    assert.equal((await send(path+query)).status,401);assert.equal((await send(path+query,'GET',undefined,two)).status,400);assert.equal((await send(path,'POST',{postVersion:post.version,body:'비밀 댓글'},one)).status,201);assert.equal((await send(path,'POST',{postVersion:post.version,body:'다른 계정'},two)).status,400);
    const list=await (await send(path+query,'GET',undefined,one)).json();assert.equal(list.length,1);assert.equal(list[0].body,'비밀 댓글');assert.equal((await send(adminPath+query,'GET',undefined,admin)).status,200);assert.equal((await send(`${adminPath}/${list[0].id}`,'DELETE',{postVersion:post.version,version:list[0].version},admin)).status,200);assert.deepEqual(await (await send(path+query,'GET',undefined,one)).json(),[]);assert.equal((await send('/board-comments.js')).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
