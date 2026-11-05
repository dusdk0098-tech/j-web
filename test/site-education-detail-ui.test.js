import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
import {PNG} from 'pngjs';
import {filterEducationReport} from '../public/training-groups.js';
import {educationKinds} from '../public/education-kinds.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fragment=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const row=(id=1,category='직영')=>({id,category,name:'가상 사람 '+id,company:'가상 소속',birth_date:'2000-01-01',type:'education',kind:'regular',count:2});
// shortcut: 필요한 DOM 이벤트와 표 내용만 재현한다. 실제 배치·포커스 검증은 별도 승인된 브라우저 시험에서 수행한다.
function screen(request=async()=>[row(),row(2,'협력업체 근로자')],managerRequest=async()=>[]){
 const nodes=new Map(),boxes=[],calls=[];
 function node(tag='div'){
  return {tag,dataset:{},isConnected:true,open:false,children:[],inputs:[],buttons:[],html:'',text:'',value:'',
   setAttribute(){},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.open=false;this.isConnected=false;},
   append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;this.html='';this.text='';},get childElementCount(){return this.children.length;},
   set textContent(v){this.replaceChildren();this.text=String(v);},get textContent(){return this.text+this.children.map(x=>x.textContent||'').join('');},
   set innerHTML(v){this.replaceChildren();this.html=v;this.inputs=[];this.buttons=[];
    for(const [,id,attrs] of v.matchAll(/<\w+\b[^>]*\bid="([^"]+)"([^>]*)>/g)){const el=node();el.value=attrs.match(/value="([^"]*)"/)?.[1]||'';nodes.set('#'+id,el);}
    for(const [,attrs] of v.matchAll(/<input\b([^>]*)>/g)){if(!attrs.includes('checkbox'))continue;this.inputs.push({checked:attrs.includes('checked'),value:attrs.match(/value="([^"]*)"/)?.[1]||'',matches:selector=>selector==='input[type=checkbox]'});}
    for(const [,id] of v.matchAll(/data-site-education-person="(\d+)"/g))this.buttons.push({dataset:{siteEducationPerson:id}});
   },get innerHTML(){return this.html;},querySelector(sel){return nodes.get(sel);},querySelectorAll(sel){if(sel==='input:checked')return this.inputs.filter(x=>x.checked);if(sel==='[data-site-education-person]')return this.buttons;return [];}
  };
 }
 const dialog=node('dialog'),state={siteId:7,page:'statistics',statisticsMonth:'2026-10',statisticsDay:'12',workerFilters:{category:'직영'},admin:{id:1}},document={body:{append:box=>boxes.push(box)},createElement:node,createTextNode:text=>({textContent:text}),querySelector:sel=>nodes.get(sel),querySelectorAll:sel=>sel.includes('data-activity-kind')?(sel.endsWith(':checked')?nodes.get('#dialog-body').inputs.filter(x=>x.checked):nodes.get('#dialog-body').inputs):[]};
 const context={state,document,dialog,detailEpoch:4,siteEducationCleanup:null,URLSearchParams,filterEducationReport,educationKinds,$:sel=>nodes.get(sel),showError:e=>{throw e;},render:()=>{throw Error('상위 화면 변경 금지');},flash(){},location:{assign(){throw Error('늦은 인증 응답 이동 금지');}},fetch:async(path,options)=>{calls.push(path);const data=await (path.includes('/manager-assignments?')?managerRequest:request)(path,options);return data?.json?data:{ok:true,status:200,json:async()=>data};},showDialog(title,html){const body=node();body.innerHTML=html;nodes.set('#dialog-body',body);nodes.set('#dialog-form',node('form'));nodes.set('#dialog-form button[type=submit]',node('button'));dialog.showModal();}};
 runInNewContext([source.match(/^const esc = .*$/m)[0],fragment('async function api(', 'function flash('),fragment('async function showWorkerActivities(', 'async function showWorkerFiles('),fragment('function showSiteEducationDetail(', 'async function renderAllSiteStatistics(')].join('\n'),context);
 return {context,state,nodes,boxes,calls,dialog,open:(id=8)=>context.showSiteEducationDetail({id,name:'가상 현장 '+id},'2026-10'),get:sel=>nodes.get(sel),month:()=>nodes.get('#site-education-month'),results:()=>nodes.get('#site-education-results'),categories:()=>nodes.get('#site-education-categories')};
}
test('독립 상세: 현장·날짜·상위 필터 유지, 종류별 횟수, 마지막 구분 유지, 월·빈 결과·오류 및 활동 복귀',async()=>{
 const ui=screen(async path=>path.includes('/activities?')?{items:[{date:'2026-01-01',kind:'education',title:'가상 교육',detail:'시험 확인',document_id:3}],nextOffset:null}:path.includes('2026-12')?[]:[row(),row(2,'협력업체 근로자')]),before=JSON.stringify(ui.state);
 await ui.open();assert.equal(JSON.stringify(ui.state),before);assert.match(ui.calls[0],/siteId=8&from=2026-10-01&to=2026-10-31/);assert.match(ui.results().innerHTML,/정기교육/);assert.match(ui.results().innerHTML,/<td>2<\/td>/);
 ui.categories().inputs[1].checked=false;ui.categories().onchange({target:ui.categories().inputs[1]});assert.doesNotMatch(ui.results().innerHTML,/가상 사람 2/);
 ui.categories().inputs[0].checked=false;ui.categories().onchange({target:ui.categories().inputs[0]});assert.equal(ui.categories().inputs[0].checked,true);assert.match(ui.results().innerHTML,/가상 사람 1/);
 await ui.results().buttons[0].onclick();assert.match(ui.calls.at(-1),/workers\/1\/activities\?siteId=8&offset=0/);assert.deepEqual(new URLSearchParams(ui.calls.at(-1).split('?')[1]).getAll('kind'),['education']);assert.doesNotMatch(ui.calls.at(-1),/from=|to=/);assert.match(ui.get('#activity-results').textContent,/2026-01-01.*가상 교육.*시험 확인/);assert.equal(ui.get('#activity-results').children[0].children.some(x=>x.tag==='button'),false);
 ui.get('#dialog-form').onsubmit({preventDefault(){}});assert.equal(ui.dialog.open,false);assert.equal(ui.boxes[0].open,true);assert.equal(ui.categories().inputs[1].checked,false);
 ui.month().value='2026-11';await ui.month().onchange();assert.match(ui.calls.at(-1),/to=2026-11-30/);assert.equal(ui.categories().inputs[1].checked,false);assert.equal(JSON.stringify(ui.state),before);
 ui.month().value='2026-12';await ui.month().onchange();assert.match(ui.results().innerHTML,/없습니다/);const count=ui.calls.length;ui.month().value='';await ui.month().onchange();assert.equal(ui.calls.length,count);assert.match(ui.results().textContent,/월을 확인/);ui.get('#site-education-close').onclick();assert.equal(ui.boxes[0].isConnected,false);
 const error=screen(async()=>{throw Error('가상 조회 실패');});await error.open();assert.match(error.results().textContent,/가상 조회 실패/);
});
test('늦은 교육 응답: 닫힘·다른 현장·계정·화면·같은 현장 재열기·월 역전의 성공과 오류 무시',async()=>{
 for(const reject of [false,true])for(const change of ['close','site','account','epoch','reopen','month']){
  const wait=deferred(),ui=screen(()=>wait.promise),pending=ui.open(),old=ui.results();
  if(change==='close')ui.boxes[0].close();if(change==='site')ui.state.siteId=9;if(change==='account')ui.state.admin={id:2};if(change==='epoch')ui.context.detailEpoch++;if(change==='reopen')void ui.open();if(change==='month')ui.month().value='2026-11';
  reject?wait.reject(Error('오래된 오류')):wait.resolve([row(99)]);await pending;await Promise.resolve();assert.doesNotMatch(old.innerHTML+old.textContent,/가상 사람 99|오래된 오류/);
 }
 const waits=[deferred(),deferred()],ui=screen(()=>waits.shift().promise),first=waits[0],second=waits[1],pending=ui.open();ui.month().value='2026-11';const latest=ui.month().onchange();second.resolve([row(2)]);await latest;first.resolve([row(99)]);await pending;assert.match(ui.results().innerHTML,/가상 사람 2/);assert.doesNotMatch(ui.results().innerHTML,/가상 사람 99/);
});
test('개인 활동의 늦은 성공·401·오류는 닫힘·다른 상세·현장·계정 뒤 적용하지 않는다',async()=>{
 for(const response of ['success','401','error'])for(const change of ['close','site','account','reopen']){
  const wait=deferred(),ui=screen(path=>path.includes('/activities?')?wait.promise:[row()]);await ui.open();const pending=ui.results().buttons[0].onclick(),old=ui.get('#activity-results');
  if(change==='close')ui.dialog.close();if(change==='site')ui.state.siteId=4;if(change==='account')ui.state.admin={id:4};if(change==='reopen')await ui.open(9);
  if(response==='error')wait.reject(Error('오래된 오류'));else wait.resolve(response==='401'?{status:401,ok:false,json:async()=>({error:'오래된 인증'})}:{items:[{kind:'education',title:'오래된 활동',detail:''}],nextOffset:null});await pending;assert.doesNotMatch(old.textContent,/오래된/);
 }
});
test('HTML 특수문자와 기존 개인 활동 호출의 기본 현장·링크 동작을 유지한다',async()=>{
 const ui=screen(async path=>path.includes('/activities?')?{items:[{date:'2026-10-01',kind:'education',title:'가상 문서',detail:'확인',document_id:3}],nextOffset:20}:[{...row(),name:'<img src=x onerror=alert(1)>'}]);await ui.open();assert.doesNotMatch(ui.results().innerHTML,/<img/);assert.match(ui.results().innerHTML,/&lt;img/);
 await ui.context.showWorkerActivities(row());assert.match(ui.calls.at(-1),/siteId=7/);assert.equal(new URLSearchParams(ui.calls.at(-1).split('?')[1]).getAll('kind').length,8);assert.equal(ui.get('#activity-results').children[0].children.some(x=>x.tag==='button'),true);assert.equal(ui.get('#activity-more').hidden,false);await ui.get('#activity-more').onclick();assert.match(ui.calls.at(-1),/offset=20/);
});
test('개인 활동 문서 버튼은 창·현장·계정이 바뀌면 동작하지 않는다',async()=>{
 for(const change of ['close','site','account','detached']){
  const ui=screen(async()=>({items:[{date:'2026-10-01',kind:'education',title:'가상 문서',detail:'확인',document_id:3}],nextOffset:null}));let rendered=0;ui.context.render=async()=>{rendered++;};await ui.context.showWorkerActivities(row());const link=ui.get('#activity-results').children[0].children.find(x=>x.tag==='button');
  if(change==='close')ui.dialog.close();if(change==='site')ui.state.siteId=8;if(change==='account')ui.state.admin={id:2};if(change==='detached')link.isConnected=false;link.onclick();assert.equal(rendered,0);assert.equal(ui.state.detail,undefined);
 }
 const ui=screen(async()=>({items:[{date:'2026-10-01',kind:'education',title:'가상 문서',detail:'확인',document_id:3}],nextOffset:null}));let rendered=0;ui.context.render=async()=>{rendered++;};await ui.context.showWorkerActivities(row());ui.get('#activity-results').children[0].children.find(x=>x.tag==='button').onclick();assert.equal(ui.state.detail,3);assert.equal(rendered,1);
});
test('교육 상세는 해당 교육만 먼저 조회하고 다른 활동을 추가 선택할 수 있다',async()=>{
 const ui=screen(async path=>path.includes('/activities?')?{items:[],nextOffset:null}:[{...row(),type:'tbm'}]);await ui.open();await ui.results().buttons[0].onclick();let kinds=new URLSearchParams(ui.calls.at(-1).split('?')[1]).getAll('kind');assert.deepEqual(kinds,['tbm']);
 const checks=ui.get('#dialog-body').inputs;checks.find(item=>item.value==='notice').checked=true;await ui.get('#activity-search').onclick();kinds=new URLSearchParams(ui.calls.at(-1).split('?')[1]).getAll('kind');assert.deepEqual(kinds,['tbm','notice']);
});
test('실제 가상 HTTP: 승인 문서 집계·같은 현장 개인 조회·빈 월·인증·제한 계정 경계',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-site-education-')),store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db),password='virtual-education-password';auth.bootstrap(password);
 const parent=store.createSite({name:'가상 상위'}),site=store.createSite({name:'가상 상세'}),worker=store.createWorker({siteId:site.id,name:'가상 참가자',category:'직영',company:'가상 소속',occupation:'가상 직종'});auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[parent.id]});
 for(const kind of ['regular','regular','special']){const doc=store.createDocument({siteId:site.id,type:'education',title:'가상 교육',date:'2026-10-20',details:{kind,timeFrom:'09:00',timeTo:'10:00',educationPlace:'가상 장소',educationMethod:'가상 방식',instructor:'가상 강사',textbook:'가상 교재'}});store.transition(doc.id,'submit');store.transition(doc.id,'approve');store.confirmWorkerTraining(worker.id,doc.id,'2026-10-20',true);}store.confirmDailyTraining(worker.id,'2026-10-20',['education'],true);
 const manager=store.createReviewer({siteId:site.id,loginId:'virtual_manager',name:'가상 직원',password}),png=new PNG({width:1,height:1});png.data[3]=255;for(let i=0;i<2;i++){const doc=store.createDocument({siteId:site.id,type:'education',title:'가상 직원 교육',date:'2026-10-20',details:{kind:'supervisor_new',timeFrom:'09:00',timeTo:'10:00',educationPlace:'가상 장소',educationMethod:'가상 방식',instructor:'가상 강사',textbook:'가상 교재'}});store.setTrainingTargets(doc.id,[],()=>{},[manager.id]);store.transition(doc.id,'submit');store.transition(doc.id,'approve');if(i===0)store.confirmReviewerEducation(manager.id,doc.id,store.document(doc.id).edit_version,'data:image/png;base64,'+PNG.sync.write(png).toString('base64'));}store.close();
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=async loginId=>{const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginId,password})});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];},cookie=await login('admin'),request=path=>fetch(base+path,{headers:{cookie}}),ui=screen(request,request);ui.state.siteId=parent.id;const before=JSON.stringify(ui.state);await ui.open(site.id);
  assert.match(ui.results().innerHTML,/<td>2<\/td>/);assert.match(ui.results().innerHTML,/<td>1<\/td>/);assert.match(ui.get('#site-education-staff').innerHTML,/가상 직원/);assert.match(ui.get('#site-education-staff').innerHTML,/<td>2<\/td><td>1<\/td>/);assert.equal(ui.results().buttons.length,2);await ui.results().buttons[0].onclick();assert.match(ui.get('#activity-results').textContent,/가상 교육/);assert.equal(JSON.stringify(ui.state),before);
  ui.get('#dialog-form').onsubmit({preventDefault(){}});ui.month().value='2026-11';await ui.month().onchange();assert.match(ui.results().innerHTML,/없습니다/);
  const report=`/api/education/report?siteId=${site.id}&from=2026-10-01&to=2026-10-31`,staff=`/api/education/manager-assignments?siteId=${site.id}&from=2026-10-01&to=2026-10-31`,activity=`/api/workers/${worker.id}/activities?siteId=${site.id}`;for(const path of [report,staff,activity])assert.equal((await fetch(base+path)).status,401);
  const limited=await login('limited');for(const path of [report,staff,activity])assert.equal((await fetch(base+path,{headers:{cookie:limited}})).status,403);assert.equal((await request(`/api/workers/${worker.id}/activities?siteId=${parent.id}`)).status,400);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('현장 상세의 직원 교육은 직원·종류별 지정과 확인을 분리하며 오래된 결과를 버린다',async()=>{
 const assignments=[{id:1,name:'<가상 직원>',kind:'regular',confirmed_at:'확인'},{id:1,name:'<가상 직원>',kind:'regular',confirmed_at:null},{id:1,name:'<가상 직원>',kind:'special',confirmed_at:'확인'},{id:2,name:'다른 직원',kind:'regular',confirmed_at:null}],ui=screen(async()=>[],async()=>assignments);await ui.open();const staff=ui.get('#site-education-staff');assert.match(staff.innerHTML,/&lt;가상 직원&gt;/);assert.doesNotMatch(staff.innerHTML,/<가상 직원>/);assert.match(staff.innerHTML,/<td>2<\/td><td>1<\/td>/);assert.match(staff.innerHTML,/<td>1<\/td><td>0<\/td>/);assert.match(staff.innerHTML,/특별안전보건교육/);
 const wait=deferred(),late=screen(async()=>[],()=>wait.promise),pending=late.open(),old=late.get('#site-education-staff');late.boxes[0].close();wait.resolve(assignments);await pending;assert.doesNotMatch(old.innerHTML,/가상 직원/);
});

