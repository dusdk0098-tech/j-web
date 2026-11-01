import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const part=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end);};
const delayed=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const sites=[{id:1,name:'가상 첫 현장'},{id:2,name:'가상 둘째 현장'}];
const account={id:1,name:'가상 전역',login_id:'global_admin',active:1,version:'v1',scope:'global',siteIds:[]};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// shortcut: 실제 앱 함수와 가상 DOM을 실행하며 배치·키보드·인쇄는 별도 브라우저 검증이 필요하다.
function screen(fetcher=async()=>({ok:true,status:200,json:async()=>[]})){
  const nodes=new Map(),requests=[],errors=[],redirects=[],flashes=[];
  const node=()=>({innerHTML:'',textContent:'',value:'restricted',disabled:false,hidden:false,classList:{toggle(){},remove(){}},setAttribute(){}});
  const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  const pages=['dashboard','documents','admins','clients','site-activity','statistics','board','new-unverified-menu'].map(page=>({...node(),dataset:{page}}));
  const content={...node(),querySelector:get,querySelectorAll:selector=>selector==='[data-restricted-doc]'?[...content.innerHTML.matchAll(/data-restricted-doc="(\d+)"/g)].map(([,id])=>Object.assign(get('[data-restricted-doc="'+id+'"]'),{dataset:{restrictedDoc:id}})):[]};
  const state={page:'admins',siteId:1,detail:null,admin:{...account},sites,types:{notice:'일반 공지'}};
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const context={state,content,dialog,siteSelect:get('#site-select'),detailEpoch:1,workerListEpoch:0,sitePhotoEpoch:0,permitRoleCleanup:null,labels:{documents:'안전 문서',admins:'관리자 계정'},statusLabels:{draft:'임시저장'},esc,URLSearchParams,today:()=> '2026-11-02',document:{querySelector:selector=>selector.startsWith('dialog')?null:get(selector),querySelectorAll:()=>pages},$:get,location:{assign:path=>redirects.push(path)},flash:message=>flashes.push(message),showError:error=>errors.push(error.message),confirm:()=>true,FormData:class{constructor(form){return Object.entries(form.values||{});}},fetch:async(path,options)=>{requests.push({path,options});return fetcher(path,options);}};
  runInNewContext([
    part('function applyAdminScope(','let sitePhotoEpoch='),
    part('async function api(','function flash('),
    part('function field(','function signaturePad('),
    part('function showDialog(',"$('#dialog-close')"),
    part('async function loadSites(','siteSelect.onchange='),
    source.split('\n').find(line=>line.startsWith('siteSelect.onchange=')),
    part('async function renderRestrictedDocuments(','async function render(){'),
    part('async function render(){',"  if(state.page==='site-print')")+'}',
    "globalThis.renderAccounts=async()=>{const renderEpoch=detailEpoch;"+part("  if(state.page==='admins'){","  if(state.page==='clients')")+'};'
  ].join('\n'),context);
  const draw=context.render;context.render=()=>context.renderPending=draw();
  return {context,state,content,dialog,nodes,get,pages,requests,errors,redirects,flashes,submit:async values=>{const form=get('#dialog-form');form.values=values;await form.onsubmit({preventDefault(){},currentTarget:form});}};
}
const response=data=>({ok:true,status:200,json:async()=>data});

test('전역만 계정·전체현장·미검증 메뉴 노출, 제한은 문서 메뉴와 지원 설명만 표시',()=>{
  const ui=screen();ui.context.applyAdminScope({scope:'restricted',siteIds:[1]});
  assert.deepEqual(ui.pages.filter(p=>!p.hidden).map(p=>p.dataset.page),['documents']);
  for(const key of ['#site-add','#site-qr','#sticker-requests','#ai-chat'])assert.equal(ui.get(key).hidden,true);
  assert.match(ui.get('.sidebar-help').textContent,/일반 공지 임시저장/);assert.equal(ui.state.page,'documents');
  ui.context.applyAdminScope(account);assert.equal(ui.pages.some(p=>p.hidden),false);assert.equal(ui.get('#site-add').hidden,false);
  ui.context.applyAdminScope({});assert.equal(ui.state.admin.scope,'restricted');
});

