import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function screen(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function render(){'),end=source.indexOf("\n  if(state.admin?.scope==='restricted'){",start);assert.ok(start>=0&&end>start);
  const scrolls=[],state={page:'statistics',siteId:1,detail:null,admin:{scope:'global'}},context={state,content:{},dialog:{open:false},siteEducationCleanup:null,permitRoleCleanup:null,detailEpoch:0,workerListEpoch:0,sitePhotoEpoch:0,document:{querySelector:()=>null,querySelectorAll:()=>[]},closeContractPreview(){},loadSites:async()=>{},labels:{},$:()=>({}),window:{scrollTo:(...args)=>scrolls.push(args)}};
  runInNewContext(source.slice(start,end)+'}',context);return {context,state,scrolls};
}

test('다른 메뉴·현장·문서로 이동하면 상단으로 가고 같은 화면 갱신은 위치를 유지한다',async()=>{
  const {context,state,scrolls}=screen();await context.render();assert.deepEqual(scrolls,[[0,0]]);await context.render();assert.equal(scrolls.length,1);
  for(const change of [()=>state.page='site-activity',()=>state.siteId=2,()=>state.detail=42,()=>state.detail=null,()=>{state.page='board';state.boardKind='community_general';},()=>state.communityPostId=7]){change();const before=scrolls.length;await context.render();assert.equal(scrolls.length,before+1);await context.render();assert.equal(scrolls.length,before+1);}
});

test('새 화면이 그려진 뒤 도착한 이전 현장 응답은 스크롤을 다시 바꾸지 않는다',async()=>{
  const {context,state,scrolls}=screen();let release;context.loadSites=()=>new Promise(resolve=>{release=resolve;});const old=context.render();context.loadSites=async()=>{};state.siteId=2;await context.render();assert.equal(scrolls.length,1);release();await old;assert.equal(scrolls.length,1);
});
