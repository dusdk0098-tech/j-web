import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import { siteQrSession, printSiteQr, siteQrPrintAction } from '../public/site-qr.js';
import { hasManagerEducationTargets } from '../public/education-kinds.js';
import { changedTrainingWorkers } from '../public/training-groups.js';
import { attendanceNoticesMarkup } from '../public/attendance-matrix.js';
import { trainingDetailMarkup } from '../public/training-detail.js';
import { riskDetailMarkup, muscleDetailMarkup } from '../public/risk-detail.js';
import { planDetailMarkup } from '../public/plan-detail.js';
import { educationAttachmentLabels } from '../public/education-kinds.js';
import { checklistCategories } from '../public/checklist-copy.js';
import { mountWorkerInvitation } from '../public/worker-invitation.js';
import { closeContractPreview } from '../public/contract-profile-view.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const part=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end);};
const delayed=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const sites=[{id:1,name:'가상 첫 현장'},{id:2,name:'가상 둘째 현장'}];
const account={id:1,name:'가상 전역',login_id:'global_admin',active:1,version:'v1',scope:'global',siteIds:[]};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// shortcut: 실제 앱 함수와 가상 DOM을 실행하며 배치·키보드·인쇄는 별도 브라우저 검증이 필요하다.
function screen(fetcher=async()=>({ok:true,status:200,json:async()=>[]})){
  const nodes=new Map(),requests=[],errors=[],redirects=[],flashes=[];
  const node=(tag='')=>({tag,children:[],isConnected:true,get innerHTML(){return this.markup||'';},set innerHTML(value){this.markup=value;this.children=[];},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},after(element){this.afterElement=element;},remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);},focus(){this.focused=true;},textContent:'',value:'restricted',disabled:false,hidden:false,classList:{toggle(){},remove(){}},setAttribute(){},insertAdjacentHTML(position,html){this.innerHTML+=html;}});
  const get=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  const pages=['dashboard','documents','workers','attendance','equipment-attendance','admins','clients','site-activity','statistics','board','new-unverified-menu'].map(page=>({...node(),dataset:{page}}));
  const content={...node(),querySelector:get,querySelectorAll:selector=>{const equipmentMatch=selector.match(/^\[data-equipment-attendance-(edit|delete)\]$/);if(equipmentMatch){const kind=equipmentMatch[1];return [...content.innerHTML.matchAll(new RegExp('data-equipment-attendance-'+kind+'="(\\d+)"','g'))].map(([,id])=>Object.assign(get('[data-equipment-attendance-'+kind+'="'+id+'"]'),{isConnected:true,dataset:{['equipmentAttendance'+kind[0].toUpperCase()+kind.slice(1)]:id}}));}const match=selector.match(/^\[data-restricted-(doc|worker|presence|units)\]$/);if(!match)return [];const kind=match[1],key='restricted'+kind[0].toUpperCase()+kind.slice(1);return [...content.innerHTML.matchAll(new RegExp('data-restricted-'+kind+'="(\\d+)"','g'))].map(([,id])=>Object.assign(get('[data-restricted-'+kind+'="'+id+'"]'),{dataset:{[key]:id}}));}};
  const originalQueryAll=content.querySelectorAll;
  content.querySelectorAll=selector=>{
    if(selector!=='[data-restricted-doc]')return originalQueryAll(selector);
    return [...get('#restricted-document-results').innerHTML.matchAll(/data-restricted-doc="(\d+)"/g)].map(([,id])=>Object.assign(get('[data-restricted-doc="'+id+'"]'),{dataset:{restrictedDoc:id}}));
  };
  const state={page:'admins',siteId:1,detail:null,admin:{...account},sites,types:{notice:'일반 공지'}};
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const context={state,content,dialog,siteSelect:get('#site-select'),detailEpoch:1,workerListEpoch:0,sitePhotoEpoch:0,permitRoleCleanup:null,siteEducationCleanup:null,labels:{documents:'안전 문서',admins:'관리자 계정'},statusLabels:{draft:'임시저장'},esc,URLSearchParams,today:()=> '2026-11-02',document:{createElement:node,querySelector:selector=>selector.startsWith('dialog')?null:get(selector),querySelectorAll:()=>pages},$:get,location:{assign:path=>redirects.push(path)},flash:message=>flashes.push(message),showError:error=>errors.push(error.message),confirm:()=>true,FormData:class{constructor(form){return Object.entries(form.values||{});}},fetch:async(path,options)=>{requests.push({path,options});return fetcher(path,options);}};
  context.siteQrSession=siteQrSession;context.siteQrPrintAction=options=>siteQrPrintAction({...options,print:(dialog,mode)=>context.printSiteQr(dialog,mode)});
  context.mountWorkerInvitation=(...args)=>mountWorkerInvitation(...args,context.document);
  context.closeContractPreview=closeContractPreview;
  context.mountRestrictedMonthEditor=()=>({dirty:()=>false,busy:()=>false});
  context.hasManagerEducationTargets=hasManagerEducationTargets;
  context.checklistCategories=checklistCategories;
  context.changedTrainingWorkers=changedTrainingWorkers;
  context.attendanceNoticesMarkup=attendanceNoticesMarkup;
  context.trainingDetailMarkup=trainingDetailMarkup;context.educationAttachmentLabels=educationAttachmentLabels;
  Object.assign(context,{riskDetailMarkup,muscleDetailMarkup,planDetailMarkup});
  for(const key of ['riskFields','riskKinds','riskScales','planFields'])context[key]=runInNewContext(source.split('\n').find(line=>line.startsWith('const '+key+'='))+'\n'+key);
  for(const key of ['rainChecks','windChecks','thawChecks','heatChecks','coldChecks','wetSeasonChecks','heavyRainChecks','electricalChecks','fireChecks','formworkChecks','fallingChecks','confinedChecks','excavationChecks','semiannualChecks','morningChecks','afternoonChecks','eveningChecks'])context[key]=runInNewContext(source.split('\n').find(line=>line.startsWith('const '+key+'='))+'\n'+key);
  context.siteSelect.selectedOptions=[{textContent:'가상 첫 현장'}];
  const oldQueryAll=context.document.querySelectorAll;
  context.document.querySelectorAll=selector=>{
    const match=selector.match(/^\[data-restricted-(qr|month-worker)\]$/);if(!match)return oldQueryAll(selector);
    const kind=match[1],markup=get('#dialog-body').innerHTML+get('#restricted-month-results').innerHTML;
    return [...markup.matchAll(new RegExp('data-restricted-'+kind+'="([^"]+)"','g'))].map(([,value])=>Object.assign(get('[data-restricted-'+kind+'="'+value+'"]'),{dataset:{[kind==='qr'?'restrictedQr':'restrictedMonthWorker']:value}}));
  };
  get('#restricted-month').value='2026-11';
  runInNewContext([
    part('function applyAdminScope(','let sitePhotoEpoch='),
    part('async function api(','function flash('),
    part('function field(','function signaturePad('),
    part('function mountWorkerLicenses(','async function showWorkerPermissions('),
    part('function showDialog(',"$('#dialog-close')"),
    part('async function loadSites(','siteSelect.onchange='),
    source.split('\n').find(line=>line.startsWith('siteSelect.onchange=')),
    part('async function showRestrictedQr(','async function render(){'),
    part('async function render(){',"  if(state.page==='site-print')")+'}',
    "globalThis.renderAccounts=async()=>{const renderEpoch=detailEpoch;"+part("  if(state.page==='admins'){","  if(state.page==='clients')")+'};'
  ].join('\n'),context);
  const draw=context.render;context.render=()=>context.renderPending=draw();
  return {context,state,content,dialog,nodes,get,pages,requests,errors,redirects,flashes,submit:async values=>{const form=get('#dialog-form');form.values=values;await form.onsubmit({preventDefault(){},currentTarget:form});}};
}
const response=data=>({ok:true,status:200,json:async()=>data});

test('제한 관리자의 체크리스트 분류는 검색·상세 복귀·초기화에 유지된다',async()=>{
  const doc={id:5,site_id:1,type:'notice',title:'가상 문서',date:'2026-11-02',body:'가상 본문',status:'approved'};
  const ui=screen(async path=>path==='/api/sites'?response(sites):response(path.includes('?')?[doc]:doc));
  ui.state.page='documents';ui.state.admin={id:4,scope:'restricted'};ui.state.types.checklist='체크리스트';await ui.context.renderRestrictedDocuments();
  assert.match(ui.content.innerHTML,/id="restricted-document-category"/);const type=ui.get('#restricted-document-type'),category=ui.get('#restricted-document-category');assert.equal(category.disabled,true);
  type.value='checklist';type.onchange();assert.equal(category.disabled,false);category.value='weather';ui.get('#restricted-document-q').value='가상';await ui.get('#restricted-document-search').onclick();
  let params=new URLSearchParams(ui.requests.at(-1).path.split('?')[1]);assert.equal(params.get('checklistCategory'),'weather');assert.equal(params.get('type'),'checklist');assert.equal(params.get('q'),'가상');
  ui.content.querySelectorAll('[data-restricted-doc]')[0].onclick();await ui.context.renderPending;ui.get('#restricted-back').onclick();await ui.context.renderPending;assert.equal(ui.get('#restricted-document-category').value,'weather');
  ui.get('#restricted-document-type').value='notice';ui.get('#restricted-document-type').onchange();assert.equal(ui.get('#restricted-document-category').value,'');assert.equal(ui.get('#restricted-document-category').disabled,true);
  await ui.get('#restricted-document-reset').onclick();params=new URLSearchParams(ui.requests.at(-1).path.split('?')[1]);assert.equal(params.has('checklistCategory'),false);assert.equal(params.has('type'),false);
});

test('제한 문서 검색은 조건을 전달하고 상세 복귀·실패 때 입력을 보존한다',async()=>{
  let fail=false;const doc={id:5,site_id:1,type:'notice',title:'가상 문서',date:'2026-11-02',body:'본문',status:'approved'};
  const ui=screen(async path=>path==='/api/sites'?response(sites):fail?{ok:false,status:400,json:async()=>({error:'조회 실패'})}:response(path.includes('?')?[doc]:doc));
  ui.state.page='documents';ui.state.admin={id:4,scope:'restricted'};await ui.context.renderRestrictedDocuments();
  assert.equal(ui.requests.at(-1).path,'/api/documents?siteId=1');
  for(const [key,value] of Object.entries({type:'notice',q:'가상 & 제목',from:'2026-11-01',to:'2026-11-30'}))ui.get('#restricted-document-'+key).value=value;
  await ui.get('#restricted-document-search').onclick();const params=new URLSearchParams(ui.requests.at(-1).path.split('?')[1]);assert.equal(params.get('q'),'가상 & 제목');assert.equal(params.get('type'),'notice');assert.equal(params.get('from'),'2026-11-01');
  ui.content.querySelectorAll('[data-restricted-doc]')[0].onclick();await ui.context.renderPending;ui.get('#restricted-back').onclick();await ui.context.renderPending;assert.equal(ui.get('#restricted-document-q').value,'가상 & 제목');
  fail=true;await ui.get('#restricted-document-search').onclick();assert.match(ui.get('#restricted-document-status').textContent,/조회 실패/);assert.equal(ui.get('#restricted-document-q').value,'가상 & 제목');
  const before=ui.requests.length;for(const dates of [['2026-02-30',''],['2026-11-30','2026-11-01'],['bad','']]){ui.get('#restricted-document-from').value=dates[0];ui.get('#restricted-document-to').value=dates[1];await ui.get('#restricted-document-search').onclick();assert.equal(ui.requests.length,before);assert.equal(ui.get('#restricted-document-from').value,dates[0]);}
  fail=false;await ui.get('#restricted-document-reset').onclick();assert.equal(ui.requests.at(-1).path,'/api/documents?siteId=1');
});

