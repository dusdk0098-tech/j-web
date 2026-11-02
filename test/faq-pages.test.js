import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,createContext} from 'node:vm';
import {faqPage,faqPager} from '../public/faq-pages.js';
const generated=Array.from({length:23},(_,i)=>({id:i+1,title:`가상 ${i+1}`,body:`본문 ${i+1}`,category:i<12?'서비스이용':'결제',shared:true,version:`v${i+1}`}));
class Surface{
  constructor(){this.nodes={};this.articles=[];this.isConnected=true;}
  set innerHTML(value){this.html=value;this.articles=[...value.matchAll(/<article>(.*?)<\/article>/gs)].map(match=>({html:match[0],querySelector:()=>({replaceWith(body){this.body=body;},prepend(){}})}));this.nodes={};}
  get innerHTML(){return this.html||'';}
  set textContent(value){this.innerHTML=value;}
  insertAdjacentHTML(_position,value){this.html+=value;}
  querySelector(selector){return this.nodes[selector]??={};}
  querySelectorAll(selector){if(selector==='article')return this.articles;if(selector==='[data-board-delete]')return this.nodes[selector]??=[...this.innerHTML.matchAll(/data-board-delete="(\d+)"/g)].map(match=>({dataset:{boardDelete:match[1]}}));if(selector==='[data-delete]')return this.nodes[selector]??=[...this.innerHTML.matchAll(/data-delete="(\d+)"/g)].map(match=>({dataset:{delete:match[1]}}));return [];}
}
function harness(role){
  const source=readFileSync(new URL(role==='admin'?'../public/app.js':'../public/board-view.js',import.meta.url),'utf8');
  const surface=new Surface(),options=[],bodies=[],nodes={},context=createContext({faqPage,faqPager,URLSearchParams,Promise,esc:String,JSON,Number,confirm:()=>true,document:{createElement:()=>({}),createTextNode:value=>value},richBody:(_rich,body)=>{bodies.push(body);return body;},boardImageLimits:()=>({}),mountBoardComments:(_node,value)=>options.push(value),mountBoardAttachments:(_node,value)=>options.push(value),showError:error=>{throw error;}});
  let rows=generated,active=true,renders=0;
  Object.assign(context,{api:async()=>rows,content:surface,list:surface,$:selector=>nodes[selector]??={},render:async()=>{renders++;},detailEpoch:1,renderEpoch:1,state:{page:'board',boardKind:'faq',boardCategory:'',query:'',siteId:1},live:()=>active,actorId:77,kind:{value:'faq'},query:{value:''},category:{value:''},form:{elements:{title:{value:''}},querySelector:()=>({files:[]})},editor:{plain:()=>''},cancel:{},fieldset:{},status:{textContent:''},busy:false,editing:null,reset(){},sync(){},target:{querySelector:selector=>nodes[selector]??={}}});
  let code;
  if(role==='admin'){
    const a=source.indexOf("  if(state.page==='board'){");code='(async()=>{'+source.slice(a,source.indexOf("  if(state.page==='schedules'){",a))+'})();';
  }else{
    const a=source.indexOf('  const load=');runInNewContext('let sequence=0,faqPageNumber=1,canWriteNotice=false,currentKind="faq";'+source.slice(a,source.indexOf('  form.onsubmit=',a)),context);code='load();';
  }
  return {surface,context,options,bodies,nodes,load:()=>runInNewContext(code,context),setRows:value=>{rows=value;},setActive:value=>{active=value;},get renders(){return renders;},page:()=>role==='admin'?context.state.faqPage:runInNewContext('faqPageNumber',context),setPage:value=>{if(role==='admin')context.state.faqPage=value;else runInNewContext(`faqPageNumber=${value}`,context);}};
}
for(const role of ['admin','staff'])test(`${role} FAQ 가상 UI: 23건 페이지 이동·표시 행 연결·초기화·권한·빈 마지막 페이지`,async()=>{
  const h=harness(role);await h.load();assert.equal(h.surface.articles.length,10);assert.match(h.surface.innerHTML,/현재 1 \/ 총 3 페이지/);assert.match(h.surface.innerHTML,/data-faq-prev disabled/);assert.match(h.surface.innerHTML,/aria-label="FAQ 페이지 이동"/);
  const first=h.options[0];assert.equal(first.row.id,1);assert.equal(first.active(),true);
  await h.surface.querySelector('[data-faq-next]').onclick();if(role==='admin')await h.load();assert.equal(h.page(),2);assert.equal(h.options.at(-1).row.id,20);assert.deepEqual(h.bodies.slice(-10),generated.slice(10,20).map(row=>row.body));assert.equal(first.active(),false);
  await h.surface.querySelector('[data-faq-next]').onclick();if(role==='admin')await h.load();assert.equal(h.page(),3);assert.equal(h.surface.articles.length,3);assert.match(h.surface.innerHTML,/data-faq-next disabled/);assert.equal(h.options.at(-1).row.id,23);
  await h.surface.querySelector('[data-faq-next]').onclick();assert.equal(h.page(),3);
  await h.surface.querySelector('[data-faq-prev]').onclick();if(role==='admin')await h.load();assert.equal(h.page(),2);
  h.setPage(3);h.setRows(generated.slice(0,20));await h.load();assert.equal(h.page(),2);assert.equal(h.surface.articles.length,10);
  h.setRows([]);await h.load();assert.equal(h.page(),1);assert.equal(h.surface.articles.length,0);assert.match(h.surface.innerHTML,/현재 1 \/ 총 1 페이지/);assert.match(h.surface.innerHTML,/data-faq-next disabled/);
  h.setPage(3);if(role==='admin'){h.nodes['#board-category'].onchange({target:{value:'결제'}});}else{h.context.category.value='결제';await h.context.category.onchange();}assert.equal(h.page(),1);
  h.setPage(3);if(role==='admin'){h.context.$('#board-query').value='검색';h.nodes['#board-search'].onclick();}else{h.context.query.value='검색';await h.nodes['[data-search]'].onclick();}assert.equal(h.page(),1);
  h.setPage(3);if(role==='admin'){h.nodes['#board-kind'].onchange({target:{value:'notice'}});}else{h.context.kind.value='notice';h.context.kind.onchange();}assert.equal(h.page(),1);
  h.setRows(generated);await h.load();assert.equal(h.surface.articles.length,23);assert.doesNotMatch(h.surface.innerHTML,/FAQ 페이지 이동/);
});

