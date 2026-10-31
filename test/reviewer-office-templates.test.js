import test from 'node:test';
import assert from 'node:assert/strict';
import { mountReviewerOffice } from '../public/reviewer-office.js';
import { leaveExamples,officeTemplate } from '../public/office-template.js';
import { richTextFromEditor } from '../public/rich-text.js';

const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
function control(value=''){
  const listeners={};return {value,hidden:false,disabled:false,isConnected:true,textContent:'',addEventListener(type,fn){(listeners[type]??=[]).push(fn);},emit(type){for(const fn of listeners[type]||[])fn();}};
}
// shortcut: 생성된 기본 서식 태그만 모의 처리하며, 브라우저 배치 검증에는 실제 DOM을 사용한다.
function richNode(tag='div'){
  return {nodeType:1,tagName:tag.toUpperCase(),childNodes:[],ownerDocument:{createElement:richNode},
    get firstChild(){return this.childNodes[0];},append(node){this.childNodes.push(node);},focus(){this.focused=true;},
    set textContent(value){this.childNodes=value?[{nodeType:3,nodeValue:value}]:[];},
    set innerHTML(value){
      this.childNodes=[];const stack=[this];for(const token of value.match(/<[^>]+>|[^<]+/g)||[]){
        if(token.startsWith('</'))stack.pop();
        else if(token.startsWith('<')){const node=richNode(token.match(/^<(\w+)/)[1]);stack.at(-1).append(node);if(node.tagName!=='BR')stack.push(node);}
        else stack.at(-1).append({nodeType:3,nodeValue:decode(token)});
      }
    },
    querySelectorAll(selector){const nodes=this.childNodes.filter(node=>node.nodeType===1),all=nodes.flatMap(node=>[node,...node.querySelectorAll('*')]);return selector==='*'?all:all.filter(node=>selector==='td:empty,th:empty'?['TD','TH'].includes(node.tagName)&&!node.childNodes.length:node.tagName===selector.toUpperCase());},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  };
}
async function screen({state=null,title='',kind='품의서',body='',rich=null,saveWait=null,sources=[]}={}){
  const writes=[],reads=[],bodyNode=richNode(),toolbar=control(),submit=control(),form=control(),setup=control(),editor=control(),list=control(),status=control(),newButton=control(),close=control();
  form.elements=Object.fromEntries(Object.entries({title,date:'2026-10-31',kind,otherKind:'가상 기타',referenceDocId:'9'}).map(([key,value])=>[key,control(value)]));
  const fields={'[data-rich-editor]':bodyNode,'[data-rich-toolbar]':toolbar,'[type=submit]':submit};
  form.querySelector=key=>fields[key]||null;
  form.insertAdjacentHTML=(_position,html)=>{form.markup=html;for(const match of html.matchAll(/\b(data-[\w-]+)(?=[\s>])/g))fields[`[${match[1]}]`]=control();fields['[data-leave-example]'].value='leave';};
  const setupFields=Object.fromEntries(['data-save-line','data-save-references','data-pad','data-clear','data-sign','data-upload','data-load-source','data-load-document','data-load-status'].map(key=>[`[${key}]`,control()])),line=control('2'),reference=control('2'),transition=control();transition.dataset={transition:'submit'};reference.checked=true;
  setup.querySelector=key=>setupFields[key];setup.querySelectorAll=key=>key==='[data-line]'?[line]:key==='[data-reference]'?[reference]:key==='[data-transition]'&&state==='draft'?[transition]:[];
  editor.querySelector=key=>key==='[data-form]'?(editor.innerHTML.includes('<form data-form>')?form:null):key==='[data-close]'?close:key==='[data-setup]'?setup:null;
  editor.replaceChildren=()=>{editor.closed=true;form.isConnected=false;};const openButton=control();openButton.dataset={open:'7'};
  list.querySelectorAll=()=>state?[openButton]:[];
  const target={querySelector:key=>({'[data-list]':list,'[data-editor]':editor,'[data-status]':status,'[data-new]':newButton}[key])};
  const data={document:{id:7,title,date:'2026-10-31',body,status:state,details:JSON.stringify({kind,bodyRich:rich})},version:'가상 버전',line:[],references:[],attachments:[],events:[],hasSignature:true};
  let optionsWait=null,sourceWait=null;const api=async(path,options={})=>{if(options.method){writes.push({path,method:options.method,input:JSON.parse(options.body)});if(saveWait)await saveWait;return data;}reads.push(path);if(path.endsWith('/options')){if(optionsWait)await optionsWait;return {people:[{id:2,name:'가상 직원'}],documents:sources.map(({id,title,date})=>({id,title,date}))};}if(path.endsWith('/7'))return data;const match=path.match(/\/office-documents\/(\d+)$/);if(match){if(sourceWait)await sourceWait;const document=sources.find(item=>item.id===Number(match[1]));if(!document)throw Error('본인 문서가 없습니다.');return {document};}return state?[data.document]:[];};
  let active=true;await mountReviewerOffice({target,siteId:1,api,active:()=>active,pad:()=>()=> '가상 서명'});await (state?openButton:newButton).onclick();setupFields['[data-load-document]'].disabled=!sources.length;
  return {form,fields,bodyNode,editor,setup,setupFields,status,writes,reads,line,reference,transition,close,newButton,openButton,holdOpen(promise){optionsWait=promise;},holdSource(promise){sourceWait=promise;},stop(){active=false;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('직원 품의 예시는 기존 제목·다른 입력을 보존하고 실제 저장 요청에 본문을 담는다',async()=>{
  const ui=await screen({title:'직접 쓴 가상 제목'}),before={...Object.fromEntries(Object.entries(ui.form.elements).map(([key,node])=>[key,node.value]))};
  assert.equal(ui.fields['[data-example]'].hidden,false);assert.equal(ui.fields['[data-leave-label]'].hidden,true);
  assert.match(ui.form.markup,/<button type="button" data-apply-example>/);
  ui.fields['[data-apply-example]'].onclick();assert.equal(ui.bodyNode.focused,true);assert.match(ui.fields['[data-example-status]'].textContent,/적용했습니다/);
  assert.deepEqual(Object.fromEntries(Object.entries(ui.form.elements).map(([key,node])=>[key,node.value])),before);
  ui.form.onsubmit({preventDefault(){}});await flush();assert.equal(ui.writes.length,1);
  const saved=ui.writes[0];assert.equal(saved.path,'/api/reviewer/office-documents');assert.equal(saved.method,'POST');assert.equal(saved.input.title,before.title);assert.equal(saved.input.date,before.date);assert.equal(saved.input.details.referenceDocId,9);assert.equal(saved.input.details.otherKind,before.otherKind);assert.deepEqual(saved.input.details.bodyRich,[{type:'text',value:officeTemplate('품의서','','','').body}]);
});

test('직원 휴가 여섯 예시는 표로 적용하고 종류 전환만으로 기존 본문을 바꾸지 않는다',async()=>{
  for(const [example,label] of Object.entries(leaveExamples)){
    const ui=await screen({kind:'휴가신청서'});assert.equal(ui.fields['[data-leave-label]'].hidden,false);
    assert.ok(ui.form.markup.includes(`<option value="${example}">${label}</option>`));ui.fields['[data-leave-example]'].value=example;ui.fields['[data-apply-example]'].onclick();
    assert.equal(ui.form.elements.title.value,'가상 휴가 신청');assert.deepEqual(richTextFromEditor(ui.bodyNode),officeTemplate('휴가신청서',example,'','').rich);
    const before=richTextFromEditor(ui.bodyNode);for(const kind of ['경비청구','사고발생보고서','기타','품의서']){ui.form.elements.kind.value=kind;ui.form.elements.kind.emit('change');assert.equal(ui.fields['[data-example]'].hidden,kind!=='품의서');assert.deepEqual(richTextFromEditor(ui.bodyNode),before);}
    ui.form.onsubmit({preventDefault(){}});await flush();assert.deepEqual(ui.writes[0].input.details.bodyRich,before);
  }
});

test('입력된 본문과 빈 표는 덮어쓰지 않으며 실패한 적용은 변경으로 취급하지 않는다',async t=>{
  let prompts=0;const previous=Object.getOwnPropertyDescriptor(globalThis,'confirm');globalThis.confirm=()=>{prompts++;return false;};t.after(()=>{if(previous)Object.defineProperty(globalThis,'confirm',previous);else delete globalThis.confirm;});
  const emptyTable=[{type:'table',children:[{type:'tr',children:[{type:'td',children:[]}]}]}];
  for(const content of [{body:'직접 입력한 가상 본문'},{rich:[{type:'strong',children:[{type:'text',value:'굵은 가상 본문'}]}]},{rich:emptyTable}]){
    const ui=await screen({state:'draft',title:'보존할 제목',...content}),before=richTextFromEditor(ui.bodyNode);
    ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/내용이 이미|표가 있는/);assert.equal(ui.form.elements.title.value,'보존할 제목');assert.deepEqual(richTextFromEditor(ui.bodyNode),before);assert.equal(ui.writes.length,0);ui.close.onclick();assert.equal(ui.editor.closed,true);
  }
  assert.equal(prompts,0);
});

test('예시 적용 변경은 닫기·서명·결재 요청을 막고 문서 저장 때 기존 버전을 사용한다',async t=>{
  let prompts=0;const previous=Object.getOwnPropertyDescriptor(globalThis,'confirm');globalThis.confirm=()=>{prompts++;return false;};t.after(()=>{if(previous)Object.defineProperty(globalThis,'confirm',previous);else delete globalThis.confirm;});const ui=await screen({state:'draft'});
  ui.fields['[data-apply-example]'].onclick();ui.close.onclick();assert.equal(prompts,1);assert.notEqual(ui.editor.closed,true);
  for(const button of [ui.setupFields['[data-sign]'],ui.setupFields['[data-save-line]'],ui.setupFields['[data-save-references]'],ui.transition]){await button.onclick();assert.match(ui.status.textContent,/저장하지 않은 변경/);assert.equal(ui.writes.length,0);}
  ui.form.onsubmit({preventDefault(){}});await flush();assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].method,'PUT');assert.equal(ui.writes[0].input.version,'가상 버전');assert.equal(ui.writes[0].input.title,'가상 품의');
});

