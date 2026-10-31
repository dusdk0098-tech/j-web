import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mountPermitRoles,permitRoleLabels,permitRoleSnapshot} from '../public/permit-roles.js';

const roles=values=>Object.fromEntries(permitRoleLabels.map(([key])=>[key,values?.[key]??null]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const account=(id=1,extra={})=>({id,site_id:7,name:`직원 ${id}`,login_id:`test${id}`,active:1,...extra});
// shortcut: DOM 선택과 이벤트만 모의 처리하므로 실제 브라우저 배치는 별도 확인이 필요하다.
function node(){return {isConnected:true,disabled:false,hidden:false,textContent:'',children:new Map(),selects:[],buttons:[],
  set innerHTML(html){this.html=html;this.selects=[...html.matchAll(/<select data-permit-role="([^"]+)">([\s\S]*?)<\/select>/g)].map(([,key,options])=>({dataset:{permitRole:key},value:options.match(/<option value="([^"]*)" [^>]*selected/)?.[1]||'',disabled:false}));this.buttons=[...html.matchAll(/<button type="button" (data-permit-role-[\w-]+)/g)].map(([,key])=>({key,disabled:false}));},
  get innerHTML(){return this.html||'';},querySelector(key){const button=this.buttons.find(button=>key===`[${button.key}]`);if(button)return button;if(key==='[data-permit-role-save]')return null;if(!this.children.has(key))this.children.set(key,node());return this.children.get(key);},
  querySelectorAll(key){return key==='select'?this.selects:key==='select,button'?[...this.selects,...this.buttons]:[];}
};}
function screen({status='draft',company='',initial=roles(),accounts=[account(1),account(2)],handle,confirm=()=>true}={}){
  const target=node(),genericButton=node(),calls=[];let active=true,saved=0;
  const api=async(path,options)=>{calls.push({path,options});if(handle){const result=handle(path,options,calls.length);if(result!==undefined)return result;}return path.startsWith('/api/reviewers?')?accounts:{version:3,roles:initial,line:[{reviewer_id:1,name:'보존 직원'}]};};
  const ready=mountPermitRoles({target,doc:{id:4,site_id:7,status,details:JSON.stringify({company})},api,active:()=>active,confirm,onSaved:()=>{saved++;},genericButton});
  const fields=()=>target.querySelector('[data-permit-role-fields]');
  return {target,genericButton,calls,ready,fields,status:()=>target.querySelector('[data-permit-role-status]').textContent,saved:()=>saved,save:()=>fields().querySelector('[data-permit-role-save]').onclick(),reload:()=>target.querySelector('[data-permit-role-reload]').onclick(),set(key,value){const select=fields().selects.find(select=>select.dataset.permitRole===key);select.value=String(value??'');select.onchange();},stop(){active=false;},detach(){target.isConnected=false;}};
}

test('여섯 역할을 표시 순서로 보여 주고 동일 현장 활성 직원만 이스케이프해 선택한다',async()=>{
  const ui=screen({accounts:[account(1,{name:'<img src=x>',login_id:'"<script>'}),account(2,{active:0}),account(3,{site_id:8})]});await ui.ready;
  assert.deepEqual(ui.fields().selects.map(select=>select.dataset.permitRole),['contractorLead','coordinator','supervisor','safetyOfficer','siteManager','inspector']);
  assert.match(ui.fields().innerHTML,/&lt;img src=x&gt;/);assert.match(ui.fields().innerHTML,/&quot;&lt;script&gt;/);assert.doesNotMatch(ui.fields().innerHTML,/<img|<script|value="2"|value="3"/);
  assert.match(ui.target.innerHTML,/J웹의 독립 시험 규칙/);assert.match(ui.target.innerHTML,/기존 일반 시험 결재선을 대체/);
});

test('같은 직원의 여러 역할은 유지하고 버전과 여섯 역할만 저장한다',async()=>{
  const ui=screen();await ui.ready;ui.set('supervisor',1);ui.set('siteManager',1);assert.equal(ui.genericButton.disabled,true);await ui.save();
  const call=ui.calls.find(call=>call.options?.method==='PUT');assert.equal(call.path,'/api/documents/4/permit-roles');assert.deepEqual(JSON.parse(call.options.body),{expectedVersion:3,roles:roles({supervisor:1,siteManager:1})});assert.equal(ui.saved(),1);
});