test('제한 문서 검색은 같은 조건 재조회와 현장·계정 전환의 지연 응답을 차단한다',async()=>{
  const waits=[],ui=screen(()=>{const wait=delayed();waits.push(wait);return wait.promise;});ui.state.page='documents';
  const first=ui.context.renderRestrictedDocuments(),second=ui.get('#restricted-document-search').onclick();
  waits[1].resolve(response([{id:2,title:'최신 결과'}]));await second;waits[0].resolve(response([{id:1,title:'이전 결과'}]));await first;assert.match(ui.get('#restricted-document-results').innerHTML,/최신 결과/);assert.doesNotMatch(ui.get('#restricted-document-results').innerHTML,/이전 결과/);
  for(const change of ['site','account','aba']){ui.get('#restricted-document-q').value='이전 현장 검색';const pending=ui.get('#restricted-document-search').onclick(),wait=waits.at(-1);if(change==='account')ui.state.admin={id:99};else {ui.state.siteId=2;ui.context.detailEpoch++;if(change==='aba')ui.state.siteId=1;}
    ui.get('#restricted-document-results').innerHTML='새 화면';wait.resolve(response([{id:3,title:'오래된 응답'}]));await pending;assert.equal(ui.get('#restricted-document-results').innerHTML,'새 화면');
    const next=ui.context.renderRestrictedDocuments();waits.at(-1).resolve(response([]));await next;assert.equal(ui.get('#restricted-document-q').value,'');
  }
});

test('제한 문서 검색의 이전 인증 오류는 새 결과를 덮지 않는다',async()=>{
  const waits=[],ui=screen(()=>{const wait=delayed();waits.push(wait);return wait.promise;});ui.state.page='documents';const first=ui.context.renderRestrictedDocuments(),second=ui.get('#restricted-document-search').onclick();
  waits[1].resolve(response([{id:1,title:'새 검색 결과'}]));await second;waits[0].resolve({ok:false,status:401,json:async()=>({error:'이전 세션 오류'})});await first;
  assert.match(ui.get('#restricted-document-results').innerHTML,/새 검색 결과/);assert.deepEqual(ui.redirects,[]);assert.equal(ui.get('#restricted-document-status').textContent,'1건 조회했습니다.');
});

test('제한 문서 목록 A→B→A 이동 뒤 첫 A 응답과 이전 검색 조건을 재사용하지 않는다',async()=>{
  const waits=[],ui=screen(()=>{const wait=delayed();waits.push(wait);return wait.promise;});ui.state.page='documents';
  const first=ui.context.renderRestrictedDocuments();ui.get('#restricted-document-q').value='첫 현장 조건';const oldSearch=ui.get('#restricted-document-search').onclick();
  ui.state.siteId=2;ui.context.detailEpoch++;const middle=ui.context.renderRestrictedDocuments();waits[2].resolve(response([]));await middle;
  ui.state.siteId=1;ui.context.detailEpoch++;const last=ui.context.renderRestrictedDocuments();waits[3].resolve(response([{id:4,title:'새 A 결과'}]));await last;
  waits[0].resolve(response([{id:1,title:'옛 A 결과'}]));waits[1].resolve(response([{id:2,title:'옛 검색 결과'}]));await Promise.all([first,oldSearch]);
  assert.match(ui.get('#restricted-document-results').innerHTML,/새 A 결과/);assert.doesNotMatch(ui.get('#restricted-document-results').innerHTML,/옛/);assert.equal(ui.get('#restricted-document-q').value,'');
});

test('배정 현장의 체크리스트는 모든 종류의 문항과 저장된 답을 표시한다',async()=>{
  const kinds={rain:'rainChecks',wind:'windChecks',thaw:'thawChecks',heat:'heatChecks',cold:'coldChecks',wet_season:'wetSeasonChecks',heavy_rain:'heavyRainChecks',electrical:'electricalChecks',fire:'fireChecks',formwork:'formworkChecks',falling:'fallingChecks',confined:'confinedChecks',excavation:'excavationChecks',semiannual:'semiannualChecks',morning:'morningChecks',afternoon:'afternoonChecks',evening:'eveningChecks'};
  for(const [kind,key] of Object.entries(kinds)){const doc={id:5,site_id:1,type:'checklist',title:'가상 점검',details:JSON.stringify({kind,answers:[{answer:'<가상 답>',note:'가상 & 비고'}],photoNote:'가상 사진 비고'})},ui=screen(async path=>response(path.endsWith('/attachments')?[{id:7,name:'가상.txt',size:1,category:'morning_hazard_photo'}]:doc));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();for(const name of ui.context[key])assert.ok(ui.content.innerHTML.includes(esc(name)),kind);assert.match(ui.content.innerHTML,/&lt;가상 답&gt;/);assert.match(ui.content.innerHTML,/가상 &amp; 비고/);assert.doesNotMatch(ui.content.innerHTML,/<가상 답>/);if(kind==='morning')assert.match(ui.content.innerHTML,/항목 사진 첨부됨/);if(kind==='wind')assert.match(ui.content.innerHTML,/가상 사진 비고/);}
});

test('배정 현장의 회의 상세는 저장된 안건과 참석자 이름을 안전하게 표시한다',async()=>{
  const details={kind:'정기',host:'주관 <가상>',decisions:'가상 결정',discussion:'가상 협의',timeFrom:'09:00',timeTo:'10:00',place:'가상 장소',remarks:'가상 비고',employeeSnapshot:[{name:'직원 <가상>',phone:'표시 금지'}],managerSnapshot:[{name:'가상 관리자'}],workerSnapshot:[{name:'가상 근로자'}],employerParticipants:['가상 & 사용자'],secret:'표시 금지'};
  for(const type of ['work_council','safety_meeting']){const doc={id:5,site_id:1,type,title:'가상 회의',body:'가상 본문',status:'approved',details:JSON.stringify(details)},ui=screen(async path=>response(path.endsWith('/attachments')?[]:doc));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();for(const text of ['09:00','10:00','가상 장소','가상 비고','직원 &lt;가상&gt;','가상 관리자','가상 근로자','가상 &amp; 사용자'])assert.ok(ui.content.innerHTML.includes(text),text);assert.equal(ui.content.innerHTML.includes('가상 결정'),type==='work_council');assert.doesNotMatch(ui.content.innerHTML,/표시 금지|<가상>|restricted-notice-edit/);assert.deepEqual(ui.requests.map(r=>r.path),['/api/documents/5','/api/documents/5/attachments']);const wrong=screen(async()=>response({...doc,site_id:2}));wrong.state.page='documents';wrong.state.detail=5;await assert.rejects(wrong.context.renderRestrictedDocuments(),/현장/);assert.doesNotMatch(wrong.content.innerHTML,/가상 장소/);}
});

test('회의·교육·계획서 첨부는 현장 전환 후 내려받지 않는다',async()=>{
  for(const type of ['work_council','education','tbm','work_plan']){
  let wait=delayed();const doc={id:5,site_id:1,type,title:'가상',details:'{}'},button={dataset:{meetingFile:'0'},isConnected:true,disabled:false};let clicks=0,link;
  const ui=screen(async path=>path.endsWith('/attachments')?response([{id:7,name:'가상 <파일>.txt',size:4}]):path.endsWith('/attachments/7')?wait.promise:response(doc));ui.state.page='documents';ui.state.detail=5;ui.content.querySelectorAll=selector=>selector==='[data-meeting-file]'?[button]:[];ui.context.URL={createObjectURL:()=> 'blob:가상',revokeObjectURL:()=>{}};ui.context.setTimeout=()=>0;ui.context.document.body={append:()=>{}};ui.context.document.createElement=()=>link={click:()=>clicks++,remove:()=>{}};
  await ui.context.renderRestrictedDocuments();assert.match(ui.content.innerHTML,/가상 &lt;파일&gt;.txt/);const pending=button.onclick();await button.onclick();assert.equal(ui.requests.filter(r=>r.path.endsWith('/attachments/7')).length,1);ui.state.siteId=2;wait.resolve({ok:true,blob:async()=>new Blob(['가상'])});await pending;assert.equal(clicks,0);assert.equal(button.disabled,false);
  ui.state.siteId=1;wait=delayed();const download=button.onclick();wait.resolve({ok:true,blob:async()=>new Blob(['가상'])});await download;assert.equal(clicks,1);assert.equal(link.download,'가상 <파일>.txt');
  }
});

test('배정 현장의 합동 안전점검 상세는 항목과 참석자 이름을 안전하게 표시한다',async()=>{
  const details={improvements:'<보완>',result:'가상 결과',other:'가상 비고',items:[{name:'가상 <항목>',result:'보완사항',issueDetail:'가상 문제',action:'가상 조치'}],managerSnapshot:[{name:'관리자 <가상>',phone:'표시 금지'}],workerSnapshot:[{name:'근로자 & 가상'}],secret:'표시 금지'};
  const doc={id:5,site_id:1,type:'joint_inspection',title:'가상 점검',body:'가상 본문',status:'approved',details:JSON.stringify(details)},ui=screen(async path=>response(path.endsWith('/attachments')?[]:doc));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();
  for(const text of ['&lt;보완&gt;','가상 결과','가상 비고','가상 &lt;항목&gt;','보완사항','가상 문제','가상 조치','관리자 &lt;가상&gt;','근로자 &amp; 가상'])assert.ok(ui.content.innerHTML.includes(text),text);
  assert.doesNotMatch(ui.content.innerHTML,/표시 금지|<항목>|restricted-notice-edit/);assert.deepEqual(ui.requests.map(r=>r.path),['/api/documents/5','/api/documents/5/attachments']);
  const wrong=screen(async()=>response({...doc,site_id:2}));wrong.state.page='documents';wrong.state.detail=5;await assert.rejects(wrong.context.renderRestrictedDocuments(),/현장/);assert.doesNotMatch(wrong.content.innerHTML,/가상 문제/);
  const old=screen(async path=>response(path.endsWith('/attachments')?[]:{...doc,details:null}));old.state.page='documents';old.state.detail=5;await old.context.renderRestrictedDocuments();assert.match(old.content.innerHTML,/점검 항목 없음/);
});

test('제한 작업계획서 기본정보는 명시된 필드·기존 시간·작업구분만 읽고 HTML과 중첩 자료를 차단한다',async()=>{
  const ui=screen(),details=Object.fromEntries(Object.keys(ui.context.planFields).map(key=>[key,'가상 <'+key+'> & 설명']));
  Object.assign(details,{timeFrom:'04:13',timeTo:'23:57',workKinds:['이전 구분 <시험>','기타',{secret:'노출금지'}],equipmentIds:[999],equipmentSnapshot:[{owner:'노출금지'}],workerSnapshot:[{name:'노출금지'}],signature:'노출금지',files:['노출금지']});
  const doc={id:5,site_id:1,type:'work_plan',title:'가상 계획',body:'가상 본문',status:'draft',details:JSON.stringify(details)},files=[{id:7,name:'가상 <계획>.pdf',size:10}],view=screen(async path=>response(path.endsWith('/attachments')?files:doc));view.state.page='documents';view.state.detail=5;const button={dataset:{meetingFile:'0'},isConnected:true};view.content.querySelectorAll=selector=>selector==='[data-meeting-file]'?[button]:[];await view.context.renderRestrictedDocuments();
  for(const key of Object.keys(ui.context.planFields))assert.ok(view.content.innerHTML.includes(esc(details[key])),key);
  assert.match(view.content.innerHTML,/04:13 ~ 23:57/);assert.match(view.content.innerHTML,/이전 구분 &lt;시험&gt;, 기타/);
  assert.doesNotMatch(view.content.innerHTML,/노출금지|999|\[object Object\]|<시험>|data-action=|id="edit"|restricted-notice-edit/);assert.match(view.content.innerHTML,/가상 &lt;계획&gt;\.pdf/);assert.match(view.content.innerHTML,/data-meeting-file="0"/);
  assert.deepEqual(view.requests.map(r=>r.path),['/api/documents/5','/api/documents/5/attachments']);assert.ok(view.requests.every(r=>!r.options.method));view.state.siteId=2;await button.onclick();assert.equal(view.requests.length,2);
  assert.doesNotMatch(planDetailMarkup({equipment:{secret:'노출금지'},personnel:0},esc,ui.context.planFields),/노출금지|object/);assert.match(planDetailMarkup({personnel:0},esc,ui.context.planFields),/> 0</);
});