test('서명이나 결재선의 미저장 입력은 예시 적용 후에도 문서 저장을 차단한다',async()=>{
  for(const change of [ui=>ui.setupFields['[data-pad]'].emit('pointerdown'),ui=>ui.line.onchange(),ui=>ui.reference.onchange()]){
    const ui=await screen({state:'draft'});change(ui);ui.fields['[data-apply-example]'].onclick();ui.form.onsubmit({preventDefault(){}});await flush();assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/저장하지 않은 변경/);
  }
});

test('양식은 신규·임시저장·반려 문서에만 노출하고 대기·승인 문서는 읽기 전용이다',async()=>{
  for(const state of [null,'draft','rejected','pending','approved']){const ui=await screen({state});assert.equal(!!ui.editor.querySelector('[data-form]'),![ 'pending','approved'].includes(state));assert.equal(!!ui.fields['[data-apply-example]'],!['pending','approved'].includes(state));assert.equal(ui.writes.length,0);}
});

test('문서 저장 응답을 기다리는 동안 예시 적용으로 저장되지 않은 내용을 만들지 않는다',async()=>{
  let release;const saveWait=new Promise(resolve=>{release=resolve;}),ui=await screen({state:'draft',title:'저장 중인 제목',saveWait});
  ui.form.onsubmit({preventDefault(){}});assert.equal(ui.fields['[type=submit]'].disabled,true);assert.equal(ui.writes.length,1);
  try{ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/저장이 끝난 뒤/);assert.equal(ui.form.elements.title.value,'저장 중인 제목');assert.deepEqual(richTextFromEditor(ui.bodyNode),[]);assert.deepEqual(ui.writes[0].input.details.bodyRich,[]);}
  finally{release();await flush();}
  assert.equal(ui.fields['[type=submit]'].disabled,false);ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/적용했습니다/);
});

