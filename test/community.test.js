import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
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

test('관리자 커뮤니티 작성 화면은 상단 안내 선택을 저장 요청에 포함한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('    const edit=row=>{let editor,creation,busy=false;'),end=source.indexOf("\n    $('#board-add')",start);assert.ok(start>=0&&end>start);
  const picker={isConnected:true},editable={contentEditable:'true'},root={querySelector:selector=>selector==='[data-board-image-picker]'?picker:editable,querySelectorAll:()=>[]},state={page:'board',boardKind:'community_info',siteId:1};let html,submit,request;
  const context={detailEpoch:0,state,dialog:{open:true},kind:'community_info',paged:true,$:selector=>selector==='#dialog-body'?root:{textContent:''},field:()=>'',richEditorMarkup:()=>'',boardCreateMarkup:'',boardCreation:()=>({value:async()=>({})}),showDialog:(_title,markup,callback)=>{html=markup;submit=callback;},mountRichEditor:()=>({set(){},value:()=>[]}),boardImageLimits:()=>({}),mountBoardImagePicker(){},api:async(_url,options)=>{request=JSON.parse(options.body);},JSON};
  runInNewContext(source.slice(start,end)+';edit(null);',context);assert.match(html,/name="highlighted"/);await submit({title:'가상 글',shared:'on',highlighted:'on'});assert.equal(request.kind,'community_info');assert.equal(request.shared,true);assert.equal(request.highlighted,true);
  context.row={id:3,version:'v1',highlighted:1};runInNewContext('edit(row);',context);assert.match(html,/name="highlighted" checked/);
});

test('커뮤니티의 상단 안내는 분류·공개 권한을 지키며 검색과 관계없이 남는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),author=store.createReviewer({siteId:site.id,loginId:'pin_author',name:'가상 작성자',password:'virtual-password-123'}),reader=store.createReviewer({siteId:site.id,loginId:'pin_reader',name:'가상 조회자',password:'virtual-password-123'}),base={title:'가상 제목',body:'가상 내용',secret:false};
    const publicPin=store.saveBoardPost({...base,kind:'community_info',shared:true,highlighted:true}),privatePin=store.saveBoardPost({...base,kind:'community_general',shared:false,highlighted:true}),normal=store.saveReviewerBoardPost(author,{...base,kind:'community_info',highlighted:true});
    assert.equal(normal.highlighted,0);assert.deepEqual(store.boardPosts('community_all','무일치').map(row=>row.id),[privatePin.id,publicPin.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','무일치').map(row=>row.id),[publicPin.id]);
    assert.deepEqual(store.reviewerBoardPosts(reader,'community_info','무일치').map(row=>row.id),[publicPin.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_general','무일치'),[]);
    const pinned=store.saveBoardPost({...base,kind:'community_info',shared:true,highlighted:true,expectedVersion:normal.version},normal.id),edited=store.saveReviewerBoardPost(author,{...base,kind:'community_info',version:pinned.version,title:'가상 수정'},normal.id);assert.equal(edited.highlighted,1);
    assert.throws(()=>store.saveBoardPost({...base,kind:'community_info',highlighted:false,expectedVersion:pinned.version},normal.id),error=>error.sessionStatus===409);
    const privateNow=store.saveBoardPost({...base,kind:'community_info',shared:false,expectedVersion:publicPin.version},publicPin.id);assert.equal(privateNow.highlighted,1);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','무일치').map(row=>row.id),[normal.id]);
    assert.throws(()=>store.saveBoardPost({...base,kind:'general',highlighted:true}),/상단/);
  }finally{store.close();}
});

test('커뮤니티 한 건 조회는 게시판 구분과 공개 권한을 지킨다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),author=make('detail_author'),reader=make('detail_reader');
    const published=store.saveReviewerBoardPost(author,{kind:'community_info',title:'공개 글',body:'가상 내용',secret:false}),hidden=store.saveBoardPost({kind:'community_info',title:'비공개 글',body:'가상 내용',secret:false,shared:false}),other=store.saveBoardPost({kind:'community_general',title:'다른 게시판',body:'가상 내용',secret:false,shared:true});
    assert.deepEqual(store.boardPosts('community_all','','',published.id).map(row=>row.id),[published.id]);assert.deepEqual(store.boardPosts('community_info','','',other.id),[]);assert.deepEqual(store.boardPosts('community_info','','',hidden.id).map(row=>row.id),[hidden.id]);
    assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','','',published.id).map(row=>row.id),[published.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','','',hidden.id),[]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_info','','',other.id),[]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','','',999999),[]);
    for(const invalid of ['',0,'-1','1e2','1.2','1 OR 1=1',Number.MAX_SAFE_INTEGER+1]){assert.throws(()=>store.boardPosts('community_all','','',invalid),/번호/);assert.throws(()=>store.reviewerBoardPosts(reader,'community_all','','',invalid),/번호/);}
  }finally{store.close();}
});

test('새 커뮤니티 분류는 전체 목록·검색·상단 표시와 작성 권한을 지킨다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=id=>store.createReviewer({siteId:site.id,loginId:id,name:id,password:'virtual-password-123'}),author=make('extra_author'),reader=make('extra_reader'),base={title:'가상 제목',body:'가상 내용',secret:false};
    const event=store.saveBoardPost({...base,kind:'community_event',shared:true,highlighted:true}),resource=store.saveReviewerBoardPost(author,{...base,kind:'community_resources'}),market=store.saveReviewerBoardPost(author,{...base,kind:'community_market'}),hidden=store.saveBoardPost({...base,kind:'community_market',shared:false,highlighted:true});
    assert.deepEqual(store.boardPosts('community_all').map(row=>row.id),[hidden.id,market.id,resource.id,event.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all').map(row=>row.id),[market.id,resource.id,event.id]);
    assert.deepEqual(store.boardPosts('community_all','없는 검색').map(row=>row.id),[hidden.id,event.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_all','없는 검색').map(row=>row.id),[event.id]);
    assert.deepEqual(store.reviewerBoardPosts(reader,'community_resources').map(row=>row.id),[resource.id]);assert.deepEqual(store.reviewerBoardPosts(reader,'community_market').map(row=>row.id),[market.id]);
    assert.throws(()=>store.saveReviewerBoardPost(author,{...base,kind:'community_event'}),/게시판/);assert.throws(()=>store.deleteReviewerBoardPost(reader,'community_market',market.id,market.version),/게시글/);
    const updated=store.saveReviewerBoardPost(author,{...base,kind:'community_resources',title:'수정',version:resource.version},resource.id);assert.equal(updated.title,'수정');store.deleteReviewerBoardPost(author,'community_resources',resource.id,updated.version);assert.deepEqual(store.reviewerBoardPosts(reader,'community_resources'),[]);
  }finally{store.close();}
});