test('제한 작업계획서 빈·구형 기록과 늦은 응답·다른 현장·문서·인증 실패 경계',async()=>{
  const doc={id:5,site_id:1,type:'work_plan',title:'이전 계획',body:'이전 본문',status:'approved'};
  for(const details of [null,'null','{}','[]','"legacy"']){const ui=screen(async path=>response(path.endsWith('/attachments')?[]:{...doc,details}));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();assert.match(ui.content.innerHTML,/저장된 기본정보가 없습니다/);}
  for(const details of [{company:'이전 업체'},{timeTo:'23:57'}]){const ui=screen(async path=>response(path.endsWith('/attachments')?[]:{...doc,details:JSON.stringify(details)}));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();assert.match(ui.content.innerHTML,details.company?/이전 업체/:/미입력 ~ 23:57/);}
  for(const change of ['site','account','page','detail','epoch'])for(const status of [200,401,403]){
    const wait=delayed(),ui=screen(()=>wait.promise);ui.state.page='documents';ui.state.detail=5;const pending=ui.context.renderRestrictedDocuments();
    if(change==='site')ui.state.siteId=2;else if(change==='account')ui.state.admin={id:8};else if(change==='page')ui.state.page='workers';else if(change==='detail')ui.state.detail=6;else ui.context.detailEpoch++;
    ui.content.innerHTML='새 화면';wait.resolve({ok:status===200,status,json:async()=>status===200?doc:{error:'이전 오류'}});await pending;assert.equal(ui.content.innerHTML,'새 화면');assert.deepEqual(ui.redirects,[]);assert.equal(ui.requests.length,1);
  }
  for(const mismatch of [{site_id:2},{id:6}]){const ui=screen(async()=>response({...doc,...mismatch}));ui.state.page='documents';ui.state.detail=5;await assert.rejects(ui.context.renderRestrictedDocuments(),/현장/);assert.doesNotMatch(ui.content.innerHTML,/이전 계획/);}
  for(const status of [401,403]){const ui=screen(async()=>({ok:false,status,json:async()=>({error:'조회 권한 없음'})}));ui.state.page='documents';ui.state.detail=5;await assert.rejects(ui.context.renderRestrictedDocuments());assert.doesNotMatch(ui.content.innerHTML,/이전 계획/);}
});

test('제한 작업계획서 첨부의 늦은 응답과 권한 오류는 다른 화면을 바꾸지 않는다',async()=>{
  const doc={id:5,site_id:1,type:'work_plan',title:'이전 계획',body:'이전 본문',status:'approved',details:'{}'};
  for(const change of ['site','account','detail','epoch']){
    const wait=delayed(),ui=screen(async path=>path.endsWith('/attachments')?wait.promise:response(doc));ui.state.page='documents';ui.state.detail=5;const pending=ui.context.renderRestrictedDocuments();while(!ui.requests.some(r=>r.path.endsWith('/attachments')))await new Promise(r=>setImmediate(r));
    if(change==='site')ui.state.siteId=2;else if(change==='account')ui.state.admin={id:8};else if(change==='detail')ui.state.detail=6;else ui.context.detailEpoch++;
    ui.content.innerHTML='새 화면';wait.resolve(response([{id:7,name:'이전 파일'}]));await pending;assert.equal(ui.content.innerHTML,'새 화면');
  }
  for(const status of [401,403]){const ui=screen(async path=>path.endsWith('/attachments')?{ok:false,status,json:async()=>({error:'조회 권한 없음'})}:response(doc));ui.state.page='documents';ui.state.detail=5;await assert.rejects(ui.context.renderRestrictedDocuments());assert.doesNotMatch(ui.content.innerHTML,/이전 계획|이전 본문|href=/);}
});

test('제한 위험성평가 상세는 기존 전역 표시와 같은 항목·점수만 읽고 위험 내용을 이스케이프한다',async()=>{
  const row={processName:'가상 <공정>',contractor:'가상 &업체',contractorId:12,task:'시험 작업',hazard:'시험 <위험>',existingMeasures:'기존 조치',additionalMeasures:'추가 조치',riskCategory:'시험 분류',riskType:'시험 형태',legalBasis:'시험 근거',likelihood:'3',severity:'2',improvedLikelihood:'1',improvedSeverity:'2',dueDate:'2026-11-04',completionDate:'2026-11-05',responsible:'가상 담당',supervisorOpinion:'가상 검토'};
  const details={kind:'regular',scale:'3x3',periodFrom:'2026-11-01',periodTo:'2026-11-30',items:[row,{...row,contractorId:13,hazard:'별도 업체 위험'}],musculoskeletalItems:[{...row,selected:true,task:'선택한 근골격계 <작업>'},{selected:false,task:'제외된 근골격계'}],phone:'노출 금지',files:[{name:'노출 금지 파일'}]};
  const doc={id:5,site_id:1,type:'risk',title:'가상 위험성평가',body:'가상 본문',status:'draft',details:JSON.stringify(details)},ui=screen(async()=>response(doc));
  ui.state.page='documents';ui.state.detail=5;ui.state.admin={scope:'restricted',id:4};await ui.context.renderRestrictedDocuments();
  const html=ui.content.innerHTML;
  for(const value of Object.values(row))assert.ok(html.includes(esc(value)),String(value));
  assert.match(html,/정기평가/);assert.match(html,/3×3 위험성 추정/);assert.match(html,/시험 점수<\/strong> 6/);assert.match(html,/개선 후 시험 점수<\/strong> 2/);assert.match(html,/등록번호 12/);assert.match(html,/등록번호 13/);
  assert.match(html,/선택한 근골격계 &lt;작업&gt;/);assert.match(html,/선택하지 않은 1개/);
  assert.doesNotMatch(html,/<공정>|<위험>|노출 금지|제외된 근골격계|data-action=|id="edit"|href=|data-training-file/);
  assert.deepEqual(ui.requests.map(r=>r.path),['/api/documents/5']);assert.ok(ui.requests.every(r=>!r.options.method));
  const {riskFields,riskKinds,riskScales}=ui.context;
  assert.ok(html.includes(riskDetailMarkup(details,esc,riskFields,riskKinds,riskScales)));assert.ok(html.includes(muscleDetailMarkup(details,esc,riskFields)));
});

test('제한 위험성평가 상세는 구형 단일 항목과 빈 기록을 읽는다',async()=>{
  for(const details of [null,'null','{}',JSON.stringify({processName:'이전 공정',task:'이전 작업',hazard:'이전 위험',scale:'three-level',grade:'상',improvedGrade:'하'})]){
    const ui=screen(async()=>response({id:5,site_id:1,type:'risk',title:'이전 평가',body:'',status:'approved',details}));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();
    assert.match(ui.content.innerHTML,/위험성평가 상세/);assert.doesNotMatch(ui.content.innerHTML,/undefined|NaN|시험 점수<\/strong>/);
    if(details?.includes('이전 공정'))for(const value of ['이전 공정','이전 작업','이전 위험','상','하'])assert.ok(ui.content.innerHTML.includes(value));
  }
});

test('제한 위험성평가의 늦은 조회 응답은 현장·계정·페이지·문서·세대 전환 뒤 표시하지 않는다',async()=>{
  const doc={id:5,site_id:1,type:'risk',title:'이전 위험 제목',body:'이전 위험 본문',status:'approved',details:JSON.stringify({hazard:'이전 위험 항목'})};
  for(const change of ['site','account','page','detail','epoch']){
    const wait=delayed(),ui=screen(()=>wait.promise);ui.state.page='documents';ui.state.detail=5;
    const pending=ui.context.renderRestrictedDocuments();
    if(change==='site')ui.state.siteId=2;else if(change==='account')ui.state.admin={id:8};else if(change==='page')ui.state.page='workers';else if(change==='detail')ui.state.detail=6;else ui.context.detailEpoch++;
    ui.content.innerHTML='새 화면';wait.resolve(response(doc));await pending;assert.equal(ui.content.innerHTML,'새 화면');assert.equal(ui.requests.length,1);
  }
  const wrong=screen(async()=>response({...doc,site_id:2}));wrong.state.page='documents';wrong.state.detail=5;await assert.rejects(wrong.context.renderRestrictedDocuments(),/현장/);assert.doesNotMatch(wrong.content.innerHTML,/이전 위험/);
  for(const status of [401,403]){const ui=screen(async()=>({ok:false,status,json:async()=>({error:'조회 권한 없음'})}));ui.state.page='documents';ui.state.detail=5;await assert.rejects(ui.context.renderRestrictedDocuments());assert.doesNotMatch(ui.content.innerHTML,/이전 위험/);}
});

test('제한 교육·TBM 상세는 저장된 필드와 첨부만 표시하고 오래된 화면의 링크를 막는다',async()=>{
  for(const type of ['education','tbm']){
    const details=type==='education'?{kind:'supervisor',timeFrom:'04:13',educationMethod:'이전 <방식>',instructor:'가상 강사',textbook:'가상 교재'}:{weather:'가상 날씨',work:'가상 <작업>',hazards:'가상 위험'};
    const doc={id:5,site_id:1,type,title:'가상 교육',body:'가상 본문',status:'approved',details:JSON.stringify(details)};
    const files=[{id:7,document_id:5,name:'가상 <교육>.txt',size:10,category:'education_material'}];
    const ui=screen(async path=>response(path.endsWith('/attachments')?files:doc));ui.state.page='documents';ui.state.detail=5;ui.state.admin={scope:'restricted',id:4};
    const button={dataset:{meetingFile:'0'},isConnected:true};ui.content.querySelectorAll=selector=>selector==='[data-meeting-file]'?[button]:[];
    await ui.context.renderRestrictedDocuments();
    assert.match(ui.content.innerHTML,/data-meeting-file="0"/);assert.match(ui.content.innerHTML,/가상 &lt;교육&gt;\.txt/);
    for(const value of Object.values(details).filter(v=>v!=='supervisor'))assert.ok(ui.content.innerHTML.includes(esc(value)),value);
    assert.doesNotMatch(ui.content.innerHTML,/id="edit"|data-action=|data-delete-attachment|id="attachment-add"/);
    assert.equal(ui.requests.every(r=>!r.options.method),true);
    ui.state.admin={scope:'restricted',id:8};await button.onclick();assert.equal(ui.requests.length,2);
  }
});

test('제한 교육 첨부 지연·철회·현장 불일치는 상세와 다운로드를 노출하지 않는다',async()=>{
  const doc={id:5,site_id:1,type:'education',title:'가상 이전 교육',body:'이전 본문',status:'approved',details:'{}'};
  for(const change of ['site','account','detail','epoch']){
    const wait=delayed(),ui=screen(async path=>path.endsWith('/attachments')?wait.promise:response(doc));ui.state.page='documents';ui.state.detail=5;
    const pending=ui.context.renderRestrictedDocuments();while(!ui.requests.some(r=>r.path.endsWith('/attachments')))await new Promise(r=>setImmediate(r));
    if(change==='site')ui.state.siteId=2;else if(change==='account')ui.state.admin={id:8};else if(change==='detail')ui.state.detail=6;else ui.context.detailEpoch++;
    ui.content.innerHTML='새 화면';wait.resolve(response([{id:7,name:'이전 파일'}]));await pending;assert.equal(ui.content.innerHTML,'새 화면');
  }
  const wrong=screen(async()=>response({...doc,site_id:2}));wrong.state.page='documents';wrong.state.detail=5;await assert.rejects(wrong.context.renderRestrictedDocuments(),/현장/);assert.equal(wrong.requests.length,1);
  for(const status of [401,403]){
    const ui=screen(async path=>path.endsWith('/attachments')?{ok:false,status,json:async()=>({error:'조회 권한 없음'})}:response(doc));ui.state.page='documents';ui.state.detail=5;
    await assert.rejects(ui.context.renderRestrictedDocuments());assert.doesNotMatch(ui.content.innerHTML,/이전 교육|이전 본문|href=/);
  }
  const old=screen(async path=>response(path.endsWith('/attachments')?[]:{...doc,details:null}));old.state.page='documents';old.state.detail=5;await old.context.renderRestrictedDocuments();assert.match(old.content.innerHTML,/저장된 세부 항목이 없습니다/);assert.match(old.content.innerHTML,/첨부파일이 없습니다/);
});