test('결재선·참조자·서명·제출 저장 응답 중 예시 적용은 입력과 요청을 바꾸지 않는다',async()=>{
  for(const key of ['[data-save-line]','[data-save-references]','[data-sign]','transition']){
    let release;const saveWait=new Promise(resolve=>{release=resolve;}),ui=await screen({state:'draft',saveWait}),button=key==='transition'?ui.transition:ui.setupFields[key],saving=button.onclick();
    assert.equal(button.disabled,true);assert.equal(ui.fields['[type=submit]'].disabled,false);assert.equal(ui.writes.length,1);
    try{ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/저장이 끝난 뒤/);assert.equal(ui.form.elements.title.value,'');assert.deepEqual(richTextFromEditor(ui.bodyNode),[]);assert.equal(ui.writes.length,1);}
    finally{release();await saving;}
    assert.equal(button.disabled,false);ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/적용했습니다/);
  }
});

test('다른 문서 조회가 늦게 끝나도 현재 폼에 적용한 예시를 덮어쓰지 않는다',async()=>{
  const ui=await screen({state:'draft',title:'현재 가상 문서'});let release;ui.holdOpen(new Promise(resolve=>{release=resolve;}));const originalMarkup=ui.editor.innerHTML,opening=ui.newButton.onclick();
  ui.fields['[data-apply-example]'].onclick();const applied=richTextFromEditor(ui.bodyNode),applyButton=ui.fields['[data-apply-example]'];release();await opening;
  assert.equal(ui.editor.innerHTML,originalMarkup);assert.equal(ui.fields['[data-apply-example]'],applyButton);assert.deepEqual(richTextFromEditor(ui.bodyNode),applied);assert.equal(ui.form.elements.title.value,'현재 가상 문서');assert.match(ui.fields['[data-example-status]'].textContent,/적용했습니다/);assert.equal(ui.writes.length,0);
});

