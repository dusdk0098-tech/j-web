import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const person=(id,name='가상 직원',active=1,site_id=7)=>({id,name,active,site_id});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));

// shortcut: 폼·응답 경쟁은 모의 DOM으로 실행하며 실제 화면 배치 검증은 브라우저 시험에서 수행한다.
async function screen({type='safety_meeting',details={},existing=false,people=[person(1)],load,workers=[],attendance=[],loadAttendance,loadWorkers}={}){
  const nodes=new Map(),controls=new Map(),calls=[];
  const parse=(html,owner)=>{
    for(const [,id] of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g))nodes.set('#'+id,node(id));
    for(const [,tag,attrs,body=''] of html.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
      const name=attrs.match(/\bname="([^"]+)"/)?.[1],marker=attrs.match(/\b(data-[\w-]+)/)?.[1];
      const options=[...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,attrs,text])=>({value:decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]??text),selected:/\bselected\b/.test(attrs)}));
      const control={name,marker,disabled:/\bdisabled\b/.test(attrs),checked:/\bchecked\b/.test(attrs),value:tag==='select'?(options.find(option=>option.selected)||options[0])?.value||'':tag==='textarea'?decode(body):decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]||'')};
      if(name)controls.set(name,control);if(marker)owner.checks.push(control);
    }
  };
  const node=id=>({id,isConnected:true,dataset:{},textContent:'',html:'',checks:[],set innerHTML(html){if(id==='daily-fields')for(const [key,item] of nodes)if(['#meeting-workers','#joint-managers','#meeting-employees'].includes(key)){item.isConnected=false;nodes.delete(key);}this.html=html;this.checks=[];parse(html,this);},get innerHTML(){return this.html;},insertAdjacentHTML(position,html){this.html+=html;parse(html,this);}});
  for(const key of ['dialog-title','dialog-body','dialog-error','dialog-form','dialog-form button[type=submit]'])nodes.set('#'+key,node(key));
  const find=selector=>{const name=selector.match(/\[name=["']?([^\]"']+)/)?.[1];return name?controls.get(name):nodes.get(selector);};
  const state={siteId:7,page:'documents',type,types:{safety_meeting:'안전보건회의',work_council:'노사협의체'}};
  const dialog=Object.assign(new EventTarget(),{open:false,showModal(){this.open=true;},close(){this.open=false;this.dispatchEvent(new Event('close'));}});
  const context={state,detailEpoch:0,dialog,$:find,document:{querySelector:find,querySelectorAll:selector=>[...nodes.values()].filter(item=>item.isConnected).flatMap(item=>item.checks).filter(input=>selector.includes('['+input.marker+']')&&(!selector.endsWith(':checked')||input.checked))},FormData:class{*[Symbol.iterator](){for(const control of controls.values())if(!control.disabled)yield [control.name,control.value];}},api:async(path,options)=>{calls.push({path,options});if(options)return {id:5};if(path.startsWith('/api/reviewers?'))return load?load():people;if(path.startsWith('/api/workers?'))return loadWorkers?loadWorkers():workers;if(path.startsWith('/api/attendance?'))return loadAttendance?loadAttendance(path):attendance;return [];},today:()=> '2026-11-01',flash(){},render:async()=>{},showError:error=>{nodes.get('#dialog-error').textContent=error.message;}};
  const parts=[source.match(/^const esc = .*$/m)[0],source.slice(source.indexOf('function field('),source.indexOf('function signaturePad(')),source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close')")),source.slice(source.indexOf('async function editDocument('),source.indexOf('async function loadDocuments('))];
  runInNewContext(parts.join('\n')+'\nglobalThis.open=editDocument;',context);
  await context.open(existing?{id:5,site_id:7,type,title:'가상 기존 회의',date:'2026-11-01',details:JSON.stringify(details)}:null,details,type);await flush();
  return {calls,state,controls,nodes,dialog,box:()=>nodes.get('#meeting-employees'),error:()=>nodes.get('#dialog-error').textContent,save:()=>nodes.get('#dialog-form').onsubmit({preventDefault(){},currentTarget:nodes.get('#dialog-form')}),writes:()=>calls.filter(call=>call.options),payload:()=>JSON.parse(calls.findLast(call=>call.options).options.body)};
}

test('두 회의 유형은 같은 현장 활성 직원만 선택해 숫자 employeeIds를 저장한다',async()=>{
  for(const type of ['safety_meeting','work_council']){
    const ui=await screen({type,people:[person(1),person(2,'중지 직원',0),person(3,'다른 현장',1,8)]});
    assert.ok(ui.calls.some(call=>call.path==='/api/reviewers?siteId=7'));assert.equal(ui.box().checks.length,1);ui.box().checks[0].checked=true;await ui.save();
    assert.equal(ui.writes()[0].path,'/api/documents');assert.equal(ui.writes()[0].options.method,'POST');assert.deepEqual(ui.payload().details.employeeIds,[1]);assert.equal(ui.payload().siteId,7);
  }
});

test('노사협의체 시간은 역순 선택 시 정렬해 저장한다',async()=>{
  for(const [start,end,changed] of [['14:30','09:00','meetingTo'],['24:00','23:55','meetingFrom']]){
    const ui=await screen({type:'work_council'}),from=ui.controls.get('meetingFrom'),to=ui.controls.get('meetingTo');from.value=start;to.value=end;ui.controls.get(changed).onchange();assert.equal(from.value,end);assert.equal(to.value,start);await ui.save();assert.equal(ui.payload().details.timeFrom,end);assert.equal(ui.payload().details.timeTo,start);
  }
});

test('수정 시 당시 이름과 비활성·누락 직원의 이전 선택을 보존하고 해제도 저장한다',async()=>{
  const options={existing:true,details:{employeeSnapshot:[{id:1,name:'당시 이름'},{id:2,name:'중지 당시 이름'},{id:9,name:'누락 당시 이름'}]},people:[person(1,'바뀐 이름'),person(2,'중지 이름',0)]},ui=await screen(options);
  assert.match(ui.box().innerHTML,/당시 이름/);assert.doesNotMatch(ui.box().innerHTML,/바뀐 이름/);assert.equal((ui.box().innerHTML.match(/이전 선택/g)||[]).length,2);assert.ok(ui.box().checks.every(input=>input.checked));
  await ui.save();assert.equal(ui.writes()[0].options.method,'PUT');assert.deepEqual(ui.payload().details.employeeIds,[1,2,9]);assert.equal(ui.dialog.open,false);const reopened=await screen(options);reopened.box().checks[1].checked=false;await reopened.save();assert.deepEqual(reopened.payload().details.employeeIds,[1,9]);
});

test('직원이 없거나 과거 직원 정보가 없는 문서도 빈 선택을 명시적으로 저장한다',async()=>{
  const ui=await screen({existing:true,people:[]});assert.match(ui.box().innerHTML,/등록된 활성 직원이 없습니다/);await ui.save();assert.deepEqual(ui.payload().details.employeeIds,[]);
});

test('직원 조회 실패와 잘못된 응답은 문서를 저장해 기존 선택을 지우지 않는다',async()=>{
  for(const load of [()=>Promise.reject(Error('가상 조회 실패')),()=>null]){
    const ui=await screen({existing:true,details:{employeeSnapshot:[{id:9,name:'이전 직원'}]},load});assert.equal(ui.box().dataset.loaded,undefined);assert.ok(ui.box().textContent);await ui.save();assert.match(ui.error(),/직원 목록/);assert.equal(ui.writes().length,0);
  }
});

test('늦은 직원 응답 전에는 저장하지 않으며 응답 후에는 저장한다',async()=>{
  let resolve;const ui=await screen({load:()=>new Promise(done=>{resolve=done;})});await ui.save();assert.equal(ui.writes().length,0);resolve([person(1)]);await flush();ui.box().checks[0].checked=true;await ui.save();assert.deepEqual(ui.payload().details.employeeIds,[1]);
});

test('현장·페이지 전환 또는 닫힌 창에는 늦은 직원 응답을 반영하지 않는다',async()=>{
  for(const change of [ui=>{ui.state.siteId=8;},ui=>{ui.state.page='workers';},ui=>{ui.dialog.open=false;}]){
    let resolve;const ui=await screen({load:()=>new Promise(done=>{resolve=done;})}),box=ui.box();change(ui);resolve([person(1)]);await flush();assert.equal(box.dataset.loaded,undefined);assert.equal(box.checks.length,0);await ui.save();assert.equal(ui.writes().length,0);
  }
});

test('다른 회의 유형으로 바뀐 뒤 이전 응답은 새 직원 선택을 덮지 않는다',async()=>{
  const pending=[];const ui=await screen({load:()=>new Promise(done=>pending.push(done))}),old=ui.box();ui.controls.get('type').value='work_council';ui.controls.get('type').onchange();await flush();pending[1]([person(2,'새 목록')]);await flush();pending[0]([person(1,'이전 목록')]);await flush();assert.equal(old.isConnected,false);assert.match(ui.box().innerHTML,/새 목록/);assert.doesNotMatch(ui.box().innerHTML,/이전 목록/);
});

test('목록을 받은 뒤 현장이 바뀌어도 이전 현장 직원으로 저장하지 않는다',async()=>{
  const ui=await screen();ui.box().checks[0].checked=true;ui.state.siteId=8;await ui.save();assert.match(ui.error(),/현장이 변경/);assert.equal(ui.writes().length,0);
});

test('상세 화면은 스냅샷 이름을 이스케이프해 표시하고 실제 참석·서명을 주장하지 않는다',()=>{
  const line=source.split('\n').find(line=>line.includes('<h3>선택한 직원</h3>'));assert.ok(line);
  for(const type of ['safety_meeting','work_council']){
    let html='';const context={doc:{type},details:{employeeSnapshot:[{id:9,name:'<가상 이전 직원>'}]},content:{querySelector:()=>({insertAdjacentHTML:(_,value)=>{html=value;}})}};
    runInNewContext(source.match(/^const esc = .*$/m)[0]+'\n'+line,context);assert.match(html,/&lt;가상 이전 직원&gt;/);assert.match(html,/실제 참석·본인 인증·서명을 증명하지 않습니다/);assert.doesNotMatch(html,/<img|<가상 이전 직원>/);
  }
});

const worker=(id,category='일반근로자')=>({id,name:'가상 근로자',company:'가상 소속',occupation:'<가상 직종>',present:1,category});
const click=(ui,group,action='select')=>ui.nodes.get(`#council-${group}-${action}`).onclick();

test('노사협의체 전체 및 각 목록 선택·해제는 ID 공간을 분리하고 이전 선택과 직종을 표시한다',async()=>{
  const ui=await screen({type:'work_council',existing:true,people:[person(1)],workers:[worker(2,'현장관리자')],attendance:[worker(1),worker(2,'현장관리자')],details:{employeeSnapshot:[{id:9,name:'이전 직원'}],workerSnapshot:[{...worker(8),occupation:'이전 직종'}],managerSnapshot:[worker(7,'현장관리자')]}});
  const workerBox=ui.nodes.get('#meeting-workers');assert.match(workerBox.innerHTML,/&lt;가상 직종&gt;/);assert.match(workerBox.innerHTML,/이전 직종/);assert.equal(workerBox.checks.length,2);
  click(ui,'all');for(const id of ['meeting-employees','meeting-workers','joint-managers'])assert.ok(ui.nodes.get('#'+id).checks.every(input=>input.checked));
  click(ui,'employee','clear');assert.ok(ui.box().checks.every(input=>!input.checked));assert.ok(workerBox.checks.every(input=>input.checked));click(ui,'employee');
  click(ui,'worker','clear');assert.ok(workerBox.checks.every(input=>!input.checked));click(ui,'worker');
  click(ui,'manager','clear');assert.ok(ui.nodes.get('#joint-managers').checks.every(input=>!input.checked));click(ui,'manager');
  await ui.save();assert.deepEqual(ui.payload().details.employeeIds,[1,9]);assert.deepEqual(ui.payload().details.workerIds,[1,8]);assert.deepEqual(ui.payload().details.managerIds,[2,7]);
  const empty=await screen({type:'work_council'});click(empty,'all');click(empty,'all','clear');await empty.save();assert.deepEqual(empty.payload().details.employeeIds,[]);
});

test('전체 해제는 모든 목록을 해제하고 100명 초과는 원자적으로 거절해 입력을 유지한다',async()=>{
  for(const group of ['employee','worker','manager']){
    const many=Array.from({length:101},(_,i)=>i+1),ui=await screen({type:'work_council',people:group==='employee'?many.map(id=>person(id)):[person(1)],attendance:group==='worker'?many.map(id=>worker(id)):[],workers:group==='manager'?many.map(id=>worker(id,'현장관리자')):[]});
    ui.controls.get('councilDiscussion').value='유지할 가상 입력';ui.box().checks[0].checked=true;click(ui,'all');assert.match(ui.error(),/100명/);assert.equal(ui.box().checks[0].checked,true);assert.equal(ui.box().checks.filter(x=>x.checked).length,1);click(ui,group);assert.match(ui.error(),/100명/);
    const box=ui.nodes.get(group==='employee'?'#meeting-employees':group==='worker'?'#meeting-workers':'#joint-managers');box.checks.forEach(x=>x.checked=true);await ui.save();assert.equal(ui.writes().length,0);assert.match(ui.error(),/100명/);assert.equal(box.checks.filter(x=>x.checked).length,101);assert.equal(ui.controls.get('councilDiscussion').value,'유지할 가상 입력');assert.equal(ui.dialog.open,true);
    box.checks.at(-1).checked=false;await ui.save();assert.equal(ui.writes().length,1);
  }
  const ui=await screen({type:'work_council',workers:[worker(2,'현장관리자')],attendance:[worker(1)]});click(ui,'all');click(ui,'all','clear');await ui.save();for(const key of ['employeeIds','workerIds','managerIds'])assert.deepEqual(ui.payload().details[key],[]);
});

test('날짜 변경 응답 경합·로딩·현장 전환은 이전 목록 전체 선택 및 저장을 막는다',async()=>{
  const pending=[];const ui=await screen({type:'work_council',loadAttendance:()=>new Promise(resolve=>pending.push(resolve))});click(ui,'all');assert.match(ui.error(),/불러온 뒤/);assert.equal(ui.box().checks[0].checked,false);
  ui.controls.get('date').value='2026-11-02';const loading=ui.controls.get('date').onchange();pending[1]([worker(2)]);await loading;pending[0]([worker(1)]);await flush();assert.equal(ui.nodes.get('#meeting-workers').checks[0].value,'2');click(ui,'all');await ui.save();assert.deepEqual(ui.payload().details.workerIds,[2]);
  for(const change of [ui=>ui.state.siteId=8,ui=>ui.state.page='workers',ui=>ui.dialog.open=false]){
    let resolve;const other=await screen({type:'work_council',loadAttendance:()=>new Promise(done=>resolve=done)});change(other);resolve([worker(1)]);await flush();assert.equal(other.nodes.get('#meeting-workers').dataset.loaded,undefined);click(other,'all');assert.equal(other.box().checks[0].checked,false);await other.save();assert.equal(other.writes().length,0);
  }
});

test('노사협의체 이외 화면에는 전체 선택을 추가하지 않는다',async()=>{const ui=await screen();assert.equal(ui.nodes.has('#council-all-select'),false);});

test('현장관리자의 늦은 응답도 현장·페이지·닫기 전환 뒤 적용하지 않는다',async()=>{
  for(const change of [ui=>ui.state.siteId=8,ui=>ui.state.page='workers',ui=>ui.dialog.open=false]){
    let calls=0,resolve;const ui=await screen({type:'work_council',loadWorkers:()=>++calls===1?[]:new Promise(done=>resolve=done)});change(ui);resolve([worker(2,'현장관리자')]);await flush();assert.equal(ui.nodes.get('#joint-managers').dataset.loaded,undefined);assert.equal(ui.nodes.get('#joint-managers').checks.length,0);
  }
});

test('이전 근로자가 현장관리자로 바뀌면 전체 선택은 중복을 알리고 기존 선택을 원자적으로 보존한다',async()=>{
  const ui=await screen({type:'work_council',existing:true,workers:[worker(1,'현장관리자')],details:{workerSnapshot:[worker(1)]}}),workers=ui.nodes.get('#meeting-workers'),managers=ui.nodes.get('#joint-managers');
  assert.equal(workers.checks[0].checked,true);assert.equal(managers.checks[0].checked,false);click(ui,'all');assert.match(ui.error(),/한쪽만/);assert.equal(ui.box().checks[0].checked,false);assert.equal(workers.checks[0].checked,true);assert.equal(managers.checks[0].checked,false);
  click(ui,'manager');assert.match(ui.error(),/한쪽만/);assert.equal(managers.checks[0].checked,false);managers.checks[0].checked=true;await ui.save();assert.equal(ui.writes().length,0);assert.match(ui.error(),/한쪽 선택/);assert.equal(ui.dialog.open,true);assert.equal(workers.checks[0].checked,true);
  click(ui,'worker','clear');await ui.save();assert.deepEqual(ui.payload().details.workerIds,[]);assert.deepEqual(ui.payload().details.managerIds,[1]);
});