test('제한 공지 수정은 기존 값과 버전을 보내고 거절되면 입력을 보존한다',async()=>{
  const doc={id:5,site_id:1,type:'notice',title:'가상 <공지>',date:'2026-11-01',body:'가상 </textarea> 본문',status:'draft',edit_version:8,details:'{"retained":"가상 값"}'};
  for(const status of [200,400,401,403,409]){
    const ui=screen(async(path,options)=>options.method==='PUT'?{ok:status===200,status,json:async()=>status===200?doc:{error:'가상 저장 거절'}}:response(path==='/api/sites'?sites:doc));
    ui.state.page='documents';ui.state.detail=5;ui.state.admin={scope:'restricted',id:4};
    await ui.context.renderRestrictedDocuments();ui.get('#restricted-notice-edit').onclick();
    assert.match(ui.get('#dialog-body').innerHTML,/가상 &lt;공지&gt;/);assert.match(ui.get('#dialog-body').innerHTML,/&lt;\/textarea&gt;/);
    const values={title:'가상 수정',date:'2026-11-02',body:'보존할 입력'};await ui.submit(values);
    const writes=ui.requests.filter(r=>r.options.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/documents/5');
    assert.deepEqual(JSON.parse(writes[0].options.body),{siteId:1,type:'notice',...values,expectedEditVersion:8,details:{retained:'가상 값'}});
    assert.equal(ui.dialog.open,status!==200);
    if(status!==200){assert.deepEqual(ui.get('#dialog-form').values,values);assert.ok(ui.get('#dialog-error').textContent);assert.equal(ui.get('#dialog-form button[type=submit]').disabled,false);}
  }
});

test('제한 공지 수정은 상태·현장·계정과 오래된 응답을 검사한다',async()=>{
  const doc={id:5,site_id:1,type:'notice',title:'가상',date:'2026-11-01',body:'가상',status:'draft',edit_version:8,details:'{}'};
  for(const status of ['pending','approved','rejected']){
    const ui=screen(async()=>response({...doc,status}));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();assert.equal(ui.content.innerHTML.includes('id="restricted-notice-edit"'),status==='rejected');
  }
  for(const transition of ['site','account','epoch']){
    const change=ui=>{if(transition==='site')ui.state.siteId=2;else if(transition==='account')ui.state.admin={scope:'restricted',id:99};else ui.context.detailEpoch++;};
    const wait=delayed(),loading=screen(async()=>wait.promise);loading.state.page='documents';loading.state.detail=5;const pending=loading.context.renderRestrictedDocuments();change(loading);loading.content.innerHTML='새 화면';wait.resolve(response(doc));await pending;assert.equal(loading.content.innerHTML,'새 화면');
    const ui=screen(async()=>response(doc));ui.state.page='documents';ui.state.detail=5;await ui.context.renderRestrictedDocuments();ui.get('#restricted-notice-edit').onclick();change(ui);await ui.submit({title:'이전 입력'});assert.equal(ui.requests.filter(r=>r.options.method==='PUT').length,0);
    const saving=delayed(),late=screen(async(path,options)=>options.method==='PUT'?saving.promise:response(doc));late.state.page='documents';late.state.detail=5;await late.context.renderRestrictedDocuments();late.get('#restricted-notice-edit').onclick();const save=late.submit({title:'가상 수정'});change(late);late.content.innerHTML='새 화면';saving.resolve(response(doc));await save;assert.equal(late.content.innerHTML,'새 화면');assert.deepEqual(late.flashes,[]);
  }
});

test('제한 관리자 월별 안내는 조회 월 변경과 5일·6일 새로고침에 맞춰 갱신된다',async()=>{
  const ui=screen(async()=>response([]));let date='2026-12-05';ui.context.today=()=>date;
  ui.get('#restricted-month').value='2026-11';await ui.context.showRestrictedMonth(()=>true);
  const notice=ui.get('#restricted-month-notices');assert.match(notice.innerHTML,/2026-12-05/);assert.match(notice.innerHTML,/교육·TBM 명부/);
  date='2026-12-06';await ui.get('#restricted-month-load').onclick();assert.equal(notice.innerHTML,'');
  ui.get('#restricted-month').value='2026-12';await ui.get('#restricted-month').onchange();assert.match(notice.innerHTML,/2027-01-05/);assert.match(notice.innerHTML,/교육·TBM 명부/);
  date='2027-01-05';await ui.get('#restricted-month-load').onclick();assert.match(notice.innerHTML,/2027-01-05/);
  date='2027-01-06';await ui.get('#restricted-month-load').onclick();assert.equal(notice.innerHTML,'');
  assert.equal(ui.errors.length,0);assert.equal(ui.get('#dialog-error').textContent,'');
});

test('전체 관리자 월별 안내는 실제 월 변경 핸들러의 재렌더에서 기한 전후를 반영한다',()=>{
  const markup=source.split('\n').find(line=>line.includes('<h2>월별 출역</h2>')),change=source.split('\n').find(line=>line.includes("$('#attendance-month').onchange="));assert.ok(markup&&change);
  let date='2026-12-05',rendered='',renders=0;const input={},state={attendanceMonth:'2026-11'},context={state,$:()=>input,content:{insertAdjacentHTML:(_position,html)=>{rendered=html;}},monthly:[],esc,attendanceNoticesMarkup,today:()=>date,showError:error=>{throw error;}};
  context.render=()=>{renders++;runInNewContext(markup,{...context,month:state.attendanceMonth});return Promise.resolve();};
  runInNewContext(change,context);context.render();assert.match(rendered,/2026-12-05/);assert.match(rendered,/교육·TBM 명부/);
  date='2026-12-06';context.render();assert.doesNotMatch(rendered,/수정 기한 참고|교육·TBM 명부/);
  input.onchange({target:{value:'2026-12'}});assert.equal(state.attendanceMonth,'2026-12');assert.match(rendered,/2027-01-05/);assert.match(rendered,/교육·TBM 명부/);assert.equal(renders,3);
  date='2027-01-05';context.render();assert.match(rendered,/2027-01-05/);
  date='2027-01-06';context.render();assert.doesNotMatch(rendered,/수정 기한 참고|교육·TBM 명부/);
});

test('배정 현장 교육 상세 진입점에서 관리자·근로자 대상을 각각 선택하고 버전과 함께 저장한다',async()=>{
  const doc={id:5,site_id:1,type:'education',title:'가상 교육',date:'2026-11-01',body:'',status:'draft',edit_version:8,details:'{"kind":"supervisor_new"}'},targets={configured:true,workers:[{id:20,name:'가상 출역자',present:1,selected:0},{id:21,name:'가상 미출역자',present:0,selected:1}],managers:[{id:10,name:'가상 직원',active:1,selected:0}]};
  for(const conflict of [false,true]){
    const ui=screen(async(path,options)=>options.method==='PUT'?(conflict?{ok:false,status:409,json:async()=>({error:'버전 충돌'})}:response({ok:true})):response(path==='/api/sites'?sites:path.endsWith('/attachments')?[]:path.endsWith('/training-targets')?targets:doc));
    ui.state.page='documents';ui.state.detail=5;ui.state.admin={scope:'restricted',id:4};const formNodes=new Map();
    ui.get('#dialog-body').querySelectorAll=selector=>{
      const markup=ui.get('#dialog-body').innerHTML,all=selector==='[data-restricted-training-all]',kind=selector.match(/="(worker|manager)"/)?.[1],matches=[...markup.matchAll(all?/data-restricted-training-all="([^"]+)"/g:/data-restricted-training="([^"]+)" value="(\d+)" data-present="(\d+)" data-active="(\d+)" ([^>]*)/g)];
      return matches.filter(match=>all||match[1]===kind).map(match=>{const key=all?'all-'+match[1]:match[2];if(!formNodes.has(key))formNodes.set(key,all?{dataset:{restrictedTrainingAll:match[1]},checked:false}:{value:match[2],dataset:{present:match[3],active:match[4]},checked:match[5].includes('checked')});return formNodes.get(key);}).filter(input=>!selector.endsWith(':checked')||input.checked);
    };
    await ui.context.renderRestrictedDocuments();assert.match(ui.content.innerHTML,/교육 대상 조회·설정/);await ui.get('#restricted-education-targets').onclick();assert.equal(ui.dialog.open,true);
    for(const kind of ['manager','worker']){const all=formNodes.get('all-'+kind);all.checked=true;all.onchange();}
    await ui.submit({});const writes=ui.requests.filter(request=>request.options.method==='PUT');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].options.body),{workerIds:[20,21],managerIds:[10],expectedEditVersion:8});
    if(conflict){assert.equal(ui.dialog.open,true);assert.match(ui.get('#dialog-error').textContent,/버전 충돌/);assert.equal(formNodes.get('10').checked,true);}
  }
});

test('교육 대상 조회·저장 콜백은 현장·계정 전환 뒤 새 창을 열거나 이전 대상을 저장하지 않는다',async()=>{
  const doc={id:5,site_id:1,type:'education',title:'가상 교육',date:'2026-11-01',status:'draft',edit_version:8,details:'{"kind":"supervisor_new"}'};
  for(const transition of ['site','account']){
    const wait=delayed(),ui=screen(async path=>path.endsWith('/training-targets')?wait.promise:response(path.endsWith('/attachments')?[]:doc));ui.state.page='documents';ui.state.detail=5;ui.state.admin={scope:'restricted',id:4};
    await ui.context.renderRestrictedDocuments();const opening=ui.get('#restricted-education-targets').onclick();if(transition==='site')ui.state.siteId=2;else ui.state.admin={scope:'restricted',id:99};wait.resolve(response({configured:true,workers:[],managers:[]}));await opening;assert.equal(ui.dialog.open,false);assert.equal(ui.requests.filter(request=>request.options.method==='PUT').length,0);
  }
});

const licenseSection=ui=>ui.get('#dialog-body').children.find(child=>child.tag==='fieldset');
const licenseRows=ui=>licenseSection(ui).children[2].children.map(element=>({name:element.children[0].children[0],number:element.children[1].children[0],remove:element.children[2]}));
const addLicense=ui=>licenseSection(ui).children[3].onclick();