test('저장 응답이 남아 있으면 편집 영역 밖의 새 작성·목록 이동과 예시 적용을 막는다',async()=>{
  let release;const saveWait=new Promise(resolve=>{release=resolve;}),ui=await screen({state:'draft',saveWait}),saving=ui.setupFields['[data-save-line]'].onclick();
  const markup=ui.editor.innerHTML,apply=ui.fields['[data-apply-example]'];await ui.newButton.onclick();await ui.openButton.onclick();assert.equal(ui.editor.innerHTML,markup);assert.equal(ui.fields['[data-apply-example]'],apply);assert.match(ui.status.textContent,/저장 중/);
  try{ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/저장이 끝난 뒤/);assert.deepEqual(richTextFromEditor(ui.bodyNode),[]);assert.equal(ui.writes.length,1);}
  finally{release();await saving;}
  ui.fields['[data-apply-example]'].onclick();assert.match(ui.fields['[data-example-status]'].textContent,/적용했습니다/);
});

test('지연된 다른 문서 조회는 직접 입력·서식·결재선·참조자·서명을 덮어쓰지 않는다',async()=>{
  const changes=[
    ui=>{ui.form.elements.title.value='직접 고친 제목';ui.form.emit('input');},
    ui=>{ui.bodyNode.textContent='직접 쓴 본문';ui.form.emit('input');},
    ui=>{ui.bodyNode.textContent='붙여넣은 본문';ui.form.emit('paste');},
    ui=>{ui.bodyNode.textContent='끌어온 본문';ui.form.emit('drop');},
    ui=>{ui.bodyNode.innerHTML='<strong>직접 고친 서식</strong>';ui.fields['[data-rich-toolbar]'].emit('click');},
    ui=>{ui.form.elements.kind.value='휴가신청서';ui.form.emit('change');},
    ui=>{ui.line.value='3';ui.line.onchange();},
    ui=>{ui.reference.checked=false;ui.reference.onchange();},
    ui=>ui.setupFields['[data-pad]'].emit('pointerdown'),
    ui=>ui.setupFields['[data-clear]'].emit('click')
  ];
  for(const change of changes){
    const ui=await screen({state:'draft',title:'현재 가상 문서'});let release;ui.holdOpen(new Promise(resolve=>{release=resolve;}));const markup=ui.editor.innerHTML,apply=ui.fields['[data-apply-example]'],opening=ui.newButton.onclick();
    change(ui);const title=ui.form.elements.title.value,body=richTextFromEditor(ui.bodyNode);release();await opening;
    assert.equal(ui.editor.innerHTML,markup);assert.equal(ui.fields['[data-apply-example]'],apply);assert.equal(ui.form.elements.title.value,title);assert.deepEqual(richTextFromEditor(ui.bodyNode),body);assert.equal(ui.writes.length,0);
  }
});