test('현장 제한 생성·수정은 정수 현장 ID 전달, 전역은 빈 배정 전달',async()=>{
  const ui=screen(async(path,options)=>response(options.method?{...account,version:'v2'}:[account]));
  await ui.context.renderAccounts();ui.get('#admin-add').onclick();
  assert.match(ui.get('#dialog-body').innerHTML,/배정 현장만/);assert.match(ui.get('#dialog-body').innerHTML,/다시 로그인/);
  await ui.submit({loginId:'limited_admin',name:'가상 제한',password:'virtual-password-123',confirm:'virtual-password-123',scope:'restricted',siteId_2:'on'});
  let payload=JSON.parse(ui.requests.find(r=>r.options.method==='POST').options.body);assert.deepEqual(payload,{loginId:'limited_admin',name:'가상 제한',password:'virtual-password-123',scope:'restricted',siteIds:[2]});
  ui.state.admin.id=99;await ui.context.renderAccounts();ui.get('[data-admin-scope="1"]').onclick();ui.get('#admin-scope').value='global';ui.get('#admin-scope').onchange();assert.equal(ui.get('#admin-site-options').disabled,true);
  await ui.submit({scope:'global',siteId_1:'on'});payload=JSON.parse(ui.requests.find(r=>r.options.method==='PUT').options.body);assert.deepEqual(payload,{version:'v1',scope:'global',siteIds:[]});
});

test('마지막 전역·버전 충돌 오류는 입력을 보존하며 자기 배정 변경만 재로그인',async()=>{
  for(const status of [400,409]){
    const message=status===400?'마지막 활성 전역 관리자는 변경할 수 없습니다.':'계정이 변경되었습니다. 다시 조회해 주세요.';
    const ui=screen(async(path,options)=>options.method?{ok:false,status,json:async()=>({error:message})}:response([account]));
    await ui.context.renderAccounts();ui.get('[data-admin-scope="1"]').onclick();await ui.submit({scope:'restricted'});
    assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-error').textContent,message);assert.deepEqual(ui.redirects,[]);
  }
  const ui=screen(async(path,options)=>response(options.method?{...account,version:'v2'}:[account]));
  await ui.context.renderAccounts();ui.get('[data-admin-name="1"]').onclick();await ui.submit({name:'새 가상 이름'});assert.deepEqual(ui.redirects,[]);
  await ui.context.renderAccounts();ui.get('[data-admin-scope="1"]').onclick();await ui.submit({scope:'restricted',siteId_1:'on'});assert.deepEqual(ui.redirects,['/login']);assert.equal(ui.dialog.open,false);assert.match(ui.content.textContent,/다시 로그인/);
});

test('빈 배정과 제거된 현장은 이전 선택·상세를 지우며 문서 요청 없이 안내',async()=>{
  const ui=screen(async()=>response([]));ui.state.admin={scope:'restricted'};ui.state.page='documents';ui.state.detail=77;
  await ui.context.render();assert.equal(ui.state.siteId,null);assert.equal(ui.state.detail,null);assert.equal(ui.get('#site-select').disabled,true);assert.match(ui.content.innerHTML,/배정 현장이 없습니다/);assert.deepEqual(ui.requests.map(r=>r.path),['/api/sites']);
});

test('현장·문서·관리자 목록의 이전 응답과 이전 배정 폼은 현재 화면을 덮거나 저장하지 않는다',async()=>{
  for(const target of ['sites','documents','accounts']){
    const wait=delayed(),ui=screen(async()=>wait.promise);ui.content.innerHTML='새 화면';
    const pending=target==='sites'?ui.context.loadSites():target==='documents'?(ui.state.page='documents',ui.context.renderRestrictedDocuments()):ui.context.renderAccounts();
    ui.context.detailEpoch++;ui.state.page='documents';ui.state.siteId=2;wait.resolve(response(target==='accounts'?[account]:sites));await pending;
    assert.equal(ui.content.innerHTML,'새 화면');assert.equal(ui.state.siteId,2);
  }
  const ui=screen(async()=>response([account]));await ui.context.renderAccounts();ui.get('[data-admin-scope="1"]').onclick();ui.context.detailEpoch++;await ui.submit({scope:'restricted'});assert.equal(ui.requests.length,1);
});

