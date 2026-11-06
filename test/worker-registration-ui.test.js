import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { workerFieldRequirements } from '../public/worker-fields.js';
import { paginateWorkers } from '../public/worker-list.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const worker={id:7,site_id:1,name:'가상 이름',category:'직영',company:'',occupation:'목공',memo:'가상 메모',registration_type:'self',has_account:true,version:'v1'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function screen(){
  const controls=new Map(),nodes=new Map(),calls=[],flashes=[],errors=[],state={siteId:1,page:'workers',admin:{id:1}},form={},submit={disabled:false},convert={disabled:false};let renders=0,markup='';
  const node=()=>({value:'',textContent:'',setAttribute(){},append(){}});
  for(const id of ['#dialog-title','#dialog-error','#dialog-close','#dialog-cancel'])nodes.set(id,node());
  nodes.set('#dialog-form',form);nodes.set('#dialog-form button[type=submit]',submit);
  nodes.set('#dialog-body',{append(){},set innerHTML(value){markup=value;controls.clear();for(const match of value.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"/g))controls.set(match[1],{...node(),value:match[2]});const memo=value.match(/<textarea name="memo"[^>]*>(.*?)<\/textarea>/);if(memo)controls.set('memo',{...node(),value:memo[1]});convert.disabled=false;},get innerHTML(){return markup;}});
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},context={state,detailEpoch:1,workerListEpoch:1,workerEditEpoch:0,workerFieldRequirements,dialog,FormData:class {constructor(){return [...controls].map(([name,input])=>[name,input.value]);}},document:{createElement:node},$:selector=>selector==='[data-worker-registration]'?(markup.includes('data-worker-registration')?convert:null):selector.startsWith('#dialog-form input[name=')?controls.get(selector.match(/name=(.+)\]/)[1]):nodes.get(selector),flash:message=>flashes.push(message),showError:error=>errors.push(error.message),render:async()=>{renders++;},location:{assign:path=>errors.push(path)}};
  const ui={context,controls,state,form,submit,convert,dialog,calls,flashes,errors,load:async()=>[],write:async()=>({}),renders:()=>renders,markup:()=>markup,error:()=>nodes.get('#dialog-error').textContent};
  context.fetch=async(path,options)=>{calls.push({path,options});const result=await (options.method?ui.write(path,options):ui.load(path));return result?.httpStatus?{status:result.httpStatus,ok:false,json:async()=>({error:result.error})}:{status:200,ok:true,json:async()=>result};};
  runInNewContext([source.match(/^const esc = .*$/m)[0],source.slice(source.indexOf('async function api('),source.indexOf('function flash(')),source.slice(source.indexOf('function field('),source.indexOf('function signaturePad(')),source.slice(source.indexOf('function showDialog('),source.indexOf("$('#menu-toggle').onclick")),source.slice(source.indexOf('async function editWorker('),source.indexOf('async function showWorkerPermissions('))].join('\n'),context);
  ui.open=(person=worker)=>context.editWorker(person);ui.save=()=>form.onsubmit({preventDefault(){},currentTarget:form});ui.convertRegistration=()=>convert.onclick();ui.writes=()=>calls.filter(call=>call.options.method);ui.payload=()=>JSON.parse(ui.writes().at(-1).options.body);ui.showOther=()=>context.showDialog('새 창','<p>다른 창</p>',async()=>{});return ui;
}

test('목록의 등록 방식은 계정 유무와 독립적으로 표시하고 기존 검색·정렬 열을 유지한다',async()=>{
  const start=source.indexOf("  if(state.page==='workers')"),from=source.indexOf('    const epoch=workerListEpoch',start),to=source.indexOf("    $('#new-worker').onclick",from),content={},workers=[worker,{...worker,id:8,name:'가상 일반',registration_type:'general',has_account:true},{...worker,id:9,name:'가상 자기',has_account:false}],context={content,workerListEpoch:1,detailEpoch:1,renderEpoch:1,state:{admin:{id:1},page:'workers',siteId:1,query:'',workerOrder:'default',workerFilters:{},workerPage:0},URLSearchParams,paginateWorkers,workerSummaryMarkup:()=>'',api:async path=>path.startsWith('/api/workers/list')?{workers}:workers};
  assert.ok(from>start&&to>from);runInNewContext(source.match(/^const esc = .*$/m)[0],context);await runInNewContext(`(async()=>{${source.slice(from,to)}})()`,context);
  assert.match(content.innerHTML,/<th>최초 출역 기록<\/th>/);assert.match(content.innerHTML,/<td>기록 없음<\/td>/);assert.match(content.innerHTML,/<th>등록 방식<\/th>/);assert.equal((content.innerHTML.match(/<td>자기 등록<\/td>/g)||[]).length,2);assert.equal((content.innerHTML.match(/<td>일반등록<\/td>/g)||[]).length,1);assert.match(content.innerHTML,/worker-order/);assert.match(content.innerHTML,/worker-from/);assert.match(content.innerHTML,/data-edit-worker="7"/);
});

test('자기 등록 수정창은 자동 전환과 가상 보존 정책을 안내하고 일반등록에는 전환 버튼이 없다',async()=>{
  const ui=screen();await ui.open();assert.match(ui.markup(),/관리자가 출입자 정보를 저장하면 일반등록으로 변경/);assert.match(ui.markup(),/계정과 과거 기록은 유지/);assert.doesNotMatch(ui.markup(),/원본 서버/);assert.match(ui.markup(),/type="button" data-worker-registration/);assert.equal(ui.submit.textContent,'정보 저장 · 일반등록으로 전환');
  await ui.open({...worker,registration_type:'general'});assert.match(ui.markup(),/<strong>일반등록<\/strong>/);assert.doesNotMatch(ui.markup(),/data-worker-registration/);assert.equal(ui.submit.textContent,'저장');
});

test('명시 전환은 편집 입력을 보내지 않고 버전과 현장을 전송하며 중복 전환·저장을 차단한다',async()=>{
  const ui=screen(),pending=deferred();await ui.open();ui.controls.get('name').value='편집 중 이름';ui.write=()=>pending.promise;const saving=ui.convertRegistration();await ui.convertRegistration();await ui.save();assert.equal(ui.writes().length,1);assert.equal(ui.writes()[0].path,'/api/workers/7/registration/general');assert.equal(ui.writes()[0].options.method,'POST');assert.deepEqual(ui.payload(),{siteId:1,version:'v1'});assert.equal(ui.convert.disabled,true);pending.resolve({});await saving;assert.equal(ui.dialog.open,false);assert.equal(ui.renders(),1);assert.match(ui.flashes[0],/계정과 과거 기록은 유지/);
});

test('일반 정보 수정은 기존 PUT 입력과 버전을 보존하고 새 등록은 POST를 사용한다',async()=>{
  for(const person of [worker,{...worker,registration_type:'general'},null]){const ui=screen();await ui.open(person);ui.controls.get('name').value='수정 이름';ui.controls.get('memo').value='수정 메모';await ui.save();assert.equal(ui.writes()[0].path,person?'/api/workers/7':'/api/workers');assert.equal(ui.writes()[0].options.method,person?'PUT':'POST');assert.equal(ui.payload().name,'수정 이름');assert.equal(ui.payload().memo,'수정 메모');assert.equal(ui.payload().siteId,1);assert.equal(ui.payload().version,person?'v1':undefined);assert.equal(ui.renders(),1);}
});

for(const action of ['save','convertRegistration'])for(const status of [401,409,500])test(`${action} ${status} 실패는 입력과 창을 보존하며 재시도할 수 있다`,async()=>{
  const ui=screen();await ui.open();ui.controls.get('memo').value='지우면 안 되는 메모';ui.write=async()=>({httpStatus:status,error:'가상 변경 충돌'});await ui[action]();assert.equal(ui.dialog.open,true);assert.equal(ui.controls.get('memo').value,'지우면 안 되는 메모');assert.equal(ui.submit.disabled,false);assert.equal(ui.convert.disabled,false);assert.equal(ui.renders(),0);assert.deepEqual(ui.flashes,[]);assert.match(ui.error(),status===401?/로그인이 만료/:/가상 변경 충돌/);ui.write=async()=>({});await ui[action]();assert.equal(ui.renders(),1);
});

test('정보 저장 도중 일반등록 버튼을 눌러도 두 번째 요청을 보내지 않는다',async()=>{
  const ui=screen(),pending=deferred();await ui.open();ui.write=()=>pending.promise;const saving=ui.save();await ui.convertRegistration();await ui.save();assert.equal(ui.writes().length,1);pending.resolve({});await saving;
});

for(const action of ['save','convertRegistration'])test(`${action} 현장 이동·복귀와 페이지 변경 뒤에는 요청을 전송하지 않는다`,async()=>{
  for(const change of [ui=>ui.state.siteId=2,ui=>ui.context.workerListEpoch++,ui=>ui.state.page='dashboard']){const ui=screen();await ui.open();change(ui);await ui[action]();assert.equal(ui.writes().length,0);assert.equal(ui.dialog.open,true);}
});

for(const action of ['save','convertRegistration'])for(const outcome of ['resolve','reject'])test(`${action} 지연 ${outcome}은 이동한 화면이나 새 창을 덮어쓰지 않는다`,async()=>{
  for(const change of [ui=>{ui.state.siteId=2;ui.context.workerListEpoch++;},ui=>ui.showOther(),ui=>ui.dialog.close()]){const ui=screen(),pending=deferred();await ui.open();ui.write=()=>pending.promise;const saving=ui[action]();change(ui);const opened=ui.dialog.open,html=ui.markup();pending[outcome](outcome==='reject'?Error('이전 오류'):{});await saving;assert.equal(ui.dialog.open,opened);assert.equal(ui.markup(),html);assert.equal(ui.renders(),0);assert.deepEqual(ui.flashes,[]);assert.equal(ui.error(),'');}
});

test('늦은 조회는 현장 이동·복귀 또는 더 최근에 연 수정창을 덮지 않는다',async()=>{
  const ui=screen(),pending=deferred();ui.load=()=>pending.promise;const first=ui.open();ui.context.workerListEpoch++;pending.resolve([]);await first;assert.equal(ui.dialog.open,false);
  const next=screen(),old=deferred();next.load=()=>old.promise;const opening=next.open(worker);next.load=async()=>[];await next.open({...worker,id:8,name:'최근 출입자'});old.resolve([]);await opening;assert.equal(next.controls.get('name').value,'최근 출입자');
  const other=screen(),slow=deferred();other.load=()=>slow.promise;const loading=other.open();other.showOther();slow.resolve([]);await loading;assert.equal(other.markup(),'<p>다른 창</p>');
});

test('조회 오류도 이동한 현장의 화면에 표시하지 않는다',async()=>{
  const ui=screen(),pending=deferred();ui.load=()=>pending.promise;const opening=ui.open();ui.state.siteId=2;pending.reject(Error('이전 조회 실패'));await opening;assert.deepEqual(ui.errors,[]);assert.equal(ui.dialog.open,false);
});

test('출역 기간 조건을 목록 검색에 전달하고 역순 기간을 거절한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    $('#search').onclick=()=>{const from=$('#worker-from')"),end=source.indexOf(';\n',start);assert.ok(start>=0&&end>start);
  const fields={'#worker-from':{value:''},'#worker-to':{value:''},'#worker-attendance-from':{value:'2026-11-01'},'#worker-attendance-to':{value:'2026-11-06'},'#query':{value:'가상'},'#worker-order':{value:'default'},'#worker-category':{value:''},'#worker-company':{value:''},'#worker-occupation':{value:''},'#search':{}},state={workerFilters:{},workerPage:2},messages=[],context={$:key=>fields[key],state,filters:{category:'구분',company:'소속',occupation:'직종'},flash:value=>messages.push(value),render:()=>Promise.resolve(),showError:error=>{throw error;}};
  runInNewContext(source.slice(start,end+1),context);fields['#search'].onclick();assert.equal(state.workerFilters.attendanceFrom,'2026-11-01');assert.equal(state.workerFilters.attendanceTo,'2026-11-06');assert.equal(state.workerPage,0);
  fields['#worker-attendance-from'].value='2026-11-07';fields['#search'].onclick();assert.equal(state.workerFilters.attendanceFrom,'2026-11-01');assert.equal(messages.length,1);
});