test('저장 중에는 모든 편집 영역을 잠그고 성공·실패 뒤 잠금을 해제한다',async()=>{
  for(const failure of [false,true]){
    let release,fail;const saveWait=new Promise((resolve,reject)=>{release=resolve;fail=reject;}),ui=await screen({state:'draft',title:'저장할 제목',body:'보존할 본문',saveWait}),markup=ui.editor.innerHTML;
    ui.form.onsubmit({preventDefault(){}});assert.equal(ui.editor.inert,true);assert.match(ui.status.textContent,/편집을 기다려/);assert.equal(ui.writes[0].input.title,'저장할 제목');
    assert.equal(ui.editor.querySelector('[data-form]'),ui.form);assert.equal(ui.editor.querySelector('[data-setup]'),ui.setup);
    await ui.newButton.onclick();assert.equal(ui.editor.innerHTML,markup);assert.equal(ui.editor.inert,true);
    if(failure)fail(Error('가상 저장 실패'));else{let finishReload;ui.holdOpen(new Promise(resolve=>{finishReload=resolve;}));release();await flush();assert.equal(ui.editor.inert,true);finishReload();}await flush();assert.equal(ui.editor.inert,false);assert.equal(ui.fields['[type=submit]'].disabled,false);
    if(failure){assert.match(ui.status.textContent,/가상 저장 실패/);assert.equal(ui.form.elements.title.value,'저장할 제목');assert.deepEqual(richTextFromEditor(ui.bodyNode),[{type:'text',value:'보존할 본문'}]);}
    else assert.match(ui.status.textContent,/저장했습니다/);
  }
});

test('저장 시작 전 진행된 다른 문서 조회는 저장 대기 중 편집 영역을 교체하지 않는다',async()=>{
  let finishSave,finishOpen;const saveWait=new Promise(resolve=>{finishSave=resolve;}),ui=await screen({state:'draft',saveWait});ui.holdOpen(new Promise(resolve=>{finishOpen=resolve;}));
  const opening=ui.newButton.onclick(),markup=ui.editor.innerHTML,apply=ui.fields['[data-apply-example]'],saving=ui.setupFields['[data-save-line]'].onclick();assert.equal(ui.editor.inert,true);
  finishOpen();await opening;assert.equal(ui.editor.innerHTML,markup);assert.equal(ui.fields['[data-apply-example]'],apply);assert.equal(ui.editor.inert,true);
  finishSave();await saving;assert.equal(ui.editor.inert,false);assert.match(ui.status.textContent,/저장했습니다/);
});

test('첨부 선택 취소는 요청을 보내지 않고 잠금과 저장 중 안내를 해제한다',async()=>{
  const ui=await screen({state:'draft'}),upload=ui.setupFields['[data-upload]'];upload.files=[];const cancelled=upload.onchange();
  assert.equal(ui.editor.inert,true);await ui.newButton.onclick();await cancelled;
  assert.equal(ui.editor.inert,false);assert.equal(upload.disabled,false);assert.equal(ui.status.textContent,'');assert.equal(ui.writes.length,0);
});

const sourceDoc=(id=9,siteId=1)=>({id,site_id:siteId,type:'office',date:'2026-10-20',title:'이전 <가상> 제목',body:'서식 본문',details:JSON.stringify({kind:'품의서',bodyRich:[{type:'strong',children:[{type:'text',value:'서식 본문'}]}]})});

test('직원은 자신의 이전 문서에서 제목과 서식 본문만 불러와 새 문서에 저장한다',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'confirm');let confirmations=0;globalThis.confirm=()=>{confirmations++;return true;};t.after(()=>{if(previous)Object.defineProperty(globalThis,'confirm',previous);else delete globalThis.confirm;});
  const ui=await screen({title:'기존 제목',body:'기존 본문',sources:[sourceDoc()]}),selection=ui.setupFields['[data-load-source]'],button=ui.setupFields['[data-load-document]'];
  assert.match(ui.setup.innerHTML,/이전 &lt;가상&gt; 제목/);assert.doesNotMatch(ui.setup.innerHTML,/이전 <가상> 제목/);selection.value='9';selection.emit('change');await button.onclick();
  assert.equal(confirmations,1);assert.equal(ui.form.elements.title.value,'이전 <가상> 제목');assert.deepEqual(richTextFromEditor(ui.bodyNode),[{type:'strong',children:[{type:'text',value:'서식 본문'}]}]);
  assert.equal(ui.form.elements.date.value,'2026-10-31');assert.equal(ui.form.elements.kind.value,'품의서');assert.equal(ui.form.elements.referenceDocId.value,'9');assert.equal(ui.bodyNode.focused,true);assert.match(ui.setupFields['[data-load-status]'].textContent,/저장 전 확인/);globalThis.confirm=()=>false;ui.close.onclick();assert.notEqual(ui.editor.closed,true);
  assert.equal(ui.writes.length,0);ui.form.onsubmit({preventDefault(){}});await flush();assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].input.title,'이전 <가상> 제목');assert.deepEqual(ui.writes[0].input.details.bodyRich,[{type:'strong',children:[{type:'text',value:'서식 본문'}]}]);
});

