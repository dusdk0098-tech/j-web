import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('커뮤니티 전체 보기는 분류와 공개 권한을 지키고 사내 글을 포함하지 않는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),one=make('community_one'),two=make('community_two'),input={title:'가상 제목',body:'가상 내용',secret:false};
    const hidden=store.saveBoardPost({...input,kind:'community_notice',shared:false}),notice=store.saveBoardPost({...input,kind:'community_notice',shared:true}),internal=store.saveBoardPost({...input,kind:'notice',shared:true});
    const info=store.saveReviewerBoardPost(one,{...input,kind:'community_info'}),question=store.saveReviewerBoardPost(one,{...input,kind:'community_question'}),general=store.saveReviewerBoardPost(one,{...input,kind:'community_general'});
    assert.deepEqual(store.boardPosts('community_all').map(row=>row.id),[general.id,question.id,info.id,notice.id,hidden.id]);assert.deepEqual(store.reviewerBoardPosts(two,'community_all').map(row=>row.id),[general.id,question.id,info.id,notice.id]);assert.ok(!store.reviewerBoardPosts(two,'community_all').some(row=>row.id===internal.id));assert.deepEqual(store.reviewerBoardPosts(two,'community_info').map(row=>row.id),[info.id]);assert.deepEqual(store.reviewerBoardPosts(two,'community_all','없는 검색'),[]);
    assert.throws(()=>store.saveReviewerBoardPost(one,{...input,kind:'community_notice'}),/게시판/);assert.throws(()=>store.saveReviewerBoardPost(one,{...input,kind:'community_all'}),/게시판/);assert.throws(()=>store.saveBoardPost({...input,kind:'community_all'}),/게시판/);assert.throws(()=>store.deleteReviewerBoardPost(two,'community_info',info.id,info.version),/게시글/);
    const updated=store.saveReviewerBoardPost(one,{...input,kind:'community_info',title:'수정',version:info.version},info.id);assert.equal(updated.title,'수정');store.deleteReviewerBoardPost(one,'community_info',info.id,updated.version);assert.equal(store.reviewerBoardPosts(two,'community_info').length,0);
  }finally{store.close();}
});
