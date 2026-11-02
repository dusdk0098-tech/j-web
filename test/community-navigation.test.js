import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {communityHash,readCommunityHash,followCommunityLink,confirmCommunityLeave} from '../public/community-navigation.js';

test('커뮤니티 주소는 분류·검색·페이지·선택 글을 안전하게 왕복한다',()=>{
  const route={kind:'community_info',query:'가상 & <검색> + 1',page:3,id:42},hash=communityHash(route);
  assert.deepEqual(readCommunityHash(hash),route);assert.ok(!hash.includes('<'));assert.deepEqual(readCommunityHash(communityHash({...route,id:null})),{...route,id:null});
  for(const hash of ['','#community?kind=notice','#community?kind=community_info&id=0','#community?kind=community_info&page=-1','#community?kind=community_info&id=9007199254740992','#community?kind=community_info&id=1&id=2','#community?kind=community_info&q='+('x'.repeat(201))])assert.equal(readCommunityHash(hash),null);
});

test('일반 클릭만 화면 전환으로 처리하고 새 탭 클릭은 브라우저에 맡긴다',()=>{
  let prevented=0;const click={button:0,preventDefault(){prevented++;}};assert.equal(followCommunityLink(click),true);assert.equal(prevented,1);
  for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])assert.equal(followCommunityLink({...click,...modifier}),false);
  assert.equal(prevented,1);
});

test('작성 중인 댓글과 선택한 첨부가 있으면 이동 전에 확인한다',()=>{
  let text='',files=[];const target={querySelectorAll:selector=>selector==='article textarea'?[{value:text}]:[{files}]};let prompts=0;const reject=()=>{prompts++;return false;};assert.equal(confirmCommunityLeave(target,reject),true);text='작성 중';assert.equal(confirmCommunityLeave(target,reject),false);text='';files=[{}];assert.equal(confirmCommunityLeave(target,reject),false);assert.equal(prompts,2);assert.equal(confirmCommunityLeave(target,()=>true),true);
});

test('관리자 로그인 성공 후 검증된 글 주소만 복원한다',async()=>{
  const source=readFileSync(new URL('../public/login.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
  for(const hash of [communityHash({kind:'community_info',query:'가상',page:2,id:9}),'#다른주소']){
    const button={},form={elements:{loginId:{value:'virtual'},password:{value:'virtual-password'}},querySelector:()=>button},location={hash,assign:value=>{location.destination=value;}},context={document:{querySelector:selector=>selector==='#login-form'?form:{}},fetch:async()=>({ok:true,json:async()=>({})}),location,readCommunityHash,JSON};
    runInNewContext(source,context);await form.onsubmit({preventDefault(){}});assert.equal(location.destination,'/'+(readCommunityHash(hash)?hash:''));assert.equal(button.disabled,true);
  }
});

test('관리자 세션이 만료되어도 검증된 글 주소를 로그인 화면에 전달한다',async()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),a=app.indexOf('async function api('),b=app.indexOf('function flash(',a),hash=communityHash({kind:'community_info',id:9}),location={hash,assign:value=>{location.destination=value;}},context={location,readCommunityHash,dialog:{open:false},document:{querySelector:()=>null},fetch:async()=>({status:401,ok:false,json:async()=>({})})};assert.ok(a>=0&&b>a);runInNewContext(app.slice(a,b),context);await assert.rejects(context.api('/api/board-posts'),/로그인/);assert.equal(location.destination,'/login'+hash);
});

test('공유 주소는 로그인된 관리자 권한과 직원 화면의 초기 상태에 적용된다',()=>{
  const hash=communityHash({kind:'community_resources',query:'가상 자료',page:2,id:12}),route=readCommunityHash(hash),app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),staff=readFileSync(new URL('../public/board-view.js',import.meta.url),'utf8');
  const init=app.match(/const communityRoute=readCommunityHash\(location\.hash\);if\(communityRoute&&state\.admin\.scope==='global'\)applyCommunityRoute\(communityRoute\);/);assert.ok(init);const start=app.indexOf('function applyCommunityRoute('),end=app.indexOf("window.addEventListener('hashchange'",start),apply=app.slice(start,end);
  for(const scope of ['global','restricted']){const state={page:'dashboard',admin:{scope}},context={state,location:{hash},readCommunityHash};runInNewContext(apply+init[0],context);assert.equal(state.page,scope==='global'?'board':'dashboard');if(scope==='global')assert.equal(state.communityPostId,route.id);}
  const a=staff.indexOf('  const initialRoute=readCommunityHash(location.hash);'),b=staff.indexOf('\n',a);assert.ok(a>=0);const context={location:{hash},readCommunityHash,kind:{value:'notice'},query:{value:''}};const result=runInNewContext('let faqPageNumber=1,communityPostId=null,currentKind=kind.value;'+staff.slice(a,b)+';({kind:kind.value,query:query.value,page:faqPageNumber,id:communityPostId,currentKind});',context);assert.equal(result.kind,route.kind);assert.equal(result.query,route.query);assert.equal(result.page,route.page);assert.equal(result.id,route.id);assert.equal(result.currentKind,route.kind);
});
