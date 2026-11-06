import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { closeContractPreview } from '../public/contract-profile-view.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end);};
const record=name=>({equipment:['가상 안전모'],profile:{phone:name,address:'가상 주소'},created_at:'2026-11-01',has_signature:true});

// shortcut: 실제 앱 핸들러와 가상 DOM·지연 응답으로 검증하며 화면 배치는 브라우저 시험이 필요하다.
function screen(){
  const nodes=new Map(),requests=[],errors=[],flashes=[],redirects=[],pages=['workers','dashboard'].map(page=>({dataset:{page}})),buttons=[];
  const node=()=>({textContent:'',innerHTML:'',classList:{remove(){},toggle(){}},setAttribute(){}});
  for(const key of ['#dialog-form','#dialog-form button[type=submit]','#dialog-title','#dialog-body','#dialog-error','#dialog-close','#dialog-cancel','#sidebar','#menu-toggle'])nodes.set(key,node());
  const state={page:'workers',siteId:1},siteSelect={value:'1'},dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const document={querySelector:()=>null,querySelectorAll:selector=>selector==='[data-page]'?pages:buttons,createElement:node};
  const context={state,siteSelect,dialog,document,closeContractPreview,content:{...node(),innerHTML:"가상 이전 화면"},$:key=>nodes.get(key),fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve:data=>resolve({status:200,ok:true,json:async()=>data}),reject,http:status=>resolve({status,ok:false,json:async()=>({error:'가상 HTTP 오류'})})})),showError:error=>errors.push(error.message),flash:message=>flashes.push(message),location:{assign:path=>redirects.push(path)},FormData:class{constructor(){return [];}}};
  const renderIntro=slice('async function render(){','  await loadSites();');
  runInNewContext([
    source.match(/^let sitePhotoEpoch=.*$/m)[0],
    'let permitRoleCleanup=null,siteEducationCleanup=null;',source.match(/^const esc = .*$/m)[0],
    slice('async function api(','function flash('),
    slice('function showDialog(',"$('#menu-toggle').onclick"),
    renderIntro+'}',
    source.split('\n').find(line=>line.startsWith("document.querySelectorAll('[data-page]').forEach(button=>button.onclick=")),
    source.split('\n').find(line=>line.startsWith('siteSelect.onchange=')),
    slice('async function showJoinRecord(','async function showPpeRecords('),
    'const logout={};'+slice('logout.onclick=',';document.querySelector(\'.top\')')+';globalThis.logout=logout;',
    'globalThis.bind=function(workers){const siteId=state.siteId,epoch=workerListEpoch;'+source.split('\n').find(line=>line.includes("view.textContent='가입 기록'"))+'};'
  ].join('\n'),context);
  const ui={context,state,dialog,requests,errors,flashes,redirects,nodes,open:id=>context.showJoinRecord({id}),
    site:id=>{siteSelect.value=String(id);siteSelect.onchange();},page:page=>pages.find(button=>button.dataset.page===page).onclick(),
    other:()=>context.showDialog('다른 창','다른 창 내용',async()=>{}),close:()=>nodes.get('#dialog-close').onclick(),
    cancel:()=>nodes.get('#dialog-cancel').onclick(),logout:()=>context.logout.onclick(),
    snapshot:()=>({open:dialog.open,title:nodes.get('#dialog-title').textContent,html:nodes.get('#dialog-body').innerHTML,error:nodes.get('#dialog-error').textContent,submit:nodes.get('#dialog-form').onsubmit,redirects:[...redirects]}),
    bind:id=>{let view;buttons.splice(0,buttons.length,{dataset:{editWorker:String(id)},after:button=>{view=button;}});context.bind([{id}]);return ()=>view.onclick();}
  };
  return ui;
}

function settle(request,outcome,name='이전 가상 전화'){if(outcome==='성공')request.resolve(record(name));else if(outcome==='401')request.http(401);else request.reject(Error(name));}

for(const outcome of ['성공','오류','401']){
  for(const otherSite of [false,true])test(`${otherSite?'다른 현장':'같은 현장'}의 최신 가입기록 뒤 늦은 ${outcome}은 개인정보와 서명을 바꾸지 않는다`,async()=>{
    const ui=screen(),old=ui.open(11);if(otherSite)ui.site(2);const latest=ui.open(22);
    ui.requests[1].resolve(record('새 가상 전화'));await latest;const before=ui.snapshot();
    assert.match(before.html,/새 가상 전화/);assert.match(before.html,new RegExp(`/api/workers/22/join-record/signature\\?siteId=${otherSite?2:1}`));
    settle(ui.requests[0],outcome);await old;assert.deepEqual(ui.snapshot(),before);assert.deepEqual(ui.errors,[]);
  });
  test(`같은 현장 연속 선택 중 먼저 도착한 이전 ${outcome}도 표시하지 않는다`,async()=>{
    const ui=screen(),old=ui.open(11),latest=ui.open(22);settle(ui.requests[0],outcome);await old;
    assert.equal(ui.dialog.open,false);assert.deepEqual(ui.errors,[]);ui.requests[1].resolve(record('최신 가상 전화'));await latest;assert.match(ui.snapshot().html,/최신 가상 전화/);
  });
  for(const [name,change] of Object.entries({
    '현장 변경':ui=>ui.site(2),
    '현장 변경 후 복귀':ui=>{ui.site(2);ui.site(1);},
    '페이지 이동':ui=>ui.page('dashboard'),
    '페이지 이동 후 복귀':ui=>{ui.page('dashboard');ui.page('workers');},
    '같은 화면 새로 그리기':ui=>ui.context.render(),
    '다른 대화상자 열기':ui=>ui.other(),
    '다른 대화상자 닫기':ui=>{ui.other();ui.close();},
    '다른 대화상자 취소':ui=>{ui.other();ui.cancel();},
    '다른 대화상자 Escape 닫기':ui=>{ui.other();ui.dialog.close();},
    '로그아웃 응답 대기':ui=>{ui.logoutPending=ui.logout();assert.equal(ui.context.content.innerHTML,'');},
    '로그아웃 완료':async ui=>{const pending=ui.logout();assert.equal(ui.context.content.innerHTML,'');ui.requests[1].resolve({});await pending;assert.equal(ui.context.content.innerHTML,'');}
  }))test(`${name} 뒤 이전 가입기록 ${outcome}은 창과 오류를 바꾸지 않는다`,async()=>{
    const ui=screen(),old=ui.open(11);await change(ui);const before=ui.snapshot();settle(ui.requests[0],outcome);await old;
    assert.deepEqual(ui.snapshot(),before);assert.deepEqual(ui.errors,[]);assert.deepEqual(ui.flashes,[]);
    if(ui.logoutPending){ui.requests[1].resolve({});await ui.logoutPending;assert.deepEqual(ui.redirects,['/login']);}
  });
}