test('출입자 편집 조회는 로그아웃·계정 변경 후 성공과 인증 오류를 표시하지 않는다',async()=>{
 for(const mode of ['success','unauthorized','failure'])for(const change of [ui=>{ui.state.admin=null;ui.context.detailEpoch++;},ui=>{ui.state.admin={id:2};}]){
  const ui=screen(),pending=deferred();ui.load=()=>pending.promise;const opening=ui.open();change(ui);if(mode==='failure')pending.reject(Error('이전 조회 오류'));else pending.resolve(mode==='unauthorized'?{httpStatus:401,error:'만료'}:[]);await opening;assert.equal(ui.dialog.open,false);assert.deepEqual(ui.errors,[]);assert.deepEqual(ui.flashes,[]);
 }
});

test('출입자 목록 조회는 로그아웃·계정 교체 후 이전 응답과 오류를 무시한다',async()=>{
 const start=source.indexOf("  if(state.page==='workers')"),from=source.indexOf('    const epoch=workerListEpoch',start),to=source.indexOf("    $('#new-worker').onclick",from);assert.ok(from>start&&to>from);
 for(const outcome of ['resolve','reject'])for(const change of [ctx=>{ctx.state.admin=null;ctx.detailEpoch++;},ctx=>{ctx.state.admin={id:2};}]){
  const pending=deferred(),content={innerHTML:'로그아웃 화면'},context={content,workerListEpoch:1,detailEpoch:1,renderEpoch:1,state:{admin:{id:1},page:'workers',siteId:1,query:'',workerOrder:'default',workerFilters:{},workerPage:0},URLSearchParams,paginateWorkers,workerSummaryMarkup:()=>'',api:()=>pending.promise};runInNewContext(source.match(/^const esc = .*$/m)[0],context);const loading=runInNewContext(`(async()=>{${source.slice(from,to)}})()`,context);change(context);if(outcome==='resolve')pending.resolve({workers:[worker]});else pending.reject(Error('이전 조회 오류'));await loading;assert.equal(content.innerHTML,'로그아웃 화면');
 }
});

test('로그아웃 또는 계정 변경 후 이전 출입자 창은 저장·전환하지 않는다',async()=>{
 for(const action of ['save','convertRegistration'])for(const change of [ui=>{ui.state.admin=null;ui.context.detailEpoch++;},ui=>{ui.state.admin={id:2};}]){const ui=screen();await ui.open();change(ui);await ui[action]();assert.equal(ui.writes().length,0);assert.deepEqual(ui.flashes,[]);}
});