test('이전 문서 선택과 취소는 입력을 바꾸거나 문서를 저장하지 않는다',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'confirm');globalThis.confirm=()=>false;t.after(()=>{if(previous)Object.defineProperty(globalThis,'confirm',previous);else delete globalThis.confirm;});
  const ui=await screen({title:'보존할 제목',sources:[sourceDoc()]}),selection=ui.setupFields['[data-load-source]'],button=ui.setupFields['[data-load-document]'];ui.bodyNode.textContent='보존할 본문';ui.form.emit('input');
  selection.value='9';selection.emit('change');await button.onclick();assert.equal(ui.form.elements.title.value,'보존할 제목');assert.deepEqual(richTextFromEditor(ui.bodyNode),[{type:'text',value:'보존할 본문'}]);assert.ok(!ui.reads.includes('/api/reviewer/office-documents/9'));assert.equal(ui.writes.length,0);
  ui.close.onclick();assert.notEqual(ui.editor.closed,true);const empty=await screen({sources:[sourceDoc()]});empty.setupFields['[data-load-source]'].value='9';empty.setupFields['[data-load-source]'].emit('change');empty.close.onclick();assert.equal(empty.editor.closed,true);
  const invalid=await screen({sources:[sourceDoc()]});invalid.setupFields['[data-load-source]'].value='10';await invalid.setupFields['[data-load-document]'].onclick();assert.match(invalid.setupFields['[data-load-status]'].textContent,/선택해 주세요/);assert.ok(!invalid.reads.includes('/api/reviewer/office-documents/10'));
  const foreign=await screen({sources:[sourceDoc(9,2)]});foreign.setupFields['[data-load-source]'].value='9';await foreign.setupFields['[data-load-document]'].onclick();assert.match(foreign.setupFields['[data-load-status]'].textContent,/같은 현장/);assert.equal(foreign.form.elements.title.value,'');
});

test('늦은 이전 문서 조회는 그동안 바뀐 제목·본문·선택·예시를 덮어쓰지 않는다',async()=>{
  const changes=[
    ui=>{ui.form.elements.title.value='새 제목';ui.form.emit('input');},
    ui=>{ui.bodyNode.textContent='새 본문';ui.form.emit('input');},
    ui=>{ui.setupFields['[data-load-source]'].value='10';ui.setupFields['[data-load-source]'].emit('change');},
    ui=>{ui.setupFields['[data-load-source]'].value='10';ui.setupFields['[data-load-source]'].emit('change');ui.setupFields['[data-load-source]'].value='9';ui.setupFields['[data-load-source]'].emit('change');},
    ui=>ui.fields['[data-apply-example]'].onclick()
  ];
  for(const change of changes){
    const ui=await screen({sources:[sourceDoc(),sourceDoc(10)]});let release;ui.holdSource(new Promise(resolve=>{release=resolve;}));const selection=ui.setupFields['[data-load-source]'];selection.value='9';selection.emit('change');const loading=ui.setupFields['[data-load-document]'].onclick();
    change(ui);const title=ui.form.elements.title.value,body=richTextFromEditor(ui.bodyNode);release();await loading;assert.equal(ui.form.elements.title.value,title);assert.deepEqual(richTextFromEditor(ui.bodyNode),body);assert.match(ui.setupFields['[data-load-status]'].textContent,/바뀌어 불러오지/);assert.equal(ui.writes.length,0);
  }
});

test('문서를 닫거나 저장을 시작하면 진행 중인 이전 문서 조회를 적용하지 않는다',async()=>{
  for(const action of ['close','save']){
    let finishSource,finishSave;const saveWait=new Promise(resolve=>{finishSave=resolve;}),ui=await screen({sources:[sourceDoc()],saveWait});ui.holdSource(new Promise(resolve=>{finishSource=resolve;}));ui.setupFields['[data-load-source]'].value='9';const loading=ui.setupFields['[data-load-document]'].onclick();
    if(action==='close')ui.close.onclick();else{ui.form.onsubmit({preventDefault(){}});assert.equal(ui.editor.inert,true);}
    finishSource();await loading;assert.equal(ui.form.elements.title.value,'');assert.deepEqual(richTextFromEditor(ui.bodyNode),[]);if(action==='save'){assert.match(ui.setupFields['[data-load-status]'].textContent,/바뀌어 불러오지/);assert.equal(ui.writes.length,1);}else assert.equal(ui.writes.length,0);
    finishSave();await flush();
  }
});