test('일반 결재선 교체 확인 취소는 요청과 현재 선택을 변경하지 않는다',async()=>{
  let prompt='';const ui=screen({confirm:message=>{prompt=message;return false;}});await ui.ready;ui.set('siteManager',2);await ui.save();
  assert.match(prompt,/기존 일반 시험 결재선을 대체/);assert.equal(ui.calls.filter(call=>call.options).length,0);assert.equal(ui.fields().selects[4].value,'2');
});

test('역할 지정 시 현장소장과 업체의 협력사 현장소장이 필요하며 전부 비우기는 허용한다',async()=>{
  const ui=screen({company:'가상 업체'});await ui.ready;ui.set('coordinator',1);await ui.save();assert.match(ui.status(),/^현장소장/);
  ui.set('siteManager',2);await ui.save();assert.match(ui.status(),/^협력사 현장소장/);assert.equal(ui.calls.filter(call=>call.options).length,0);
  ui.set('coordinator',null);ui.set('siteManager',null);await ui.save();assert.deepEqual(JSON.parse(ui.calls.at(-1).options.body).roles,roles());
});

test('기존 사용할 수 없는 담당자는 경고하고 다시 선택하기 전에는 저장하지 않는다',async()=>{
  const ui=screen({initial:roles({coordinator:9,siteManager:1})});await ui.ready;assert.match(ui.fields().innerHTML,/재선택 필요/);await ui.save();assert.match(ui.status(),/사용할 수 없는 직원/);assert.equal(ui.calls.filter(call=>call.options).length,0);assert.equal(ui.genericButton.hidden,true);
});

test('반려는 편집 가능하고 대기·승인은 역할 이름만 읽기 전용으로 표시한다',async()=>{
  const rejected=screen({status:'rejected'});await rejected.ready;assert.equal(rejected.fields().selects.length,6);
  for(const status of ['pending','approved']){const ui=screen({status,initial:roles({siteManager:1})});await ui.ready;assert.equal(ui.fields().selects.length,0);assert.equal(ui.fields().querySelector('[data-permit-role-save]'),null);assert.match(ui.fields().innerHTML,/보존 직원/);assert.equal(ui.calls.length,1);}
});

test('저장 중 선택과 다시 조회를 잠그고 중복 저장을 보내지 않는다',async()=>{
  const wait=deferred(),ui=screen({handle:(_path,options)=>options?wait.promise:undefined});await ui.ready;ui.set('siteManager',1);const saving=ui.save();assert.ok(ui.fields().querySelectorAll('select,button').every(control=>control.disabled));assert.equal(ui.target.querySelector('[data-permit-role-reload]').disabled,true);await ui.save();await ui.reload();assert.equal(ui.calls.filter(call=>call.options).length,1);wait.resolve({});await saving;assert.equal(ui.saved(),1);
});

test('버전 충돌은 변경 값을 보존하고 명시적으로 다시 조회할 때만 교체한다',async()=>{
  let discard=false;const ui=screen({confirm:message=>message.includes('버리고')?discard:true,handle:(_path,options)=>options?Promise.reject(Error('버전 충돌')):undefined});await ui.ready;ui.set('siteManager',2);await ui.save();assert.match(ui.status(),/버전 충돌.*선택한 내용은 유지/);assert.equal(ui.fields().selects[4].value,'2');assert.equal(ui.fields().querySelector('[data-permit-role-save]').disabled,true);
  await ui.save();await ui.reload();assert.equal(ui.calls.length,3);discard=true;await ui.reload();assert.equal(ui.fields().selects[4].value,'');assert.equal(ui.fields().querySelector('[data-permit-role-save]').disabled,false);
});

test('연속 조회의 늦은 응답과 오류는 최신 역할 선택을 덮지 않는다',async()=>{
  const waits=[],ui=screen({handle:path=>{if(path.includes('permit-roles')){const wait=deferred();waits.push(wait);return wait.promise;}}});const latest=ui.reload();waits[1].resolve({version:8,roles:roles({siteManager:2}),line:[]});await latest;waits[0].resolve({version:3,roles:roles({siteManager:1}),line:[]});await ui.ready;assert.equal(ui.fields().selects[4].value,'2');
  const old=ui.reload(),fresh=ui.reload();waits[3].resolve({version:9,roles:roles({siteManager:1}),line:[]});await fresh;waits[2].reject(Error('늦은 오류'));await old;assert.equal(ui.status(),'');assert.equal(ui.fields().selects[4].value,'1');
});