for(const role of ['admin','staff'])test(`${role} 커뮤니티: 상단 안내 유지·15건 페이지 이동·오래된 화면 차단`,async()=>{
  const h=harness(role),top=[{id:91,kind:'community_info',title:'상단 하나',body:'안내',highlighted:1},{id:92,kind:'community_general',title:'상단 둘',body:'안내',highlighted:1}],normal=Array.from({length:32},(_,i)=>({id:i+1,kind:'community_info',title:`가상 글 ${i+1}`,body:'내용',highlighted:0}));
  if(role==='admin')h.context.state.boardKind='community_all';else h.context.kind.value='community_all';h.setRows([...normal,...top]);await h.load();assert.equal(h.surface.articles.length,17);assert.match(h.surface.innerHTML,/커뮤니티 페이지 이동/);assert.match(h.surface.innerHTML,/현재 1 \/ 총 3 페이지/);assert.equal(h.options[0].row.id,91);
  const previous=h.options[0];await h.surface.querySelector('[data-faq-next]').onclick();if(role==='admin')await h.load();assert.equal(previous.active(),false);assert.equal(h.page(),2);assert.equal(h.surface.articles.length,17);assert.equal(h.options.at(-1).row.id,30);
  await h.surface.querySelector('[data-faq-next]').onclick();if(role==='admin')await h.load();assert.equal(h.page(),3);assert.equal(h.surface.articles.length,4);assert.equal(h.options.at(-1).row.id,32);
  h.setRows(top);if(role==='admin')h.context.state.query='무일치';else h.context.query.value='무일치';await h.load();assert.equal(h.page(),1);assert.equal(h.surface.articles.length,2);assert.match(h.surface.innerHTML,/상단 하나/);
});

