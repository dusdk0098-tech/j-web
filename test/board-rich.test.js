import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';
import {normalizeRichText,richTextToPlain} from '../public/rich-text.js';
import {richBody} from '../public/rich-editor.js';

test('이전 게시글 이관과 서식 저장·검색·수정은 본문과 권한을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-rich-')),path=join(dir,'data.sqlite');let store=new Store(path);try{
    const site=store.createSite({name:'가상'}),actor=store.createReviewer({siteId:site.id,loginId:'rich_author',name:'가상 작성자',password:'virtual-password-123'}),legacy=store.saveBoardPost({kind:'notice',title:'기존',body:'기존 내용',secret:false});store.close();let db=new DatabaseSync(path);db.exec('ALTER TABLE board_posts DROP COLUMN rich_body');db.close();store=new Store(path);assert.equal(store.boardPosts('notice')[0].rich_body,null);assert.equal(store.boardPosts('notice')[0].id,legacy.id);
    const rich=[{type:'p',children:[{type:'strong',children:[{type:'text',value:'가상 서식'}]},{type:'text',value:' <script>안전</script>'}]}],base={kind:'community_info',title:'서식 글',bodyRich:rich,secret:false},post=store.saveReviewerBoardPost(actor,base);assert.deepEqual(post.rich_body,normalizeRichText(rich));assert.equal(post.body,richTextToPlain(rich));assert.equal(store.reviewerBoardPosts(actor,'community_info','가상 서식')[0].id,post.id);const html=richBody(post.rich_body,post.body);assert.match(html,/<strong>가상 서식<\/strong>/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
    assert.throws(()=>store.saveReviewerBoardPost(actor,{...base,bodyRich:[{type:'a',href:'javascript:alert(1)',children:[]}]}),/링크/);assert.throws(()=>store.saveReviewerBoardPost(actor,{kind:base.kind,title:'변경',body:'서식 손실',secret:false,version:post.version},post.id),error=>error.sessionStatus===409);const preserved=store.saveReviewerBoardPost(actor,{kind:base.kind,title:'제목 변경',body:post.body,secret:false,version:post.version},post.id);assert.deepEqual(preserved.rich_body,post.rich_body);assert.throws(()=>store.saveBoardPost({kind:base.kind,title:'관리자',body:'손실',secret:false,expectedVersion:preserved.version},post.id),error=>error.sessionStatus===409);
    store.close();store=new Store(path);assert.deepEqual(store.boardPosts(base.kind)[0].rich_body,post.rich_body);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