test('다른 현장·문서로 이동하거나 패널을 분리하면 늦은 조회·저장을 반영하지 않는다',async()=>{
  for(const stop of ['stop','detach']){
    const wait=deferred(),ui=screen({handle:path=>path.includes('permit-roles')?wait.promise:undefined});ui[stop]();const before=ui.fields().innerHTML;wait.resolve({version:1,roles:roles({siteManager:1}),line:[]});await ui.ready;assert.equal(ui.fields().innerHTML,before);
    const saving=deferred(),other=screen({handle:(_path,options)=>options?saving.promise:undefined});await other.ready;other.set('siteManager',1);const pending=other.save();other[stop]();saving.resolve({});await pending;assert.equal(other.saved(),0);
  }
});

test('보존된 사본은 담당자 이름을 이스케이프하고 관리자와 직원 렌더링에서 같은 역할을 보여 준다',()=>{
  const linked={type:'permit',checks:[],extensions:[],permitRoles:[{key:'siteManager',reviewer_id:1,reviewer_name:'<가상 소장>',label:'임의 라벨'}]},markup=permitRoleSnapshot(linked);
  assert.match(markup,/현장소장<\/dt><dd>&lt;가상 소장&gt;/);assert.doesNotMatch(markup,/<가상|임의 라벨/);assert.equal(permitRoleSnapshot({type:'permit'}),'');
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),part=source.slice(source.indexOf('function planLinks('),source.indexOf('async function openEquipmentCheck('));
  const context={permitRoleSnapshot,esc:value=>String(value)};runInNewContext(part+'\nglobalThis.render=planLinks;',context);assert.match(context.render(4,linked,true),/요청 당시 역할별 시험 결재자/);assert.doesNotMatch(context.render(4,linked,false),/요청 당시 역할별 시험 결재자/);
  const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),fields=admin.slice(admin.indexOf('function capturedFields('),admin.indexOf('function capturedFiles('));
  const adminContext={permitRoleSnapshot,esc:value=>String(value),dailyFields:{},riskFields:{},planFields:{},permitFields:{}};runInNewContext(fields+'\nglobalThis.render=capturedFields;',adminContext);assert.match(adminContext.render(linked),/요청 당시 역할별 시험 결재자/);
});

function adminScreen(handle){
  const nodes=new Map(),buttons=[],calls=[],content=node();let edits=0;
  function parse(html){for(const match of html.matchAll(/<(button|input)[^>]*?(?:id="([^"]+)"|data-action="([^"]+)")[^>]*>/g)){const element=node();element.dataset={};element.id=match[2]||'';if(match[3])element.dataset.action=match[3];element.tagName=match[1].toUpperCase();element.disabled=match[0].includes(' disabled');element.type=match[0].includes('type="file"')?'file':'button';nodes.set(match[2]?`#${match[2]}`:`[data-action="${match[3]}"]`,element);buttons.push(element);}}
  Object.defineProperty(content,'innerHTML',{get(){return this.html||'';},set(html){this.html=html;nodes.clear();buttons.length=0;parse(html);}});
  content.insertAdjacentHTML=(_position,html)=>{content.html+=html;parse(html);};
  const actionRow={insertAdjacentHTML:content.insertAdjacentHTML};
  content.querySelector=key=>key==='.action-row'?actionRow:nodes.get(key)||null;
  content.querySelectorAll=key=>key==='button,input[type=file]'?buttons:key==='[data-action]'?buttons.filter(button=>button.dataset.action):[];
  content.append=target=>{content.roleTarget=target;};
  const document={createElement:()=>node(),querySelector:content.querySelector,querySelectorAll:content.querySelectorAll};
  const api=async(path,options)=>{calls.push({path,options});const result=handle?.(path,options);if(result!==undefined)return result;const documentId=path.match(/^\/api\/documents\/(\d+)$/);if(documentId)return {id:Number(documentId[1]),site_id:7,type:'permit',status:'draft',details:'{}',title:`가상 허가 ${documentId[1]}`,date:'2026-10-31'};if(path.endsWith('/permit-roles'))return {version:'version-a',roles:roles(),line:[]};if(path.startsWith('/api/reviewers?'))return [account()];return [];};
  const context={document,content,api,state:{detail:4,siteId:7,page:'documents',types:{permit:'가상 허가'}},detailEpoch:0,permitRoleCleanup:null,permitFields:{},esc:value=>String(value??''),statusLabels:{draft:'임시저장'},mountPermitRoles,confirm:()=>true,$:document.querySelector,editDocument:()=>{edits++;},flash:()=>{},showError:error=>{throw error;},render:async()=>{},window:{print(){}}};
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),detail=source.slice(source.indexOf('async function renderDetail('),source.indexOf('async function showBatchPreview('));runInNewContext(detail+'\nglobalThis.draw=renderDetail;',context);
  return {context,content,nodes,calls,edits:()=>edits,ready:context.draw()};
}