test('제한 공지 저장 중 현장 전환·세션 만료는 다른 화면에 성공을 표시하지 않는다',async()=>{
  const wait=delayed(),ui=screen(async(path,options)=>options.method?wait.promise:response([]));ui.state.page='documents';ui.state.admin={scope:'restricted'};
  await ui.context.renderRestrictedDocuments();ui.get('#restricted-notice-add').onclick();const saving=ui.submit({title:'가상 공지',date:'2026-11-02',body:'가상 본문'});ui.context.detailEpoch++;ui.state.siteId=2;wait.resolve({ok:false,status:401,json:async()=>({error:'만료'})});await saving;
  assert.deepEqual(ui.redirects,[]);assert.deepEqual(ui.flashes,[]);assert.equal(ui.get('#dialog-error').textContent,'');
  const expired=screen(async(path,options)=>options.method?{ok:false,status:401,json:async()=>({error:'만료'})}:response([]));expired.state.page='documents';await expired.context.renderRestrictedDocuments();expired.get('#restricted-notice-add').onclick();await expired.submit({title:'가상',date:'2026-11-02',body:''});assert.equal(expired.dialog.open,true);assert.match(expired.get('#dialog-error').textContent,/다시 로그인/);
});

test('실제 HTTP 로그인→배정 현장 선택→공지 UI 임시저장·재조회, 다른 현장 거절 및 배정 제거 재로그인',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-scope-ui-')),reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료되었습니다.');})]);
    const base='http://127.0.0.1:'+port,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const login=async loginId=>{const response=await send('/api/login','POST',{loginId,password:'virtual-password-123'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
    const globalCookie=await login('admin'),created=[];
    for(const name of ['가상 배정 첫 현장','가상 배정 둘째 현장','가상 미배정 현장']){const result=await send('/api/sites','POST',{name},globalCookie);assert.equal(result.status,201);created.push(await result.json());}
    const createdAccount=await send('/api/admin-accounts','POST',{loginId:'scope_ui',name:'가상 제한 관리자',password:'virtual-password-123',scope:'restricted',siteIds:created.slice(0,2).map(s=>s.id)},globalCookie);assert.equal(createdAccount.status,201);const limited=await createdAccount.json(),cookie=await login('scope_ui'),session=await(await send('/api/session','GET',null,cookie)).json();
    const ui=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie,'x-admin-context':session.context}}));ui.context.applyAdminScope(session.admin);await ui.context.render();assert.equal(ui.state.siteId,created[0].id);assert.equal(ui.state.sites.length,2);assert.doesNotMatch(ui.get('#site-select').innerHTML,/미배정/);
    ui.get('#site-select').value=String(created[1].id);ui.get('#site-select').onchange();await ui.context.renderPending;assert.equal(ui.state.siteId,created[1].id);ui.get('#restricted-notice-add').onclick();await ui.submit({title:'가상 제한 공지',date:'2026-11-02',body:'가상 본문'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/가상 제한 공지/);assert.deepEqual(ui.errors,[]);
    const documents=await(await send('/api/documents?siteId='+created[1].id,'GET',null,cookie)).json();assert.equal(documents.length,1);assert.equal(documents[0].status,'draft');assert.equal(documents[0].site_id,created[1].id);
    ui.content.querySelectorAll('[data-restricted-doc]')[0].onclick();await ui.context.renderPending;assert.equal(ui.state.detail,documents[0].id);assert.match(ui.content.innerHTML,/가상 본문/);assert.doesNotMatch(ui.content.innerHTML,/결재 요청|암호 초기화/);
    assert.equal((await send('/api/documents?siteId='+created[2].id,'GET',null,cookie)).status,403);assert.equal((await send('/api/admin-accounts','GET',null,cookie)).status,403);
    const updated=await send('/api/admin-accounts/'+limited.id,'PUT',{version:limited.version,scope:'restricted',siteIds:[]},globalCookie);assert.equal(updated.status,200);await assert.rejects(ui.context.render(),/로그인/);assert.deepEqual(ui.redirects,['/login']);
    const nextCookie=await login('scope_ui'),nextSession=await(await send('/api/session','GET',null,nextCookie)).json(),empty=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie:nextCookie,'x-admin-context':nextSession.context}}));empty.context.applyAdminScope(nextSession.admin);await empty.context.render();assert.match(empty.content.innerHTML,/배정 현장이 없습니다/);assert.deepEqual(empty.requests.map(r=>r.path),['/api/sites']);
  }finally{
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    const target=resolve(dir),root=resolve(tmpdir());assert.ok(target.startsWith(root+'\\')||target.startsWith(root+'/'));rmSync(target,{recursive:true,force:true});
  }
});