test('현재 가입기록은 요청 현장·근로자의 링크, 한글 내용, 이스케이프와 빈 기록을 보존한다',async()=>{
  const ui=screen(),current=ui.open(11);assert.equal(ui.requests[0].url,'/api/workers/11/join-record?siteId=1');
  ui.requests[0].resolve(record('<가상 전화>'));await current;assert.match(ui.snapshot().html,/&lt;가상 전화&gt;/);assert.match(ui.snapshot().html,/signature\?siteId=1/);assert.match(ui.snapshot().html,/가상 안전모/);
  ui.close();const empty=ui.open(22);ui.requests[1].resolve(null);await empty;assert.equal(ui.snapshot().html,'<p>가입 기록이 없습니다.</p>');
});

test('현재 오류는 표시하고 다시 조회할 수 있다',async()=>{
  const ui=screen(),current=ui.open(11);ui.requests[0].reject(Error('현재 가상 오류'));await current;assert.deepEqual(ui.errors,['현재 가상 오류']);
  const retry=ui.open(11);ui.requests[1].resolve(record('재조회'));await retry;assert.match(ui.snapshot().html,/재조회/);
});

test('현재 가입기록 401은 기존 로그인 이동과 오류 안내를 유지한다',async()=>{
  const ui=screen(),current=ui.open(11);ui.requests[0].http(401);await current;
  assert.deepEqual(ui.redirects,['/login']);assert.deepEqual(ui.errors,['관리자 로그인이 필요합니다.']);assert.equal(ui.dialog.open,false);
});

test('일반 API 호출의 대화상자 내 401과 500 오류 처리는 유지한다',async()=>{
  for(const status of [401,500]){
    const ui=screen();ui.other();const pending=ui.context.api('/api/virtual');ui.requests[0].http(status);
    await assert.rejects(pending,status===401?/로그인이 만료되었습니다/:/가상 HTTP 오류/);assert.equal(ui.dialog.open,true);assert.deepEqual(ui.redirects,[]);
  }
});

test('열린 대화상자는 가입기록 재요청으로 교체하지 않는다',async()=>{
  const ui=screen();ui.other();const before=ui.snapshot(),pending=ui.open(11);assert.equal(ui.requests.length,0);await pending;assert.deepEqual(ui.snapshot(),before);
});

test('이전 목록 버튼은 현장 변경·복귀 및 페이지 이동 중 조회를 시작하지 않는다',()=>{
  for(const change of [ui=>ui.site(2),ui=>{ui.site(2);ui.site(1);},ui=>ui.page('dashboard')]){
    const ui=screen(),click=ui.bind(11);change(ui);click();assert.equal(ui.requests.length,0);
  }
  const ui=screen();ui.bind(11)();assert.equal(ui.requests[0].url,'/api/workers/11/join-record?siteId=1');
});

test('가입 당시 정보와 현재 연락처는 구분하여 안전하게 표시한다',async()=>{
 const ui=screen(),pending=ui.open(11),data=record('가입 전화');data.currentContact={phone:'<현재 전화>',address:'<현재 주소>'};ui.requests[0].resolve(data);await pending;const html=ui.snapshot().html;assert.match(html,/가입 당시 기록/);assert.match(html,/가입 전화/);assert.match(html,/현재 가상 전화번호: &lt;현재 전화&gt;/);assert.match(html,/현재 가상 주소: &lt;현재 주소&gt;/);
});

test('가입 전 출입자는 가입 기록 없음과 현재 연락처를 구분해 표시한다',async()=>{
 const ui=screen(),pending=ui.open(11);ui.requests[0].resolve({notJoined:true,currentContact:{phone:'<가상 번호>',address:'<가상 주소>'}});await pending;const html=ui.snapshot().html;assert.match(html,/가입 기록이 없습니다/);assert.match(html,/&lt;가상 번호&gt;/);assert.match(html,/&lt;가상 주소&gt;/);assert.doesNotMatch(html,/서명 다운로드/);
});