for(const role of ['admin','staff'])test(`${role} 커뮤니티: 페이지를 바꾸면 이전 삭제 버튼과 응답은 새 화면에 영향을 주지 않는다`,async()=>{
  const h=harness(role),rows=Array.from({length:20},(_,i)=>({id:i+1,author_id:77,kind:'community_info',title:`가상 글 ${i+1}`,body:'본문',version:`v${i+1}`}));
  if(role==='admin')h.context.state.boardKind='community_info';else h.context.kind.value='community_info';
  h.setRows(rows);let deletes=0,resolveDelete;h.context.api=(_url,options)=>options?.method==='DELETE'?(deletes++,new Promise(resolve=>{resolveDelete=resolve;})):Promise.resolve(rows);
  await h.load();const selector=role==='admin'?'[data-board-delete]':'[data-delete]',old=h.surface.querySelectorAll(selector)[0];h.setPage(2);await old.onclick();assert.equal(deletes,0);
  h.setPage(1);await h.load();const pending=h.surface.querySelectorAll(selector)[0].onclick();assert.equal(deletes,1);h.setPage(2);await h.load();const before=h.surface.innerHTML;resolveDelete();await pending;
  assert.equal(h.page(),2);assert.equal(h.surface.innerHTML,before);assert.equal(h.renders,0);assert.equal(h.context.status.textContent,'');
});

test('새 커뮤니티 분류는 관리자·직원 목록과 작성 권한에 연결된다',async()=>{
  const rows=[['community_event','이벤트'],['community_resources','자료실'],['community_market','직거래장터']].map(([kind,label],i)=>({id:i+1,kind,title:`가상 ${label}`,body:'내용',author_id:77,version:'v'}));
  const admin=harness('admin');admin.context.state.boardKind='community_all';admin.setRows(rows);await admin.load();for(const row of rows)assert.match(admin.surface.innerHTML,new RegExp(`value="${row.kind}"`));
  const staff=harness('staff');staff.context.kind.value='community_all';staff.setRows(rows);await staff.load();for(const row of rows)assert.match(staff.surface.innerHTML,new RegExp(row.title));assert.match(staff.surface.innerHTML,/이벤트 · 가상 이벤트/);assert.match(staff.surface.innerHTML,/자료실 · 가상 자료실/);assert.match(staff.surface.innerHTML,/직거래장터 · 가상 직거래장터/);
  for(const row of rows){staff.context.kind.value=row.kind;staff.setRows([row]);await staff.load();assert.equal(staff.surface.innerHTML.includes('data-edit='),row.kind!=='community_event');}
  const source=readFileSync(new URL('../public/board-view.js',import.meta.url),'utf8'),optionStart=source.indexOf('  kind.insertAdjacentHTML('),optionEnd=source.indexOf('\n',optionStart),choice={insertAdjacentHTML(_where,html){this.html=html;}};assert.ok(optionStart>=0);runInNewContext(source.slice(optionStart,optionEnd),{kind:choice});for(const row of rows)assert.match(choice.html,new RegExp(`value="${row.kind}"`));
  const syncStart=source.indexOf('sync=()=>{categoryLabel.hidden='),syncEnd=source.indexOf('};\n  const load=',syncStart);assert.ok(syncStart>=0&&syncEnd>syncStart);
  for(const row of rows){const context={kind:{value:row.kind},categoryLabel:{},secretLabel:{},form:{elements:{secret:{}}},canWriteNotice:false};runInNewContext(`let ${source.slice(syncStart,syncEnd+1)};sync();`,context);assert.equal(context.form.hidden,row.kind==='community_event');}
});
for(const role of ['admin','staff'])test(`${role} FAQ 가상 UI: 역순 응답·분류·현장 또는 화면 이탈 후 무효화`,async()=>{
  const h=harness(role);await h.load();const original=h.options[0];let resolves=[];h.context.api=()=>new Promise(resolve=>resolves.push(resolve));
  const older=h.load();if(role==='admin'){h.context.detailEpoch++;h.context.renderEpoch++;}const newer=h.load();resolves[1]([generated[22]]);await newer;resolves[0]([generated[0]]);await older;assert.match(h.surface.innerHTML,/가상 23/);assert.doesNotMatch(h.surface.innerHTML,/가상 1<\/h3>/);assert.equal(original.active(),false);
  const selected=h.options.at(-1);if(role==='admin')h.context.state.boardCategory='결제';else h.context.category.value='결제';assert.equal(selected.active(),false);
  const pending=h.load();if(role==='admin')h.context.state.siteId=2;else h.setActive(false);h.surface.innerHTML='새 현장';resolves.at(-1)(generated);await pending;assert.equal(h.surface.innerHTML,'새 현장');
});
test('FAQ 페이지 범위는 빈 목록·음수·큰 값·비정수 요청을 안전하게 보정한다',()=>{
  for(const value of [0,-1,NaN,Infinity,'2',1.5])assert.equal(faqPage(generated,value).page,1);assert.equal(faqPage(generated,99).page,3);assert.equal(faqPage([],99).total,1);
});

