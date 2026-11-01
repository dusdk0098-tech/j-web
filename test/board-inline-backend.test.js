import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {PNG} from 'pngjs';

for(const role of ['관리자','직원'])test(`${role}: 본문 이미지 소유권·버전·형식·삭제·구형 요청을 검증한다`,()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'이미지 시험'}),actor=store.createReviewer({siteId:site.id,loginId:'inline_author',name:'작성자',password:'virtual-password-123'});
    const base={kind:'general',title:'이미지 본문',body:'내용',secret:false};
    const save=(input,id=null)=>role==='관리자'?store.saveBoardPost(input,id):store.saveReviewerBoardPost(actor,input,id);
    const version=post=>({expectedVersion:post.version,version:post.version});
    let post=save(base);const other=save({...base,title:'다른 글'});
    const png=PNG.sync.write(new PNG({width:1,height:1}));
    const attach=(target,name,data)=>{const {id}=store.addBoardAttachment(target.id,target.version,name,data);return store.boardAttachments(target.id,target.version).find(file=>file.id===id);};
    const file=attach(post,'사진.png',png),foreign=attach(other,'다른 사진.png',png),plain=attach(post,'가짜.png',Buffer.from('일반 파일'));
    const image=file=>({type:'image',attachmentId:file.id,fileVersion:file.version,alt:'현장 사진'});
    const rich=file=>[{type:'p',children:[{type:'strong',children:[{type:'text',value:'내용'}]},image(file)]}];
    const failed=(bodyRich,pattern)=>{assert.throws(()=>save({...base,...version(post),bodyRich},post.id),pattern);assert.equal(store.boardPosts('general').find(row=>row.id===post.id).version,post.version);};
    failed(rich(foreign),/이 게시글/);
    failed(rich({...file,version:'0'.repeat(32)}),error=>error.sessionStatus===409);
    failed(rich(plain),/PNG, JPEG, WebP/);
    assert.throws(()=>save({...base,bodyRich:rich(file)}),/먼저 저장/);
    post=save({...base,...version(post),bodyRich:rich(file)},post.id);
    assert.deepEqual(post.rich_body,rich(file));assert.match(post.body,/내용/);
    assert.throws(()=>store.deleteBoardAttachment(post.id,file.id,post.version,file.version),/본문에서 사용/);
    assert.equal(store.boardAttachments(post.id,post.version).length,2);
    assert.throws(()=>save({...base,...version(post),body:'서식 손실'},post.id),error=>error.sessionStatus===409);
    const before=post;post=save({...base,...version(post),body:post.body,title:'구형 제목 수정'},post.id);
    assert.deepEqual(post.rich_body,before.rich_body);
    assert.throws(()=>save({...base,...version(before),bodyRich:rich(file)},post.id),error=>error.sessionStatus===409);
    const unauthorized=()=>{throw Error('세션 만료');};
    assert.throws(()=>role==='관리자'?store.saveBoardPost({...base,...version(post),bodyRich:rich(file)},post.id,unauthorized):store.saveReviewerBoardPost(actor,{...base,...version(post),bodyRich:rich(file)},post.id,unauthorized),/세션 만료/);
    assert.equal(store.boardPosts('general').find(row=>row.id===post.id).version,post.version);
    post=save({...base,...version(post),bodyRich:[{type:'text',value:'이미지 제거'}]},post.id);
    store.deleteBoardAttachment(post.id,file.id,post.version,file.version);
    assert.equal(store.boardAttachments(post.id,post.version).some(row=>row.id===file.id),false);
  }finally{store.close();}
});
