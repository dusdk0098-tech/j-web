import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('게시글 첨부는 읽기·작성 권한, 버전, 개수 제한과 삭제를 지킨다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),one=make('files_one'),two=make('files_two'),post=store.saveReviewerBoardPost(one,{kind:'community_info',title:'정보',body:'내용',secret:false}),bytes=Buffer.from('가상 자료');
    assert.throws(()=>store.addBoardAttachment(post.id,post.version,'다른 글.txt',bytes,two),/권한/);assert.throws(()=>store.addBoardAttachment(post.id,post.version,'../bad',bytes,one),/이름/);assert.throws(()=>store.addBoardAttachment(post.id,post.version,'빈 파일',Buffer.alloc(0),one),/파일/);
    const id=store.addBoardAttachment(post.id,post.version,'가상 자료.txt',bytes,one).id,file=store.boardAttachments(post.id,post.version,two)[0];assert.equal(file.id,id);assert.equal(file.size,bytes.length);assert.deepEqual(Buffer.from(store.boardAttachment(post.id,id,post.version,file.version,two).data),bytes);assert.throws(()=>store.deleteBoardAttachment(post.id,id,post.version,file.version,two),/권한/);assert.throws(()=>store.boardAttachment(post.id,id,post.version,'old',two),/변경/);
    for(let i=1;i<10;i++)store.addBoardAttachment(post.id,post.version,`${i}.txt`,bytes,one);assert.throws(()=>store.addBoardAttachment(post.id,post.version,'초과.txt',bytes,one),/10개/);assert.throws(()=>store.deleteBoardAttachment(post.id,id,post.version,file.version,one,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.boardAttachments(post.id,post.version,one).length,10);store.deleteBoardPost(post.kind,post.id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM board_attachments').get().n,0);
    const granted=store.setReviewerNoticeWrite(site.id,one.id,{enabled:true,expectedVersion:''}),notice=store.saveReviewerBoardPost(one,{kind:'notice',title:'공지',body:'내용',secret:false}),noticeFile=store.addBoardAttachment(notice.id,notice.version,'공지.txt',bytes,one).id,noticeVersion=store.boardAttachments(notice.id,notice.version,one)[0].version;store.setReviewerNoticeWrite(site.id,one.id,{enabled:false,expectedVersion:granted.version});assert.throws(()=>store.addBoardAttachment(notice.id,notice.version,'추가.txt',bytes,one),/권한/);assert.throws(()=>store.deleteBoardAttachment(notice.id,noticeFile,notice.version,noticeVersion,one),/권한/);assert.equal(store.boardAttachments(notice.id,notice.version,one).length,1);
  }finally{store.close();}
});