test('관리자 FAQ 실제 삭제 핸들러: 마지막 한 건 삭제 후 3에서 2페이지로 보정',async()=>{
 const h=harness('admin');h.setRows(generated.slice(0,21));h.setPage(3);await h.load();let deleted;h.context.api=async(url,options)=>{assert.equal(options.method,'DELETE');deleted={url,body:JSON.parse(options.body)};h.setRows(generated.slice(0,20));};await h.surface.querySelectorAll('[data-board-delete]')[0].onclick();assert.match(deleted.url,/21$/);assert.equal(deleted.body.expectedVersion,'v21');assert.equal(h.renders,1);h.context.api=async()=>generated.slice(0,20);await h.load();assert.equal(h.page(),2);assert.equal(h.surface.articles.length,10);
});

for(const role of ['admin','staff'])test(role+' 상단 안내 DOM 대역: 페이지·무일치·중복 제외·오류·이탈',async()=>{
 const h=harness(role),top=[{...generated[0],id:99,title:'가상 상단 하나',highlighted:1},{...generated[1],id:98,title:'가상 상단 둘',highlighted:1}];h.setRows([...top,...generated]);await h.load();assert.equal(h.surface.articles.length,12);assert.match(h.surface.innerHTML,/일반 FAQ/);assert.equal((h.surface.innerHTML.match(/가상 상단 하나/g)||[]).length,1);assert.equal(h.options[0].row.id,99);
 await h.surface.querySelector('[data-faq-next]').onclick();if(role==='admin')await h.load();assert.equal(h.surface.articles.length,12);assert.equal(h.options.at(-24).row.id,99);assert.match(h.surface.innerHTML,/현재 2 \/ 총 3 페이지/);
 h.setRows(top);if(role==='admin'){h.context.state.query='무일치';h.context.state.boardCategory='결제';}else{h.context.query.value='무일치';h.context.category.value='결제';}await h.load();assert.equal(h.surface.articles.length,2);assert.equal(h.page(),1);assert.match(h.surface.innerHTML,/가상 상단 둘/);
 const prior=h.options.at(-1);h.context.api=async()=>{throw Error('가상 조회 실패');};if(role==='admin')await assert.rejects(h.load(),/가상 조회 실패/);else{await h.load();assert.match(h.surface.innerHTML,/가상 조회 실패/);}assert.doesNotMatch(h.surface.innerHTML,/가상 상단 하나/);
 if(role==='admin')h.context.state.siteId=88;else h.setActive(false);assert.equal(prior.active(),false);
});