test('제한 관리자 업체 선택은 동명 업체를 번호로 구분하고 입력을 보존한다',async()=>{
  const worker={id:3,name:'가상 근로자',company:'기존 소속',company_id:null,version:'v1',licenses:[]},companies=[{id:11,name:'가상 <업체>',trade:'공종 A'},{id:12,name:'가상 <업체>',trade:'공종 B'}];
  const ui=screen(async(path,options)=>options.method?{ok:false,status:409,json:async()=>({error:'가상 충돌'})}:response(path.startsWith('/api/companies?')?companies:[worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();
  const input=ui.get('#dialog-form input[name=company]'),choice=ui.get('#restricted-company-choice');input.value='보존할 소속';await ui.get('#restricted-company-load').onclick();assert.equal(input.value,'보존할 소속');assert.match(choice.innerHTML,/가상 &lt;업체&gt; · 공종 A · #11/);assert.match(choice.innerHTML,/공종 B · #12/);
  choice.value='12';choice.onchange();assert.equal(input.value,'가상 <업체>');await ui.submit({name:worker.name,company:input.value,companyId:choice.value});assert.equal(JSON.parse(ui.requests.at(-1).options.body).companyId,12);assert.equal(ui.dialog.open,true);
  input.value='직접 입력';input.oninput();assert.equal(choice.value,'0');
});
test('업체 목록의 지연 응답은 바뀐 현장이나 닫힌 창에 적용되지 않는다',async()=>{
  for(const change of ['site','close']){const wait=delayed(),worker={id:3,name:'가상',company:'기존',version:'v1',licenses:[]},ui=screen(async path=>path.startsWith('/api/companies?')?wait.promise:response([worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();const pending=ui.get('#restricted-company-load').onclick();if(change==='site')ui.state.siteId=2;else ui.dialog.close();wait.resolve(response([{id:11,name:'오래된 업체',trade:'가상'}]));await pending;assert.doesNotMatch(ui.get('#restricted-company-choice').innerHTML,/오래된 업체/);}
});
test('업체 재조회는 선택 중 변경과 목록에서 빠진 이전 선택을 보존한다',async()=>{
 const wait=delayed(),worker={id:3,name:'가상',company:'기존',version:'v1',licenses:[]};let call=0;const ui=screen(async path=>path.startsWith('/api/companies?')?(++call===1?response([{id:11,name:'가상 업체',trade:'A'}]):call===2?wait.promise:response([])):response([worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();const choice=ui.get('#restricted-company-choice'),load=ui.get('#restricted-company-load');choice.value='';await load.onclick();choice.value='11';const pending=load.onclick();choice.value='0';wait.resolve(response([{id:11,name:'다른 내용',trade:'B'}]));await pending;assert.equal(choice.value,'0');assert.doesNotMatch(choice.innerHTML,/다른 내용/);choice.value='11';await load.onclick();assert.equal(choice.value,'11');assert.match(choice.innerHTML,/재선택 필요/);
});

test('제한 관리자가 등록 업체 소속을 직접 변경할 때만 연결 해제를 요청한다',async()=>{
  const worker={id:3,name:'가상 근로자',company:'가상 업체',company_id:12,version:'v1',licenses:[]};
  const ui=screen(async(path,options)=>options.method?{ok:false,status:409,json:async()=>({error:'가상 충돌'})}:response([worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();
  assert.match(ui.get('#dialog-body').innerHTML,/연결은 해제/);
  await ui.submit({name:worker.name,company:'  가상 업체  '});let data=JSON.parse(ui.requests.at(-1).options.body);assert.equal(Object.hasOwn(data,'companyId'),false);assert.equal(data.version,'v1');
  await ui.submit({name:worker.name,company:'가상 다른 소속'});data=JSON.parse(ui.requests.at(-1).options.body);assert.equal(data.companyId,0);assert.equal(data.version,'v1');assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-form').values.company,'가상 다른 소속');
});

test('제한 면허 등록·수정은 기존 행·선택 입력·20행·100자·문자열 표시를 보존한다',async()=>{
  const worker={id:3,name:'가상 근로자',version:'v1',licenses:[{name:'<가상 면허>',number:'가상-001'}]};
  const ui=screen(async(path,options)=>options.method?{ok:false,status:409,json:async()=>({error:'가상 충돌'})}:response([worker]));ui.state.page='workers';
  await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();
  let row=licenseRows(ui)[0];assert.equal(row.name.value,'<가상 면허>');assert.equal(row.name.innerHTML,'');assert.equal(row.name.maxLength,100);assert.equal(row.number.maxLength,100);assert.equal(!!row.name.required,false);
  row.name.value=' 가상 변경 ';row.number.value='';addLicense(ui);licenseRows(ui)[1].number.value=' 가상-002 ';addLicense(ui);licenseRows(ui)[2].name.value='   ';
  await ui.submit({name:'가상 수정',memo:'가상 메모'});
  assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body),{name:'가상 수정',memo:'가상 메모',siteId:1,version:'v1',licenses:[{name:'가상 변경',number:''},{name:'',number:'가상-002'}]});
  assert.equal(ui.dialog.open,true);assert.equal(row.name.value,' 가상 변경 ');assert.equal(ui.get('#dialog-form').values.memo,'가상 메모');assert.match(ui.get('#dialog-error').textContent,/충돌/);
  for(let i=0;i<25;i++)addLicense(ui);assert.equal(licenseRows(ui).length,20);assert.equal(licenseSection(ui).children[3].disabled,true);row.remove.onclick();assert.equal(licenseSection(ui).children[3].disabled,false);
  for(const row of licenseRows(ui))row.remove.onclick();await ui.submit({name:'가상 수정'});assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body).licenses,[]);
  ui.get('#restricted-worker-add').onclick();assert.equal(licenseRows(ui).length,0);addLicense(ui);licenseRows(ui)[0].name.value='가상 신규';await ui.submit({name:'가상 신규 근로자'});assert.equal(ui.requests.at(-1).options.method,'POST');assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body).licenses,[{name:'가상 신규',number:''}]);
});

test('제한 면허 오류 입력 보존·저장 중 행 변경 차단·현장 계정 페이지 창 전환 후 콜백과 늦은 응답 차단',async()=>{
  const worker={id:3,name:'가상 근로자',version:'v1',licenses:[{name:'가상 면허',number:'가상-001'}]};
  for(const status of [400,401,403,409,500]){
    const ui=screen(async(path,options)=>options.method?{ok:false,status,json:async()=>({error:'가상 거절'})}:response([worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();
    licenseRows(ui)[0].name.value='가상 보존';await ui.submit({name:'가상 이름'});assert.equal(ui.dialog.open,true);assert.equal(licenseRows(ui)[0].name.value,'가상 보존');assert.equal(ui.get('#dialog-form button[type=submit]').disabled,false);assert.ok(ui.get('#dialog-error').textContent);
  }
  for(const transition of ['site','account','page','dialog','close'])for(const status of [200,401,409]){
    const wait=delayed(),ui=screen(async(path,options)=>options.method?wait.promise:response([worker]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-worker="3"]').onclick();
    const section=licenseSection(ui),row=licenseRows(ui)[0],add=section.children[3],save=ui.get('#dialog-form').onsubmit;
    const pending=ui.submit({name:'가상 저장'});add.onclick();row.remove.onclick();await ui.submit({name:'중복'});assert.equal(section.children[2].children.length,1);assert.equal(ui.requests.filter(r=>r.options.method).length,1);
    if(transition==='site')ui.state.siteId=2;if(transition==='account')ui.state.admin={scope:'restricted',id:99};if(transition==='page')ui.state.page='documents';if(transition==='dialog')ui.context.showDialog('다른 창','가상 내용',async()=>{});if(transition==='close')ui.dialog.close();
    add.onclick();row.remove.onclick();await save({preventDefault(){},currentTarget:ui.get('#dialog-form')});assert.equal(section.children[2].children.length,1);assert.equal(ui.requests.filter(r=>r.options.method).length,1);
    const body=ui.get('#dialog-body').innerHTML,opened=ui.dialog.open;wait.resolve({ok:status===200,status,json:async()=>status===200?worker:{error:'늦은 오류'}});await pending;assert.equal(ui.get('#dialog-body').innerHTML,body);assert.equal(ui.dialog.open,opened);assert.equal(ui.get('#dialog-error').textContent,'');assert.deepEqual(ui.flashes,[]);assert.deepEqual(ui.redirects,[]);
  }
});

test('월 편집기 통합: 미저장·저장 중 월 전환 방지, 조회 실패 보존, 저장 후 요약·인원 동기화',async()=>{
  const row={id:3,name:'가상 근로자',days:['2024-02-29'],version:'v1',units:[{date:'2024-02-29',units_hundredths:75}]};
  let fail=false,dirty=false,busy=false,mounted;
  const ui=screen(async()=>{if(fail)throw Error('가상 조회 장애');return response([row]);});
  ui.context.mountRestrictedMonthEditor=options=>{mounted=options;return {dirty:()=>dirty,busy:()=>busy};};
  ui.get('#restricted-month').value='2024-02';await ui.context.showRestrictedMonth(()=>true);
  dirty=true;ui.context.confirm=()=>false;const count=ui.requests.length;ui.get('#restricted-month').value='2024-03';await ui.get('#restricted-month').onchange();assert.equal(ui.get('#restricted-month').value,'2024-02');assert.equal(ui.requests.length,count);
  busy=true;ui.context.confirm=()=>true;ui.get('#restricted-month').value='2024-03';await ui.get('#restricted-month').onchange();assert.equal(ui.get('#restricted-month').value,'2024-02');assert.equal(ui.requests.length,count);
  busy=false;fail=true;ui.get('#restricted-month-editor').innerHTML='보존할 입력';ui.get('#restricted-month').value='2024-03';await ui.get('#restricted-month').onchange();assert.equal(ui.get('#restricted-month').value,'2024-02');assert.equal(ui.get('#restricted-month-editor').innerHTML,'보존할 입력');assert.equal(ui.get('#restricted-month-editor').inert,false);assert.match(ui.get('#dialog-error').textContent,/가상 조회 장애/);
  mounted.onRows([{...row,days:[],units:[]},{id:4,name:'새 가상 근로자',days:[],units:[],version:'v2'}]);
  assert.match(ui.get('#restricted-month-details').innerHTML,/0일/);assert.match(ui.get('#restricted-month-details').innerHTML,/새 가상 근로자/);assert.doesNotMatch(ui.get('#restricted-month-details').innerHTML,/공수 0.75/);assert.match(ui.get('#restricted-month-status').textContent,/2명/);
  mounted.onRows([]);assert.match(ui.get('#restricted-month-details').innerHTML,/등록된 근로자가 없습니다/);
});

test('월별 조회 경계·버전 충돌 입력 보존·재조회 및 늦은 응답 차단',async()=>{
  const row={id:3,name:'가상 근로자',days:['2024-02-29'],version:'v1',units:[{date:'2024-02-29',units_hundredths:75,company:'가상 소속'}]};
  const ui=screen(async(path,options)=>options.method?{ok:false,status:409,json:async()=>({error:'다른 관리자가 변경했습니다.'})}:response([row]));
  ui.get('#restricted-month').value='2024-02';await ui.context.showRestrictedMonth(()=>true);assert.match(ui.get('#restricted-month-results').innerHTML,/2024-02-29/);
  ui.get('[data-restricted-month-worker="3"]').onclick();await ui.submit({company:'새 가상 소속',category:'',occupation:''});
  assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-form').values.company,'새 가상 소속');assert.match(ui.get('#dialog-error').textContent,/다른 관리자/);
  assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body),{siteId:1,workerId:3,month:'2024-02',expectedVersion:'v1',company:'새 가상 소속'});
  const wait=delayed(),late=screen(async()=>wait.promise);const pending=late.context.showRestrictedMonth(()=>true);late.dialog.close();wait.resolve(response([row]));await pending;assert.equal(late.get('#restricted-month-results').innerHTML,'');
  for(const month of ['2024-00','2024-13','0000-01','']){const invalid=screen();invalid.get('#restricted-month').value=month;await invalid.context.showRestrictedMonth(()=>true);assert.equal(invalid.requests.length,0);}
});

function qrScreen(fetcher){
  const ui=screen(fetcher),result=ui.get('#restricted-qr-result'),printed=[];let elements=[];
  Object.defineProperty(result,'innerHTML',{get(){return this.markup||'';},set(value){
    this.markup=value;for(const element of elements){element.isConnected=false;ui.nodes.delete('#'+element.id);}elements=[];
    for(const [,id] of value.matchAll(/id="([^"]+)"/g)){const element=ui.get('#'+id);Object.assign(element,{id,isConnected:true,complete:false,naturalWidth:0});elements.push(element);}
  }});
  ui.dialog.dataset={};ui.dialog.querySelector=selector=>ui.nodes.get(selector)||null;
  ui.context.printSiteQr=(dialog,mode)=>printSiteQr(dialog,mode,()=>printed.push({mode:dialog.dataset.qrPrint,image:dialog.querySelector(mode==='access'?'#login-qr-image':'#invite-qr-image').id}));
  return {...ui,printed};
}
const qrResult={image:'data:image/png;base64,virtual',link:'https://example.invalid/virtual',accessFingerprint:'virtual',valid:true,expiresAt:'2026-11-03T00:00:00.000Z'};

test('제한 QR 접속·초대·교체는 공통 출력 구조와 해당 이미지 준비 검사를 사용한다',async()=>{
  const ui=qrScreen(async path=>response(path.endsWith('/status')?{accessFingerprint:'virtual',valid:true,expiresAt:Date.now()+60000}:qrResult));await ui.context.showRestrictedQr();
  assert.match(ui.get('#dialog-body').innerHTML,/<div id="restricted-qr-result" class="qr">/);
  for(const kind of ['access','invite','rotate']){
    await ui.get('[data-restricted-qr="'+kind+'"]').onclick();
    const mode=kind==='invite'?'invite':'access',id=mode==='invite'?'invite-qr-image':'login-qr-image',button=ui.get('#restricted-qr-print'),image=ui.get('#'+id),markup=ui.get('#restricted-qr-result').innerHTML,before=ui.printed.length;
    assert.match(markup,/<h3 class="qr-site-name">가상 첫 현장<\/h3>/);assert.match(markup,new RegExp('id="'+id+'"'));assert.match(markup,/https:\/\/example.invalid\/virtual/);
    if(mode==='invite'){assert.match(markup,/<div id="invite-result">/);assert.match(markup,/유효기간:/);assert.doesNotMatch(markup,/id="login-qr/);}else{assert.match(markup,/id="login-qr-address"/);assert.doesNotMatch(markup,/id="invite-qr/);}
    button.onclick();assert.equal(ui.printed.length,before);assert.match(ui.get('#dialog-error').textContent,/이미지/);
    image.complete=true;button.onclick();assert.equal(ui.printed.length,before);assert.match(ui.get('#dialog-error').textContent,/이미지/);
    image.naturalWidth=256;await button.onclick();assert.equal(ui.printed.length,before);button.onclick();assert.deepEqual(ui.printed.at(-1),{mode,image:id});assert.equal(ui.printed.length,before+1);assert.equal(ui.get('#dialog-error').textContent,'');
  }
});

test('제한 QR 구 출력 버튼은 새 요청·오류·현장·계정·화면·다른 창 이후 인쇄하지 않는다',async()=>{
  for(const transition of ['site','account','page','close','dialog','request','failure']){
    const wait=delayed();let defer=false;const ui=qrScreen(async()=>defer?wait.promise:response(qrResult));await ui.context.showRestrictedQr();await ui.get('[data-restricted-qr="access"]').onclick();
    const stale=ui.get('#restricted-qr-print');Object.assign(ui.get('#login-qr-image'),{complete:true,naturalWidth:256});let pending;
    if(transition==='site')ui.state.siteId=2;
    if(transition==='account')ui.state.admin={id:99};
    if(transition==='page'){ui.state.page='documents';ui.context.detailEpoch++;}
    if(transition==='close')ui.dialog.close();
    if(transition==='dialog')ui.context.showDialog('다른 창','새 입력',async()=>{});
    if(['request','failure'].includes(transition)){defer=true;pending=ui.get('[data-restricted-qr="invite"]').onclick();assert.equal(stale.isConnected,false);}
    stale.onclick();assert.equal(ui.printed.length,0);
    if(pending){wait.resolve(transition==='failure'?{ok:false,status:403,json:async()=>({error:'가상 거절'})}:response(qrResult));await pending;if(transition==='request')Object.assign(ui.get('#invite-qr-image'),{complete:true,naturalWidth:256});stale.onclick();assert.equal(ui.printed.length,0);}
  }
});

test('제한 QR 실패시 이전 주소 제거·재시도·닫힌 창과 현장 및 계정 전환 응답 무시',async()=>{
  let fail=false;const ui=screen(async()=>fail?{ok:false,status:403,json:async()=>({error:'거부'})}:response({image:'data:image/png;base64,virtual',link:'https://example.invalid/virtual'}));
  await ui.context.showRestrictedQr();await ui.get('[data-restricted-qr="access"]').onclick();assert.match(ui.get('#restricted-qr-result').innerHTML,/example.invalid/);
  fail=true;await ui.get('[data-restricted-qr="rotate"]').onclick();assert.equal(ui.get('#restricted-qr-result').innerHTML,'');assert.match(ui.get('#dialog-error').textContent,/거부/);
  fail=false;await ui.get('[data-restricted-qr="access"]').onclick();assert.match(ui.get('#restricted-qr-result').innerHTML,/example.invalid/);
  ui.context.confirm=()=>false;const before=ui.requests.length;await ui.get('[data-restricted-qr="revoke"]').onclick();assert.equal(ui.requests.length,before);
  for(const transition of ['close','site','account']){const wait=delayed(),late=screen(async()=>wait.promise);await late.context.showRestrictedQr();const pending=late.get('[data-restricted-qr="access"]').onclick();if(transition==='close')late.dialog.close();if(transition==='site')late.state.siteId=2;if(transition==='account')late.state.admin={id:99};wait.resolve(response({image:'late',link:'late'}));await pending;assert.equal(late.get('#restricted-qr-result').innerHTML,'');}
});

test('실제 출역 화면에서 연 월별 폼은 현장·계정 전환 후 저장하지 않고 QR 화면은 현장 전환시 비운다',async()=>{
  const row={id:3,name:'가상 근로자',days:['2026-11-02'],version:'v1',units:[],present:1};
  for(const transition of ['site','account']){
    const ui=screen(async()=>response([row]));ui.state.page='attendance';ui.state.admin={scope:'restricted'};
    await ui.context.renderRestrictedWorkforce();await ui.get('#restricted-month-open').onclick();ui.get('[data-restricted-month-worker="3"]').onclick();
    if(transition==='site')ui.state.siteId=2;else ui.state.admin={scope:'restricted',id:99};
    const before=ui.requests.length;await ui.submit({company:'보존할 값'});assert.equal(ui.requests.length,before);assert.equal(ui.get('#dialog-form').values.company,'보존할 값');
  }
  const ui=screen(async(path)=>response(path.includes('/access')?{image:'virtual',link:'https://example.invalid/virtual'}:[]));ui.state.admin={scope:'restricted'};
  await ui.context.showRestrictedQr();await ui.get('[data-restricted-qr="access"]').onclick();ui.get('#site-select').value='2';ui.get('#site-select').onchange();
  assert.equal(ui.dialog.open,false);assert.equal(ui.get('#dialog-body').innerHTML,'');await ui.context.renderPending;
});

test('전역만 계정·전체현장·미검증 메뉴 노출, 제한은 검증된 문서·근로자·출역 메뉴만 표시',()=>{
  const ui=screen();ui.context.applyAdminScope({scope:'restricted',siteIds:[1]});
  assert.deepEqual(ui.pages.filter(p=>!p.hidden).map(p=>p.dataset.page),['documents','workers','attendance','equipment-attendance']);
  for(const key of ['#site-add','#sticker-requests','#ai-chat'])assert.equal(ui.get(key).hidden,true);
  assert.equal(ui.get('#site-qr').hidden,false);
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
    ui.context.detailEpoch++;ui.state.page='documents';ui.state.siteId=2;ui.content.innerHTML='새 화면';wait.resolve(response(target==='accounts'?[account]:sites));await pending;
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

test('근로자·출역 이전 응답·이전 폼은 현장 및 계정 변경 뒤 화면과 저장에 영향을 주지 않는다',async()=>{
  for(const page of ['workers','attendance'])for(const transition of ['site','account']){
    const wait=delayed(),ui=screen(async()=>wait.promise);ui.state.page=page;ui.state.admin={scope:'restricted'};
    const pending=ui.context.renderRestrictedWorkforce();ui.content.innerHTML='새 화면';
    if(transition==='site'){ui.state.siteId=2;ui.context.detailEpoch++;}else ui.state.admin={scope:'restricted',id:2};
    wait.resolve(response([{id:1,name:'이전 근로자'}]));await pending;assert.equal(ui.content.innerHTML,'새 화면');
    const formUi=screen(async()=>response([{id:1,name:'가상 근로자',present:1,day_version:2,version:'v1'}]));formUi.state.page=page;formUi.state.admin={scope:'restricted'};
    await formUi.context.renderRestrictedWorkforce();formUi.get(page==='workers'?'#restricted-worker-add':'[data-restricted-presence="1"]').onclick();
    if(transition==='site'){formUi.state.siteId=2;formUi.context.detailEpoch++;}else formUi.state.admin={scope:'restricted',id:2};
    await formUi.submit({name:'가상',present:'1'});assert.equal(formUi.requests.length,1);assert.equal(formUi.flashes.length,0);
  }
});

test('근로자·출역·공수 저장 실패는 입력과 창을 유지하며 지연 성공은 새 화면을 변경하지 않는다',async()=>{
  for(const action of ['worker','presence','units'])for(const status of [400,403,409,401]){
    const ui=screen(async(path,options)=>options.method?{ok:false,status,json:async()=>({error:'가상 저장 거절'})}:response([{id:1,name:'가상',present:1,day_version:2,version:'v1'}]));ui.state.page=action==='worker'?'workers':'attendance';
    await ui.context.renderRestrictedWorkforce();ui.get('[data-restricted-'+action+'="1"]').onclick();const values={name:'보존할 가상 입력',present:'0',units:'0.75'};await ui.submit(values);
    assert.equal(ui.dialog.open,true);assert.deepEqual(ui.get('#dialog-form').values,values);assert.equal(ui.get('#dialog-form button[type=submit]').disabled,false);assert.ok(ui.get('#dialog-error').textContent);assert.equal(ui.flashes.length,0);
  }
  const wait=delayed(),ui=screen(async(path,options)=>options.method?wait.promise:response([]));ui.state.page='workers';await ui.context.renderRestrictedWorkforce();ui.get('#restricted-worker-add').onclick();const pending=ui.submit({name:'가상'});ui.context.detailEpoch++;ui.state.siteId=2;ui.content.innerHTML='새 현장';wait.resolve(response({id:2}));await pending;assert.equal(ui.content.innerHTML,'새 현장');assert.equal(ui.flashes.length,0);
});

test('실제 HTTP 로그인→배정 현장 선택→공지·근로자·출역·공수·장비 출역 UI 저장·재조회, 다른 현장 거절 및 배정 제거 재로그인',{timeout:30000},async()=>{
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
    ui.get('#site-select').value=String(created[1].id);ui.get('#site-select').onchange();await ui.context.renderPending;assert.equal(ui.state.siteId,created[1].id);ui.get('#restricted-notice-add').onclick();await ui.submit({title:'가상 제한 공지',date:'2026-11-02',body:'가상 본문'});assert.equal(ui.dialog.open,false);assert.match(ui.get('#restricted-document-results').innerHTML,/가상 제한 공지/);assert.deepEqual(ui.errors,[]);
    for(const [key,value] of Object.entries({type:'notice',q:'가상 본문',from:'2026-11-02',to:'2026-11-02'}))ui.get('#restricted-document-'+key).value=value;
    await ui.get('#restricted-document-search').onclick();assert.match(ui.get('#restricted-document-results').innerHTML,/가상 제한 공지/);
    ui.get('#restricted-document-from').value='2026-11-03';ui.get('#restricted-document-to').value='2026-11-04';await ui.get('#restricted-document-search').onclick();assert.match(ui.get('#restricted-document-results').innerHTML,/조회 조건에 맞는 문서가 없습니다/);
    await ui.get('#restricted-document-reset').onclick();assert.match(ui.get('#restricted-document-results').innerHTML,/가상 제한 공지/);
    const equipmentResponse=await send('/api/equipment','POST',{siteId:created[1].id,kind:'가상 UI 장비',model:'가상 형식',registration:'가상-031',capacity:'가상 용량',manufacturer:'가상 제조사',owner:'민감소유주'},globalCookie);assert.equal(equipmentResponse.status,201);const equipment=await equipmentResponse.json();
    ui.state.page='equipment-attendance';await ui.context.render();ui.get('#equipment-attendance-add').onclick();assert.doesNotMatch(ui.get('#dialog-body').innerHTML,/driverBirth|driverPhone/);await ui.submit({equipmentId:String(equipment.id),date:'2026-11-02',driverName:'가상 UI 운전원',note:'가상 출역 메모'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/가상 UI 장비/);assert.doesNotMatch(ui.content.innerHTML,/민감소유주|생년월일|연락처/);
    const equipmentList=async()=>(await(await send('/api/equipment-attendance?siteId='+created[1].id+'&month=2026-11','GET',null,cookie)).json());let record=(await equipmentList())[0];assert.equal(record.note,'가상 출역 메모');ui.get('[data-equipment-attendance-edit="'+record.id+'"]').onclick();assert.equal((await send('/api/equipment-attendance/'+record.id,'PUT',{siteId:created[1].id,date:record.date,driverName:'가상 다른 수정',note:'가상 충돌용',expectedVersion:record.version},cookie)).status,200);await ui.submit({date:'2026-11-03',driverName:'가상 UI 변경',note:'충돌 보존'});assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-form').values.note,'충돌 보존');assert.ok(ui.get('#dialog-error').textContent);ui.dialog.close();await ui.context.render();
    record=(await equipmentList())[0];ui.get('[data-equipment-attendance-edit="'+record.id+'"]').onclick();await ui.submit({date:'2026-11-03',driverName:'가상 UI 변경',note:'가상 변경 완료'});assert.equal(ui.dialog.open,false);assert.equal((await equipmentList())[0].note,'가상 변경 완료');await ui.get('[data-equipment-attendance-delete="'+record.id+'"]').onclick();assert.deepEqual(await equipmentList(),[]);assert.match(ui.content.innerHTML,/기록이 없습니다/);
    assert.equal((await send('/api/equipment-attendance?siteId='+created[2].id+'&month=2026-11','GET',null,cookie)).status,403);ui.state.page='documents';await ui.context.render();
    const documents=await(await send('/api/documents?siteId='+created[1].id,'GET',null,cookie)).json();assert.equal(documents.length,1);assert.equal(documents[0].status,'draft');assert.equal(documents[0].site_id,created[1].id);
    ui.content.querySelectorAll('[data-restricted-doc]')[0].onclick();await ui.context.renderPending;assert.equal(ui.state.detail,documents[0].id);assert.match(ui.content.innerHTML,/가상 본문/);assert.doesNotMatch(ui.content.innerHTML,/결재 요청|암호 초기화/);
    const noticePath='/api/documents/'+documents[0].id,noticeInput={siteId:created[1].id,type:'notice',title:'가상 동시 수정',date:'2026-11-02',body:'다른 변경',expectedEditVersion:documents[0].edit_version};
    ui.get('#restricted-notice-edit').onclick();assert.equal((await send(noticePath,'PUT',noticeInput,globalCookie)).status,200);await ui.submit({title:'가상 충돌 입력',date:'2026-11-02',body:'보존할 본문'});assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-form').values.body,'보존할 본문');assert.match(ui.get('#dialog-error').textContent,/변경/);assert.equal((await(await send(noticePath,'GET',null,cookie)).json()).title,'가상 동시 수정');
    ui.dialog.close();await ui.context.render();ui.get('#restricted-notice-edit').onclick();await ui.submit({title:'가상 공지 수정 완료',date:'2026-11-03',body:'가상 수정 본문'});assert.equal(ui.dialog.open,false);const updatedNotice=await(await send(noticePath,'GET',null,cookie)).json();assert.equal(updatedNotice.title,'가상 공지 수정 완료');assert.equal(updatedNotice.body,'가상 수정 본문');assert.equal(updatedNotice.date,'2026-11-03');assert.equal(updatedNotice.status,'draft');
    const jointInput={type:'joint_inspection',title:'가상 합동 점검',date:'2026-11-03',details:{items:[{name:'가상 점검 항목',result:'보완사항',issueDetail:'가상 문제',action:'가상 조치'}]}};
    const jointResponse=await send('/api/documents','POST',{...jointInput,siteId:created[1].id},globalCookie),foreignResponse=await send('/api/documents','POST',{...jointInput,siteId:created[2].id},globalCookie);assert.equal(jointResponse.status,201);assert.equal(foreignResponse.status,201);const joint=await jointResponse.json(),foreignJoint=await foreignResponse.json();
    const checkMeetingFile=async(id,foreignId)=>{const uploaded=await fetch(base+`/api/documents/${id}/attachments`,{method:'POST',headers:{cookie:globalCookie,'x-file-name':'virtual.txt','content-type':'application/octet-stream'},body:'virtual attachment'});assert.equal(uploaded.status,201);const file=await uploaded.json(),path=`/api/documents/${id}/attachments/${file.id}`,read=await send(path,'GET',null,cookie);assert.equal(read.status,200);assert.equal(await read.text(),'virtual attachment');assert.equal((await send(`/api/documents/${foreignId}/attachments/${file.id}`,'GET',null,cookie)).status,403);assert.equal((await send(`/api/documents/${documents[0].id}/attachments/${file.id}`,'GET',null,cookie)).status,403);};await checkMeetingFile(joint.id,foreignJoint.id);
    const checkInput={type:'checklist',title:'가상 체크리스트',date:'2026-11-03',details:{kind:'rain',answers:Array.from({length:7},()=>({answer:'O',note:'가상 비고'}))}},checkResponse=await send('/api/documents','POST',{...checkInput,siteId:created[1].id},globalCookie),foreignCheckResponse=await send('/api/documents','POST',{...checkInput,siteId:created[2].id},globalCookie);assert.equal(checkResponse.status,201);assert.equal(foreignCheckResponse.status,201);const checkDoc=await checkResponse.json(),foreignCheck=await foreignCheckResponse.json();await checkMeetingFile(checkDoc.id,foreignCheck.id);const checkUi=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie,'x-admin-context':session.context}}));checkUi.context.applyAdminScope(session.admin);checkUi.state.siteId=created[1].id;checkUi.state.page='documents';checkUi.state.detail=checkDoc.id;await checkUi.context.renderRestrictedDocuments();assert.match(checkUi.content.innerHTML,/기상특보 확인/);assert.match(checkUi.content.innerHTML,/가상 비고/);assert.match(checkUi.content.innerHTML,/virtual.txt/);assert.equal((await send('/api/documents/'+foreignCheck.id,'GET',null,cookie)).status,403);
    for(const type of ['education','tbm','work_plan']){const input={type,title:'가상 문서',date:'2026-11-03',details:{}},createdDoc=await send('/api/documents','POST',{...input,siteId:created[1].id},globalCookie);assert.equal(createdDoc.status,201);const doc=await createdDoc.json(),upload=await fetch(base+`/api/documents/${doc.id}/attachments`,{method:'POST',headers:{cookie:globalCookie,'x-file-name':'virtual.txt'},body:'virtual attachment'});assert.equal(upload.status,201);const file=await upload.json(),path=`/api/documents/${doc.id}/attachments/${file.id}`;assert.equal((await fetch(base+path,{headers:{cookie,'x-admin-context':session.context}})).status,200);assert.equal((await fetch(base+path,{headers:{cookie:globalCookie,'x-admin-context':session.context}})).status,409);}
    const jointUi=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie,'x-admin-context':session.context}}));jointUi.context.applyAdminScope(session.admin);jointUi.state.siteId=created[1].id;jointUi.state.page='documents';jointUi.state.detail=joint.id;await jointUi.context.renderRestrictedDocuments();assert.match(jointUi.content.innerHTML,/가상 점검 항목/);assert.match(jointUi.content.innerHTML,/가상 문제/);assert.match(jointUi.content.innerHTML,/가상 조치/);assert.equal((await send('/api/documents/'+foreignJoint.id,'GET',null,cookie)).status,403);
    for(const type of ['work_council','safety_meeting']){const input={type,title:'가상 회의',date:'2026-11-03',details:{kind:'정기 회의',place:'가상 회의실',remarks:'가상 메모',employerParticipants:['가상 참석자']}},meetingResponse=await send('/api/documents','POST',{...input,siteId:created[1].id},globalCookie),foreignMeetingResponse=await send('/api/documents','POST',{...input,siteId:created[2].id},globalCookie);assert.equal(meetingResponse.status,201);assert.equal(foreignMeetingResponse.status,201);const meeting=await meetingResponse.json(),foreignMeeting=await foreignMeetingResponse.json();await checkMeetingFile(meeting.id,foreignMeeting.id);jointUi.state.detail=meeting.id;await jointUi.context.renderRestrictedDocuments();assert.match(jointUi.content.innerHTML,/가상 회의실/);assert.match(jointUi.content.innerHTML,/가상 참석자/);assert.match(jointUi.content.innerHTML,/virtual.txt/);assert.equal((await send('/api/documents/'+foreignMeeting.id,'GET',null,cookie)).status,403);}
    assert.equal((await send('/api/documents?siteId='+created[2].id,'GET',null,cookie)).status,403);assert.equal((await send('/api/admin-accounts','GET',null,cookie)).status,403);
    ui.state.page='workers';ui.state.detail=null;await ui.context.render();assert.match(ui.content.innerHTML,/등록된 근로자가 없습니다/);
    ui.get('#restricted-worker-add').onclick();addLicense(ui);licenseRows(ui)[0].name.value='가상 면허';licenseRows(ui)[0].number.value='가상-001';await ui.submit({name:'가상 UI 근로자',category:'직영',company:'',occupation:'가상 직종',memo:'가상 메모'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/가상 UI 근로자/);
    const worker=(await(await send('/api/workers?siteId='+created[1].id,'GET',null,cookie)).json())[0];assert.equal(worker.site_id,created[1].id);assert.deepEqual(worker.licenses,[{name:'가상 면허',number:'가상-001'}]);
    ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();assert.equal(licenseRows(ui)[0].name.value,'가상 면허');licenseRows(ui)[0].number.value='가상-002';await ui.submit({name:'가상 UI 수정',category:'직영',company:'',occupation:'가상 직종',memo:'수정 메모'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/가상 UI 수정/);
    const readWorker=async()=>(await(await send('/api/workers?siteId='+created[1].id,'GET',null,cookie)).json())[0];
    let saved=await readWorker();assert.deepEqual(saved.licenses,[{name:'가상 면허',number:'가상-002'}]);
    const basic={siteId:created[1].id,name:'가상 UI 수정',category:'직영',company:'',occupation:'가상 직종',memo:'수정 메모'};
    assert.equal((await send('/api/workers/'+worker.id,'PUT',{...basic,version:saved.version,memo:'가상 생략 보존'},cookie)).status,200);saved=await readWorker();assert.deepEqual(saved.licenses,[{name:'가상 면허',number:'가상-002'}]);
    await ui.context.render();ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();licenseRows(ui)[0].number.value='가상 충돌 입력';
    assert.equal((await send('/api/workers/'+worker.id,'PUT',{...basic,version:saved.version,licenses:[{name:'가상 동시 수정',number:'가상-003'}]},cookie)).status,200);
    await ui.submit(basic);assert.equal(ui.dialog.open,true);assert.match(ui.get('#dialog-error').textContent,/다시|변경/);assert.equal(licenseRows(ui)[0].number.value,'가상 충돌 입력');assert.deepEqual((await readWorker()).licenses,[{name:'가상 동시 수정',number:'가상-003'}]);
    ui.dialog.close();await ui.context.render();ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();
    for(let i=1;i<20;i++)addLicense(ui);for(const row of licenseRows(ui)){row.name.value='가'.repeat(100);row.number.value='0'.repeat(100);}await ui.submit(basic);assert.equal(ui.dialog.open,false);saved=await readWorker();assert.equal(saved.licenses.length,20);assert.ok(saved.licenses.every(row=>row.name.length===100&&row.number.length===100));
    assert.equal((await send('/api/workers/'+worker.id,'PUT',{...basic,version:saved.version,licenses:Array.from({length:21},()=>({name:'가상'}))},cookie)).status,400);
    ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();licenseRows(ui)[0].number.value='0'.repeat(101);await ui.submit(basic);assert.equal(ui.dialog.open,true);assert.match(ui.get('#dialog-error').textContent,/면허/);assert.equal(licenseRows(ui)[0].number.value.length,101);assert.deepEqual((await readWorker()).licenses,saved.licenses);
    for(const row of licenseRows(ui))row.remove.onclick();await ui.submit(basic);assert.equal(ui.dialog.open,false);assert.deepEqual((await readWorker()).licenses,[]);
    ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();assert.equal(licenseRows(ui).length,0);ui.dialog.close();
    const companyResponse=await send('/api/companies','POST',{siteId:created[1].id,name:'가상 등록 업체',trade:'가상 공종'},globalCookie),company=await companyResponse.json();assert.equal(companyResponse.status,201);
    saved=await readWorker();assert.equal((await send('/api/workers/'+worker.id,'PUT',{...basic,company:company.name,companyId:company.id,version:saved.version},globalCookie)).status,200);
    assert.equal((await send('/api/attendance','POST',{siteId:created[1].id,workerId:worker.id,date:'2026-10-30',present:true},globalCookie)).status,200);
    await ui.context.render();ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();await ui.submit({...basic,company:company.name,memo:'가상 이름 유지'});assert.equal(ui.dialog.open,false);assert.equal((await readWorker()).company_id,company.id);
    ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();await ui.submit({...basic,company:'직접 변경한 소속'});assert.equal(ui.dialog.open,false);saved=await readWorker();assert.equal(saved.company_id,null);assert.equal(saved.company,'직접 변경한 소속');
    ui.get('[data-restricted-worker="'+worker.id+'"]').onclick();await ui.get('#restricted-company-load').onclick();const selectedCompany=ui.get('#restricted-company-choice');assert.match(selectedCompany.innerHTML,/가상 등록 업체/);selectedCompany.value=String(company.id);selectedCompany.onchange();await ui.submit({...basic,company:ui.get('#dialog-form input[name=company]').value,companyId:selectedCompany.value});assert.equal(ui.dialog.open,false);assert.equal((await readWorker()).company_id,company.id);
    const oldAttendance=await(await send('/api/attendance?siteId='+created[1].id+'&date=2026-10-30','GET',null,globalCookie)).json();assert.equal(oldAttendance[0].attendance_company_id,company.id);assert.equal(oldAttendance[0].attendance_company,company.name);
    ui.state.page='attendance';await ui.context.render();ui.get('[data-restricted-presence="'+worker.id+'"]').onclick();await ui.submit({present:'1'});assert.equal(ui.dialog.open,false);
    ui.get('[data-restricted-units="'+worker.id+'"]').onclick();await ui.submit({units:'0.75'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/공수 0.75/);
    const day=await(await send('/api/attendance?siteId='+created[1].id+'&date=2026-11-02','GET',null,cookie)).json();assert.equal(day[0].present,1);assert.equal(day[0].units_hundredths,75);
    await ui.get('#restricted-month-open').onclick();assert.match(ui.get('#restricted-month-results').innerHTML,/2026-11-02/);
    ui.get('[data-restricted-month-worker="'+worker.id+'"]').onclick();await ui.submit({category:'',company:'',occupation:'월별 가상 직종'});assert.equal(ui.dialog.open,false);
    const monthly=await(await send('/api/attendance/month?siteId='+created[1].id+'&month=2026-11','GET',null,cookie)).json();assert.equal(monthly[0].units[0].occupation,'월별 가상 직종');
    await ui.context.showRestrictedQr();await ui.get('[data-restricted-qr="access"]').onclick();assert.match(ui.get('#restricted-qr-result').innerHTML,/<img/);
    await ui.get('[data-restricted-qr="openRegistration"]').onclick();assert.match(ui.get('#restricted-qr-status').textContent,/기한/);
    await ui.get('[data-restricted-qr="invite"]').onclick();assert.match(ui.get('#restricted-qr-result').innerHTML,/<img/);
    await ui.get('[data-restricted-qr="rotate"]').onclick();assert.match(ui.get('#restricted-qr-result').innerHTML,/<img/);
    await ui.get('[data-restricted-qr="revoke"]').onclick();assert.equal(ui.get('#restricted-qr-result').innerHTML,'');assert.match(ui.get('#restricted-qr-status').textContent,/중지/);ui.dialog.close();
    assert.equal((await send('/api/attendance/month?siteId='+created[2].id+'&month=2026-11','GET',null,cookie)).status,403);
    assert.equal((await send('/api/sites/'+created[2].id+'/access','POST',{},cookie)).status,403);
    ui.get('[data-restricted-presence="'+worker.id+'"]').onclick();await ui.submit({present:'0'});assert.equal(ui.dialog.open,false);assert.match(ui.content.innerHTML,/미출역/);assert.doesNotMatch(ui.content.innerHTML,/data-restricted-units/);
    ui.state.page='workers';ui.get('#site-select').value=String(created[0].id);ui.get('#site-select').onchange();await ui.context.renderPending;assert.doesNotMatch(ui.content.innerHTML,/가상 UI 수정/);assert.match(ui.content.innerHTML,/등록된 근로자가 없습니다/);
    for(const path of ['/api/workers?siteId=','/api/attendance?siteId='])assert.equal((await send(path+created[2].id,'GET',null,cookie)).status,403);
    const noticeUi=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie,'x-admin-context':session.context}}));noticeUi.context.applyAdminScope(session.admin);noticeUi.state.siteId=created[1].id;noticeUi.state.page='documents';noticeUi.state.detail=documents[0].id;await noticeUi.context.renderRestrictedDocuments();noticeUi.get('#restricted-notice-edit').onclick();
    ui.get('#restricted-worker-add').onclick();addLicense(ui);licenseRows(ui)[0].name.value='가상 회수 보존';const updated=await send('/api/admin-accounts/'+limited.id,'PUT',{version:limited.version,scope:'restricted',siteIds:[]},globalCookie);assert.equal(updated.status,200);await ui.submit({name:'회수 후 가상',category:'직영',company:'',occupation:'가상'});assert.equal(ui.dialog.open,true);assert.match(ui.get('#dialog-error').textContent,/로그인/);assert.equal(ui.get('#dialog-form').values.name,'회수 후 가상');assert.equal(licenseRows(ui)[0].name.value,'가상 회수 보존');assert.equal((await(await send('/api/workers?siteId='+created[0].id,'GET',null,globalCookie)).json()).length,0);ui.dialog.close();await assert.rejects(ui.context.render(),/로그인/);assert.deepEqual(ui.redirects,['/login']);
    await noticeUi.submit({title:'회수 후 공지',date:'2026-11-03',body:'보존할 공지 입력'});assert.equal(noticeUi.dialog.open,true);assert.equal(noticeUi.get('#dialog-form').values.body,'보존할 공지 입력');assert.match(noticeUi.get('#dialog-error').textContent,/로그인/);assert.equal((await(await send(noticePath,'GET',null,globalCookie)).json()).title,'가상 공지 수정 완료');
    const nextCookie=await login('scope_ui'),nextSession=await(await send('/api/session','GET',null,nextCookie)).json(),empty=screen((path,options)=>fetch(base+path,{...options,headers:{...options.headers,cookie:nextCookie,'x-admin-context':nextSession.context}}));empty.context.applyAdminScope(nextSession.admin);await empty.context.render();assert.match(empty.content.innerHTML,/배정 현장이 없습니다/);assert.deepEqual(empty.requests.map(r=>r.path),['/api/sites']);
  }finally{
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    const target=resolve(dir),root=resolve(tmpdir());assert.ok(target.startsWith(root+'\\')||target.startsWith(root+'/'));rmSync(target,{recursive:true,force:true});
  }
});

const equipmentItem={id:8,kind:'가상 굴착기',model:'시험 형식',registration:'가상-008',capacity:'민감용량',details:JSON.stringify({owner:'민감소유주',insurer:'민감보험'})};
const equipmentRow={id:4,site_id:1,equipment_id:8,date:'2026-11-02',driver_name:'가상 운전원',driver_birth:'민감생일',driver_phone:'민감전화',note:'<가상 비고>',version:'v1',equipment_snapshot:equipmentItem};
function equipmentScreen(fetcher){const ui=screen(fetcher|| (async path=>response(path.startsWith('/api/equipment?')?[equipmentItem]:[equipmentRow])));ui.state.admin={scope:'restricted',id:2};ui.state.page='equipment-attendance';ui.context.window={print:()=>ui.printed=true};return ui;}
test('장비 출역 공통 화면: 제한 민감정보 제외·전역 회귀·월·빈 장비·인쇄',async()=>{
  for(const scope of ['restricted','global']){const ui=equipmentScreen();ui.state.admin.scope=scope;await ui.context.renderEquipmentAttendance();assert.match(ui.content.innerHTML,/가상 굴착기/);assert.match(ui.content.innerHTML,/&lt;가상 비고&gt;/);if(scope==='restricted')assert.doesNotMatch(ui.content.innerHTML,/민감|생년월일|연락처|소유주/);else assert.match(ui.content.innerHTML,/민감소유주/);ui.get('#equipment-attendance-print').onclick();assert.equal(ui.printed,true);ui.get('[data-equipment-attendance-edit="4"]').onclick();assert.equal(ui.get('#dialog-body').innerHTML.includes('driverBirth'),scope==='global');assert.doesNotMatch(ui.get('#dialog-body').innerHTML,/name="equipmentId"/);let renders=0;ui.context.render=async()=>renders++;await ui.get('#equipment-attendance-month').onchange({target:{value:'2026-12'}});assert.equal(ui.state.equipmentAttendanceMonth,'2026-12');assert.equal(renders,1);}
  const ui=equipmentScreen(async()=>response([]));await ui.context.renderEquipmentAttendance();assert.match(ui.content.innerHTML,/기록이 없습니다/);ui.get('#equipment-attendance-add').onclick();assert.equal(ui.dialog.open,false);assert.match(ui.flashes[0],/전역 관리자/);
});
test('장비 출역 등록·수정·삭제는 현장과 버전 전달, 오류·충돌 입력 보존 및 중복 삭제 차단',async()=>{
  for(const status of [400,401,403,409,500])for(const edit of [false,true]){const ui=equipmentScreen(async(path,options)=>options.method?{ok:false,status,json:async()=>({error:'가상 거절'})}:response(path.startsWith('/api/equipment?')?[equipmentItem]:[equipmentRow]));await ui.context.renderEquipmentAttendance();ui.get(edit?'[data-equipment-attendance-edit="4"]':'#equipment-attendance-add').onclick();const values={date:'2026-11-03',driverName:'가상 입력',note:'보존할 메모',...(!edit?{equipmentId:'8'}:{})};await ui.submit(values);assert.equal(ui.dialog.open,true);assert.equal(ui.get('#dialog-form').values.note,'보존할 메모');assert.match(ui.get('#dialog-error').textContent,/거절|로그인/);assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body),{...values,siteId:1,...(edit?{expectedVersion:'v1'}:{})});}
  const wait=delayed(),ui=equipmentScreen(async(path,options)=>options.method?wait.promise:response(path.startsWith('/api/equipment?')?[equipmentItem]:[equipmentRow]));await ui.context.renderEquipmentAttendance();const button=ui.get('[data-equipment-attendance-delete="4"]');const pending=button.onclick();await button.onclick();assert.equal(ui.requests.filter(r=>r.options.method).length,1);assert.deepEqual(JSON.parse(ui.requests.at(-1).options.body),{siteId:1,expectedVersion:'v1'});wait.resolve({ok:false,status:409,json:async()=>({error:'가상 충돌'})});await pending;assert.match(ui.errors[0],/충돌/);assert.equal(button.disabled,false);assert.match(ui.content.innerHTML,/가상 굴착기/);
});
test('장비 출역 조회·저장·삭제 늦은 성공·401·충돌은 현장·계정·월·페이지·닫힌 창 변경 뒤 무시',async()=>{
  for(const action of ['read','save','delete'])for(const transition of ['site','account','month','page',...(action==='save'?['close','dialog']:[])])for(const status of [200,401,409]){
    const wait=delayed();let defer=action==='read';const ui=equipmentScreen(async(path,options)=>defer?wait.promise:response(path.startsWith('/api/equipment?')?[equipmentItem]:[equipmentRow]));let pending;
    if(action==='read')pending=ui.context.renderEquipmentAttendance();else{await ui.context.renderEquipmentAttendance();defer=true;if(action==='save'){ui.get('[data-equipment-attendance-edit="4"]').onclick();pending=ui.submit({date:'2026-11-02',driverName:'보존'});}else pending=ui.get('[data-equipment-attendance-delete="4"]').onclick();}
    if(transition==='site')ui.state.siteId=2;if(transition==='account')ui.state.admin=null;if(transition==='month')ui.state.equipmentAttendanceMonth='2026-12';if(transition==='page')ui.state.page='documents';if(transition==='close')ui.dialog.close();if(transition==='dialog')ui.context.showDialog('다른 창','새 입력',async()=>{});
    const markup=ui.content.innerHTML,body=ui.get('#dialog-body').innerHTML,open=ui.dialog.open;wait.resolve({ok:status===200,status,json:async()=>status===200?[]:{error:'늦은 오류'}});await pending;assert.equal(ui.content.innerHTML,markup);assert.equal(ui.get('#dialog-body').innerHTML,body);assert.equal(ui.dialog.open,open);assert.deepEqual(ui.errors,[]);assert.deepEqual(ui.flashes,[]);assert.deepEqual(ui.redirects,[]);
  }
});

test('실제 로그아웃 핸들러가 장비 입력창·화면을 비우고 대기 조회를 무효화한다',async()=>{
  const wait=delayed(),ui=equipmentScreen(async(path)=>path==='/api/logout'?response({ok:true}):wait.promise);ui.dialog.showModal();ui.content.innerHTML='이전 장비';const pending=ui.context.renderEquipmentAttendance();
  const start=source.indexOf('logout.onclick=async()=>'),end=source.indexOf(';document.querySelector',start);assert.ok(start>=0&&end>start);ui.context.logout={};ui.context.joinRecordEpoch=0;runInNewContext(source.slice(start,end),ui.context);await ui.context.logout.onclick();assert.equal(ui.state.admin,null);assert.equal(ui.dialog.open,false);assert.equal(ui.content.innerHTML,'');assert.deepEqual(ui.redirects,['/login']);wait.resolve(response([]));await pending;assert.equal(ui.content.innerHTML,'');
});