test('현장 교육 통계는 직원과 출입자를 선택 표시하고 마지막 선택은 유지한다',async()=>{
 const ui=screen();await ui.open();const workers=ui.get('#site-education-show-workers'),staff=ui.get('#site-education-show-staff'),workerSection=ui.get('#site-education-worker-section'),staffSection=ui.get('#site-education-staff-section');workers.checked=staff.checked=true;
 workers.checked=false;workers.onchange({target:workers});assert.equal(workerSection.hidden,true);assert.equal(staffSection.hidden,false);
 staff.checked=false;staff.onchange({target:staff});assert.equal(staff.checked,true);assert.equal(staffSection.hidden,false);
 workers.checked=true;workers.onchange({target:workers});staff.checked=false;staff.onchange({target:staff});assert.equal(workerSection.hidden,false);assert.equal(staffSection.hidden,true);
 ui.month().value='2026-11';await ui.month().onchange();assert.equal(staffSection.hidden,true);
});

test('빈 월에서 시작해도 다음 월의 첫 자료를 기본 선택하고 마지막 선택을 유지한다',async()=>{
 const ui=screen(async path=>path.includes('2026-10')?[]:[row()]);await ui.open();assert.match(ui.results().innerHTML,/없습니다/);ui.month().value='2026-11';await ui.month().onchange();assert.match(ui.results().innerHTML,/가상 사람 1/);assert.equal(ui.categories().inputs[0].checked,true);ui.categories().inputs[0].checked=false;ui.categories().onchange({target:ui.categories().inputs[0]});assert.equal(ui.categories().inputs[0].checked,true);ui.month().value='2026-12';await ui.month().onchange();assert.match(ui.results().innerHTML,/가상 사람 1/);assert.equal(ui.categories().inputs[0].checked,true);
});
test('월 변경으로 자료가 사라진 구분은 보존하고 새 구분은 기존 전체 선택 여부를 따른다',async()=>{
 const request=async path=>path.includes('2026-10')?[row(),row(2,'협력업체 근로자')]:path.includes('2026-11')?[row(3,'새 구분')]:[];
 const ui=screen(request);await ui.open();ui.categories().inputs[1].checked=false;ui.categories().onchange({target:ui.categories().inputs[1]});ui.month().value='2026-11';await ui.month().onchange();assert.deepEqual(ui.categories().inputs.map(x=>[x.value,x.checked]),[['직영',true],['협력업체 근로자',false],['새 구분',false]]);assert.match(ui.results().innerHTML,/없습니다/);ui.month().value='2026-12';await ui.month().onchange();assert.equal(ui.categories().inputs[0].checked,true);ui.month().value='2026-10';await ui.month().onchange();assert.match(ui.results().innerHTML,/가상 사람 1/);assert.doesNotMatch(ui.results().innerHTML,/가상 사람 2/);
 const all=screen(request);await all.open();all.month().value='2026-11';await all.month().onchange();assert.equal(all.categories().inputs.find(x=>x.value==='새 구분').checked,true);assert.match(all.results().innerHTML,/가상 사람 3/);
});
test('전체 현장 행 버튼은 선택 현장과 날짜를 보존하여 상세를 열고 오래된 행은 무시한다',()=>{
 const button={dataset:{siteEducation:'8'}},state={siteId:7,page:'statistics',statisticsMonth:'2026-10',statisticsDay:'12'},section={isConnected:true,querySelectorAll:selector=>selector==='[data-site-education]'?[button]:[]},opened=[],context={section,state,siteId:7,month:'2026-10',day:'12',sites:[{id:8,name:'가상 상세'}],current:()=>state.siteId===7,today:()=>'',showSiteEducationDetail:(site,month)=>opened.push([site.id,month])};runInNewContext(fragment("  section.querySelectorAll('[data-site-education]')",'\n}'),context);const before=JSON.stringify(state);button.onclick();assert.deepEqual(opened,[[8,'2026-10']]);assert.equal(JSON.stringify(state),before);state.siteId=9;button.onclick();assert.equal(opened.length,1);
});