test('실제 관리자 상세의 역할 미저장·저장 중에는 수정 및 결재 요청이 실행되지 않는다',async()=>{
  const wait=deferred(),ui=adminScreen((path,options)=>options&&path.endsWith('/permit-roles')?wait.promise:undefined);await ui.ready;
  const fields=ui.content.roleTarget.querySelector('[data-permit-role-fields]'),select=fields.selects[4],edit=ui.nodes.get('#edit'),submit=ui.nodes.get('[data-action="submit"]');
  select.value='1';select.onchange();assert.equal(edit.disabled,true);assert.equal(submit.disabled,true);await edit.onclick();await submit.onclick();assert.equal(ui.edits(),0);assert.equal(ui.calls.filter(call=>call.path.endsWith('/transition')).length,0);
  const saving=fields.querySelector('[data-permit-role-save]').onclick();assert.equal(edit.disabled,true);assert.equal(submit.disabled,true);wait.reject(Error('버전 충돌'));await saving;assert.equal(submit.disabled,true);
  await ui.content.roleTarget.querySelector('[data-permit-role-reload]').onclick();assert.equal(edit.disabled,false);assert.equal(submit.disabled,false);
  select.value='1';fields.selects[4].value='1';fields.selects[4].onchange();ui.context.permitRoleCleanup();assert.equal(edit.disabled,false);assert.equal(submit.disabled,false);
});

test('실제 관리자 상세의 늦은 허가서 점검·연장 응답은 이동한 화면을 변경하지 않는다',async()=>{
  const wait=deferred(),ui=adminScreen(path=>path.endsWith('/permit-checks')||path.endsWith('/permit-extensions')?wait.promise:undefined);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(ui.calls.some(call=>call.path.endsWith('/permit-checks')));ui.context.state.siteId=8;ui.context.state.detail=null;ui.content.innerHTML='새 현장의 화면';wait.resolve([]);await ui.ready;assert.equal(ui.content.innerHTML,'새 현장의 화면');assert.equal(ui.content.roleTarget,undefined);
});

test('허가서 A 조회 중 B의 renderDetail을 완료한 뒤 A 응답이 와도 B 화면과 역할 패널을 보존한다',async()=>{
  const wait=deferred(),ui=adminScreen(path=>/^\/api\/documents\/4\/permit-(checks|extensions)$/.test(path)?wait.promise:undefined);await new Promise(resolve=>setImmediate(resolve));
  ui.context.state.detail=5;await ui.context.draw();const before=ui.content.innerHTML,panel=ui.content.roleTarget;assert.match(before,/가상 허가 5/);wait.resolve([]);await ui.ready;assert.equal(ui.content.innerHTML,before);assert.equal(ui.content.roleTarget,panel);
});

test('관리자 역할 조회 중에는 문서 변경 버튼이 잠기고 실패 후 재조회 완료 때 해제된다',async()=>{
  const wait=deferred();let pending=true;const ui=adminScreen(path=>pending&&path.endsWith('/permit-roles')?wait.promise:undefined);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.nodes.get('#edit').disabled,true);assert.equal(ui.nodes.get('[data-action="submit"]').disabled,true);assert.equal(ui.nodes.get('#permit-check-add').disabled,true);wait.reject(Error('조회 실패'));await ui.ready;assert.equal(ui.nodes.get('#edit').disabled,true);
  pending=false;await ui.content.roleTarget.querySelector('[data-permit-role-reload]').onclick();assert.equal(ui.nodes.get('#edit').disabled,false);assert.equal(ui.nodes.get('#permit-check-add').disabled,false);
});

test('일반 결재선 직원 조회 중 역할을 바꾸면 늦은 응답으로 편집창을 열지 않는다',async()=>{
  const wait=deferred();let pending=false;const ui=adminScreen(path=>pending&&path.startsWith('/api/reviewers?')?wait.promise:undefined);await ui.ready;pending=true;
  const opening=ui.nodes.get('#edit-approval-line').onclick(),select=ui.content.roleTarget.querySelector('[data-permit-role-fields]').selects[4];select.value='1';select.onchange();wait.resolve([account()]);await opening;assert.equal(ui.calls.filter(call=>call.options).length,0);
});
