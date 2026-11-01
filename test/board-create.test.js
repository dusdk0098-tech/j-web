import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {boardCreation,boardCreateMarkup} from '../public/board-create.js';
const styledBody=()=>[{type:'p',style:{fontFamily:'맑은 고딕',fontSize:24,color:'#aabbcc',backgroundColor:'#ffff00',textAlign:'center',indent:2},children:[{type:'text',value:'가상 본문'}]}];
const input=(token='a'.repeat(32))=>({kind:'general',title:'가상 제목',body:'가상 본문',bodyRich:styledBody(),secret:false,shared:true,creationToken:token,attachments:[{name:'가상.txt',base64:Buffer.from('가상 파일').toString('base64')},{name:'두번째.txt',base64:'YQ=='}]});
test('새 본문 서식 보존과 신규 첨부 원자 저장, 부분 실패 롤백, 재전송·변경 요청·삭제 후 재전송',()=>{
 const store=new Store(':memory:');try{
  store.db.exec("CREATE TRIGGER virtual_failure BEFORE INSERT ON board_attachments WHEN NEW.name='두번째.txt' BEGIN SELECT RAISE(ABORT,'가상 실패'); END;");
  assert.throws(()=>store.saveBoardPost(input()),/가상 실패/);for(const table of ['board_posts','board_attachments','board_creations'])assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  store.db.exec('DROP TRIGGER virtual_failure');const row=store.saveBoardPost(input());assert.deepEqual(row.rich_body,styledBody());assert.deepEqual(store.boardPosts('general')[0].rich_body,styledBody());assert.deepEqual(JSON.parse(store.db.prepare('SELECT rich_body FROM board_posts WHERE id=?').get(row.id).rich_body),styledBody());assert.equal(store.boardAttachments(row.id,row.version).length,2);assert.equal(store.saveBoardPost(input()).id,row.id);assert.equal(store.boardPosts('general').length,1);assert.throws(()=>store.saveBoardPost({...input(),title:'변경'}),e=>e.sessionStatus===409);
  const file=store.boardAttachments(row.id,row.version)[0];assert.equal(Buffer.from(store.boardAttachment(row.id,file.id,row.version,file.version).data).toString(),'가상 파일');
  const updated=store.saveBoardPost({kind:'general',title:'수정',bodyRich:[{...styledBody()[0],children:[{type:'text',value:'수정 본문'}]}],secret:false,expectedVersion:row.version},row.id);assert.throws(()=>store.boardAttachments(row.id,row.version),e=>e.sessionStatus===409);assert.equal(store.boardAttachments(row.id,updated.version).length,2);
  store.deleteBoardPost('general',row.id);assert.throws(()=>store.saveBoardPost(input()),e=>e.sessionStatus===409);assert.equal(store.boardPosts('general').length,0);const replacement=store.saveBoardPost(input('c'.repeat(32)));assert.equal(replacement.id,row.id);assert.throws(()=>store.saveBoardPost(input()),e=>e.sessionStatus===409);assert.equal(store.boardPosts('general').length,1);
 }finally{store.close();}
});
test('새 본문 서식 보존과 신규 첨부 검사, 직원 현장·작성 권한과 만료 세션은 게시글도 남기지 않는다',()=>{
 const store=new Store(':memory:');try{
  const site=store.createSite({name:'가상 현장'}),actor=store.createReviewer({siteId:site.id,loginId:'virtual_author',name:'가상 작성자',password:'virtual-password-123'});
  for(const attachments of [[{name:'../bad',base64:'YQ=='}],[{name:'empty',base64:''}],[{name:'bad',base64:'???'}],Array(11).fill({name:'x',base64:'YQ=='}),[{name:'large',base64:Buffer.alloc(2*1024*1024+1).toString('base64')} ]])assert.throws(()=>store.saveReviewerBoardPost(actor,{...input(),attachments}));
  assert.throws(()=>store.saveReviewerBoardPost({...actor,site_id:site.id+1},input()),/활성/);assert.throws(()=>store.saveReviewerBoardPost(actor,{...input(),kind:'notice'}),/권한/);
  let count=0;assert.throws(()=>store.saveReviewerBoardPost(actor,input(),null,()=>{if(++count===2)throw Error('세션 만료');}),/세션 만료/);assert.equal(store.boardPosts('general').length,0);
  const row=store.saveReviewerBoardPost(actor,input());assert.deepEqual(row.rich_body,styledBody());assert.deepEqual(store.reviewerBoardPosts(actor,'general')[0].rich_body,styledBody());assert.deepEqual(JSON.parse(store.db.prepare('SELECT rich_body FROM board_posts WHERE id=?').get(row.id).rich_body),styledBody());assert.equal(store.saveReviewerBoardPost(actor,input()).id,row.id);assert.throws(()=>store.saveReviewerBoardPost(actor,input(),null,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.boardAttachments(row.id,row.version,actor).length,2);const site2=store.createSite({name:'다른 가상 현장'}),other=store.createReviewer({siteId:site2.id,loginId:'virtual_other',name:'다른 가상 작성자',password:'virtual-password-123'}),otherRow=store.saveReviewerBoardPost(other,input());assert.notEqual(otherRow.id,row.id);assert.equal(otherRow.author_id,other.id);assert.equal(store.saveReviewerBoardPost(other,input()).id,otherRow.id);const another=store.saveReviewerBoardPost(actor,input('d'.repeat(32)));assert.notEqual(another.id,row.id);assert.equal(store.boardPosts('general').length,3);
 }finally{store.close();}
});
test('신규 첨부 UI 대역: 파일 보존·재시도 토큰 유지·초기화·늦은 현장 전환',async()=>{
 assert.match(boardCreateMarkup,/type="file"/);let live=true;const file=new File(['가상 파일'],'가상.txt'),control={files:[file],value:'선택'},form={querySelector:()=>control},creation=boardCreation(form,()=>live);
 const first=await creation.value(),again=await creation.value();assert.deepEqual(again,first);assert.equal(control.value,'선택');assert.equal(Buffer.from(first.attachments[0].base64,'base64').toString(),'가상 파일');
 control.files=[new File([],'빈.txt')];await assert.rejects(creation.value(),/1바이트/);assert.equal(control.value,'선택');control.files=[file];creation.reset();assert.equal(control.value,'');assert.notEqual((await creation.value()).creationToken,first.creationToken);
 let resolve;control.files=[{name:'가상.txt',size:1,arrayBuffer:()=>new Promise(done=>resolve=done)}];const pending=creation.value();live=false;resolve(new Uint8Array([1]).buffer);await assert.rejects(pending,/변경/);await assert.rejects(creation.value(),/변경/);
});
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('가상 로컬 API: 관리자·직원 새 서식 및 신규 첨부, 다운로드, 재전송 및 로그아웃', {timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-board-create-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('가상 서버 종료');})]);
  const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
  const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();await send('/api/reviewers','POST',{siteId:site.id,loginId:'new_board_author',name:'가상 작성자',password:'virtual-password-123'},admin);
  const reviewer=(await send('/api/reviewer/login','POST',{loginId:'new_board_author',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
  for(const [base,cookie] of [['/api/board-posts',admin],['/api/reviewer/board-posts',reviewer]]){
   const data={...input(),attachments:[{name:'가상 큰파일.txt',base64:Buffer.alloc(70000,65).toString('base64')}]};
   const created=await send(base,'POST',data,cookie);assert.equal(created.status,201);const row=await created.json();assert.deepEqual(row.rich_body,styledBody());const retry=await send(base,'POST',data,cookie);assert.equal(retry.status,201);const replay=await retry.json();assert.equal(replay.id,row.id);assert.deepEqual(replay.rich_body,styledBody());
   const files=await (await send(`${base}/${row.id}/attachments?version=${row.version}`,'GET',undefined,cookie)).json();assert.equal(files.length,1);const file=files[0],download=await send(`${base}/${row.id}/attachments/${file.id}?version=${row.version}&fileVersion=${file.version}`,'GET',undefined,cookie);assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,70000);
   assert.equal((await send(base,'POST',{...data,title:'변경'},cookie)).status,409);
   const invalid=await send(base,'POST',{...input('b'.repeat(32)),attachments:[{name:'../bad',base64:'YQ=='}]},cookie);assert.equal(invalid.status,400);
   const list=await (await send(base+'?kind=general','GET',undefined,cookie)).json();assert.equal(list.filter(item=>item.author_id===row.author_id).length,1);assert.deepEqual(list.find(item=>item.id===row.id).rich_body,styledBody());
  }
  assert.equal((await send('/api/reviewer/logout','POST',{},reviewer)).status,200);assert.equal((await send('/api/reviewer/board-posts','POST',input(),reviewer)).status,401);
 }finally{child.kill();await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
});
