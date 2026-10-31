import test from 'node:test';
import assert from 'node:assert/strict';
import { mountReviewerOffice } from '../public/reviewer-office.js';
import { leaveExamples,officeTemplate } from '../public/office-template.js';
import { richTextFromEditor } from '../public/rich-text.js';

const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
function control(value=''){
  const listeners={};return {value,hidden:false,disabled:false,isConnected:true,textContent:'',addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(event){this.lastEvent=event;this['on'+event.type]?.(event);for(const fn of listeners[event.type]||[])fn(event);return true;},emit(type){this.dispatchEvent({type,target:{closest:()=>null},preventDefault(){}});}};
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
async function screen({state=null,title='',kind='품의서',body='',rich=null,saveWait=null,sources=[],prepare=false,suggestion=async()=>null,preview=async id=>({version:'참조 버전',reference:{id,title:'가상 참조',date:'2026-10-01',body:'가상 본문',files:[]}})}={}){
  const writes=[],reads=[],bodyNode=richNode(),toolbar=control(),submit=control(),form=control(),setup=control(),editor=control(),list=control(),status=control(),newButton=control(),close=control();
  form.elements=Object.fromEntries(Object.entries({title,date:'2026-10-31',kind,otherKind:'가상 기타',referenceDocId:prepare?'0':'9'}).map(([key,value])=>[key,control(value)]));
  const fields={'[data-rich-editor]':bodyNode,'[data-rich-toolbar]':toolbar,'[type=submit]':submit};
  form.querySelector=key=>fields[key]||null;
  form.insertAdjacentHTML=(_position,html)=>{form.markup=html;for(const match of html.matchAll(/\b(data-[\w-]+)(?=[\s>])/g))fields[`[${match[1]}]`]=control();fields['[data-leave-example]'].value='leave';};
  const setupFields=Object.fromEntries(['data-clear-line','data-clear-references','data-save-line','data-save-references','data-pad','data-clear','data-sign','data-upload','data-load-source','data-load-document','data-load-status'].map(key=>[`[${key}]`,control()])),line=control('2'),reference=control('2'),transition=control();transition.dataset={transition:'submit'};reference.checked=true;
  const draftLines=Array.from({length:9},()=>control()),draftReferences=Array.from({length:11},(_,index)=>({...control(String(index+2)),checked:false})),detailLines=[line,...Array.from({length:8},()=>control())],detailReferences=[reference,...Array.from({length:10},(_,index)=>({...control(String(index+3)),checked:false}))];
  setup.insertAdjacentHTML=(_position,html)=>{setup.innerHTML+=html;for(const match of html.matchAll(/\b(data-[\w-]+)(?=[\s>])/g))setupFields[`[${match[1]}]`]=control();setupFields['[data-draft-enabled]'].checked=true;};
  setup.querySelector=key=>setupFields[key];setup.querySelectorAll=key=>key==='[data-draft-line]'?draftLines:key==='[data-draft-reference]'?draftReferences:key==='[data-line]'?detailLines:key==='[data-reference]'?detailReferences:key==='[data-transition]'&&state==='draft'?[transition]:[];
  editor.querySelector=key=>key==='[data-form]'?(editor.innerHTML.includes('<form data-form>')?form:null):key==='[data-close]'?close:key==='[data-setup]'?setup:null;
  editor.replaceChildren=()=>{editor.closed=true;form.isConnected=false;};const openButton=control();openButton.dataset={open:'7'};
  list.querySelectorAll=()=>state?[openButton]:[];
  const target={querySelector:key=>({'[data-list]':list,'[data-editor]':editor,'[data-status]':status,'[data-new]':newButton}[key])};
  const data={document:{id:7,title,date:'2026-10-31',body,status:state,details:JSON.stringify({kind,bodyRich:rich})},version:'가상 버전',line:[],references:[],attachments:[],events:[],hasSignature:true};
  let optionsWait=null,sourceWait=null;const api=async(path,options={})=>{if(options.method){writes.push({path,method:options.method,input:JSON.parse(options.body)});if(saveWait)await saveWait;return data;}reads.push(path);if(path.startsWith('/api/reviewer/office-approval-default?'))return suggestion(path);if(path.startsWith('/api/reviewer/office-reference-preview?'))return preview(Number(new URLSearchParams(path.split('?')[1]).get('id')));if(path.endsWith('/options')){if(optionsWait)await optionsWait;return {people:Array.from({length:11},(_,index)=>({id:index+2,name:'가상 직원 '+index,active:1})),documents:sources.map(({id,title,date})=>({id,title,date}))};}if(path.endsWith('/7'))return data;const match=path.match(/\/office-documents\/(\d+)$/);if(match){if(sourceWait)await sourceWait;const document=sources.find(item=>item.id===Number(match[1]));if(!document)throw Error('본인 문서가 없습니다.');return {document};}return state?[data.document]:[];};
  const pad=(canvas,clear)=>{let drawing=false,signed=false,sequence=0;canvas.ink=[];canvas.onpointerdown=()=>{drawing=true;signed=true;canvas.ink.push(++sequence);};canvas.onpointermove=()=>{if(drawing)canvas.ink.push('move');};canvas.onpointerup=canvas.onpointercancel=()=>{drawing=false;};clear.onclick=()=>{canvas.ink=[];signed=false;};return ()=>{if(!signed)throw Error('시험 서명을 다시 입력해 주세요.');return '가상 서명:'+canvas.ink.join(',');};};
  let active=true;await mountReviewerOffice({target,siteId:1,api,active:()=>active,pad});await (state?openButton:newButton).onclick();setupFields['[data-load-document]'].disabled=!sources.length;
  if(!state&&!prepare)setupFields['[data-draft-enabled]'].checked=false;
  return {form,fields,bodyNode,editor,setup,setupFields,status,writes,reads,line,reference,draftLines,draftReferences,detailLines,detailReferences,transition,close,newButton,openButton,holdOpen(promise){optionsWait=promise;},holdSource(promise){sourceWait=promise;},stop(){active=false;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

const recommendation=(id=2)=>({document:{id:8,title:'가상 이전 문서',date:'2026-10-20'},reviewers:[{reviewer_id:id,active:1}]});
const signDraft=ui=>ui.setupFields['[data-draft-pad]'].emit('pointerdown');
const saveDraft=async ui=>{ui.form.onsubmit({preventDefault(){}});await flush();};

test('새 문서의 전체 해제는 선택만 비우고 서명 그림과 진행 중 획을 취소한다',async()=>{
  for(const key of ['[data-clear-line]','[data-clear-references]']){
    const ui=await screen({prepare:true,title:'선택 해제 시험'});await flush();ui.draftLines[0].value='2';ui.draftLines[1].value='3';ui.draftReferences[0].checked=true;ui.draftReferences[1].checked=true;
    const canvas=ui.setupFields['[data-draft-pad]'];signDraft(ui);canvas.emit('pointermove');ui.setupFields[key].onclick();canvas.emit('pointermove');assert.deepEqual(canvas.ink,[]);assert.equal(ui.form.elements.title.value,'선택 해제 시험');
    if(key==='[data-clear-line]'){assert.ok(ui.draftLines.every(item=>item.value===''));assert.equal(ui.draftReferences.filter(item=>item.checked).length,2);assert.equal(ui.draftLines[0].lastEvent.bubbles,true);ui.draftLines[0].value='2';ui.draftLines[0].emit('change');}
    else{assert.ok(ui.draftReferences.every(item=>!item.checked));assert.equal(ui.draftLines[0].value,'2');assert.equal(ui.draftReferences[0].lastEvent.bubbles,true);}
    await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/다시 입력/);signDraft(ui);await saveDraft(ui);assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].input.officeSetup.signature,'가상 서명:2');assert.deepEqual(ui.writes[0].input.officeSetup.referenceIds,key==='[data-clear-references]'?[]:[2,3]);
  }
});

test('빈 선택의 전체 해제는 변경 상태와 서명을 만들지 않고 늦은 자동 추천은 취소한다',async t=>{
  const previous=globalThis.confirm;let prompts=0;globalThis.confirm=()=>{prompts++;return false;};t.after(()=>{if(previous)globalThis.confirm=previous;else delete globalThis.confirm;});
  let finish;const fresh=await screen({prepare:true,suggestion:()=>new Promise(resolve=>{finish=resolve;})});fresh.setupFields['[data-clear-line]'].onclick();fresh.setupFields['[data-clear-references]'].onclick();finish(recommendation());await flush();assert.ok(fresh.draftLines.every(item=>!item.value));fresh.close.onclick();assert.equal(fresh.editor.closed,true);assert.equal(prompts,0);
  for(const state of ['draft','rejected']){const ui=await screen({state});ui.line.value='';ui.reference.checked=false;ui.setupFields['[data-clear-line]'].onclick();ui.setupFields['[data-clear-references]'].onclick();ui.close.onclick();assert.equal(ui.editor.closed,true);assert.equal(prompts,0);}
  const signed=await screen({prepare:true});await flush();signed.draftLines[0].value='2';signDraft(signed);signed.setupFields['[data-clear-references]'].onclick();assert.deepEqual(signed.setupFields['[data-draft-pad]'].ink,[1]);await saveDraft(signed);assert.equal(signed.writes.length,1);
  const detail=await screen({state:'draft'});detail.line.value='';detail.reference.checked=false;const canvas=detail.setupFields['[data-pad]'];canvas.emit('pointerdown');detail.setupFields['[data-clear-line]'].onclick();detail.setupFields['[data-clear-references]'].onclick();assert.deepEqual(canvas.ink,[1]);await detail.setupFields['[data-sign]'].onclick();assert.equal(detail.writes.length,1);assert.equal(detail.writes[0].input.signature,'가상 서명:1');
});

test('늦은 추천과 문서 조회는 전체 해제한 선택을 복원하지 않는다',async()=>{
  let finish;const fresh=await screen({prepare:true,suggestion:()=>new Promise(resolve=>{finish=resolve;})});fresh.draftLines[0].value='2';fresh.setupFields['[data-clear-line]'].onclick();finish(recommendation(3));await flush();assert.ok(fresh.draftLines.every(item=>!item.value));assert.equal(fresh.writes.length,0);
  for(const key of ['[data-clear-line]','[data-clear-references]']){const ui=await screen({state:'draft'});let release;ui.holdOpen(new Promise(resolve=>{release=resolve;}));const markup=ui.editor.innerHTML,opening=ui.newButton.onclick();ui.setupFields[key].onclick();release();await opening;assert.equal(ui.editor.innerHTML,markup);assert.equal(key==='[data-clear-line]'?ui.line.value:ui.reference.checked,key==='[data-clear-line]'?'':false);}
});

test('임시·반려 문서의 전체 해제는 새 서명을 지우며 해당 선택만 빈 배열로 저장한다',async()=>{
  for(const state of ['draft','rejected'])for(const key of ['line','references']){
    const ui=await screen({state,title:'보존할 문서'}),canvas=ui.setupFields['[data-pad]'];ui.detailLines[3].value='3';ui.detailReferences[1].checked=true;canvas.emit('pointerdown');canvas.emit('pointermove');ui.setupFields[`[data-clear-${key}]`].onclick();assert.deepEqual(canvas.ink,[]);canvas.emit('pointermove');assert.deepEqual(canvas.ink,[]);
    assert.ok(key==='line'?ui.detailLines.every(item=>!item.value):ui.detailReferences.every(item=>!item.checked));
    assert.equal(key==='line'?ui.line.value:ui.reference.checked,key==='line'?'':false);assert.equal(key==='line'?ui.reference.checked:ui.line.value,key==='line'?true:'2');assert.equal(ui.form.elements.title.value,'보존할 문서');
    await ui.setupFields['[data-sign]'].onclick();assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/저장하지 않은 변경/);
    await ui.setupFields[`[data-save-${key}]`].onclick();assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].path,`/api/reviewer/office-documents/7/${key}`);assert.deepEqual(ui.writes[0].input,{version:'가상 버전',ids:[]});
  }
});

test('전체 해제의 닫기 취소는 선택을 보존하고 다른 종류의 미저장 변경은 저장을 막는다',async t=>{
  const previous=globalThis.confirm;let accept=false,prompts=0;globalThis.confirm=()=>{prompts++;return accept;};t.after(()=>{if(previous)globalThis.confirm=previous;else delete globalThis.confirm;});
  for(const state of [null,'draft','rejected'])for(const key of ['line','references']){
    accept=false;const ui=await screen({state,prepare:!state});await flush();if(!state){ui.draftLines[0].value='2';ui.draftReferences[0].checked=true;}ui.setupFields[`[data-clear-${key}]`].onclick();ui.close.onclick();assert.notEqual(ui.editor.closed,true);assert.equal(ui.writes.length,0);accept=true;ui.close.onclick();assert.equal(ui.editor.closed,true);
  }
  assert.equal(prompts,12);
  for(const key of ['line','references'])for(const other of ['form','selection']){
    const ui=await screen({state:'draft'});if(other==='form'){ui.form.elements.title.value='미저장 제목';ui.form.emit('input');}else if(key==='line'){ui.reference.checked=false;ui.reference.emit('change');}else{ui.line.value='3';ui.line.emit('change');}
    ui.setupFields[`[data-clear-${key}]`].onclick();await ui.setupFields[`[data-save-${key}]`].onclick();assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/저장하지 않은 변경/);
  }
});

test('저장 중 전체 해제 시도는 신규·기존 선택과 서명 및 저장 요청을 바꾸지 않는다',async()=>{
  for(const state of [null,'draft','rejected']){
    let release;const saveWait=new Promise(resolve=>{release=resolve;}),ui=await screen({state,prepare:!state,saveWait});await flush();let saving;
    if(!state){ui.draftLines[0].value='2';ui.draftReferences[0].checked=true;signDraft(ui);ui.form.onsubmit({preventDefault(){}});}else{ui.setupFields['[data-pad]'].emit('pointerdown');saving=ui.setupFields['[data-sign]'].onclick();}
    assert.equal(ui.editor.inert,true);ui.setupFields['[data-clear-line]'].onclick();ui.setupFields['[data-clear-references]'].onclick();assert.equal(state?ui.line.value:ui.draftLines[0].value,'2');assert.equal(state?ui.reference.checked:ui.draftReferences[0].checked,true);assert.deepEqual(ui.setupFields[state?'[data-pad]':'[data-draft-pad]'].ink,[1]);assert.equal(ui.writes.length,1);release();await saving;await flush();assert.equal(ui.editor.inert,false);
  }
});

test('전체 해제 버튼은 편집 가능한 문서에만 표시한다',async()=>{
  for(const state of [null,'draft','rejected','pending','approved']){const ui=await screen({state});for(const name of ['line','references'])assert.equal(ui.setup.innerHTML.includes(`data-clear-${name}`),!['pending','approved'].includes(state));}
});

test('새 직원 문서는 기본 선택된 결재 준비를 문서와 한 요청에 저장한다',async()=>{
  const ui=await screen({prepare:true,title:'가상 일괄 문서',suggestion:async()=>recommendation()});await flush();
  assert.equal(ui.setupFields['[data-draft-enabled]'].checked,true);assert.equal(ui.draftLines.length,9);assert.equal(ui.draftLines[0].value,'2');assert.match(ui.setup.innerHTML,/작성자 시험 서명 입력 영역/);
  ui.draftReferences[1].checked=true;ui.draftReferences[1].emit('change');signDraft(ui);await saveDraft(ui);
  assert.equal(ui.writes.length,1);assert.deepEqual(ui.writes[0].input.officeSetup,{reviewerIds:[2],referenceIds:[3],signature:'가상 서명:1',referenceVersion:null});
  const plain=await screen({prepare:true});plain.setupFields['[data-draft-enabled]'].checked=false;plain.setupFields['[data-draft-enabled]'].onchange();await saveDraft(plain);assert.equal(plain.writes.length,1);assert.equal(plain.writes[0].input.officeSetup,undefined);
});

test('결재자 누락·중복과 참조자 초과 및 서명 이후 문서·결재 변경을 차단한다',async()=>{
  for(const change of [ui=>{},ui=>{ui.draftLines[0].value='2';ui.draftLines[1].value='2';},ui=>{ui.draftLines[0].value='2';ui.draftReferences.forEach(item=>item.checked=true);}]){
    const ui=await screen({prepare:true});await flush();change(ui);signDraft(ui);await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/결재자|참조자/);
  }
  for(const change of [ui=>{ui.form.elements.title.value='변경';ui.form.emit('input');},ui=>{ui.draftLines[0].value='3';ui.draftLines[0].emit('change');},ui=>{ui.draftReferences[0].checked=true;ui.draftReferences[0].emit('change');},ui=>ui.fields['[data-apply-example]'].onclick(),ui=>ui.setupFields['[data-draft-clear]'].emit('click')]){
    const ui=await screen({prepare:true});await flush();ui.draftLines[0].value='2';signDraft(ui);change(ui);await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/다시 입력/);signDraft(ui);await saveDraft(ui);assert.equal(ui.writes.length,1);
  }
});

test('내용 변경은 옛 서명 그림과 진행 중 획을 지우고 다음 서명에는 새 획만 남긴다',async()=>{
  for(const change of [ui=>{ui.form.elements.title.value='새 제목';ui.form.emit('input');},ui=>{ui.draftLines[0].value='3';ui.draftLines[0].emit('change');},ui=>{ui.draftReferences[0].checked=true;ui.draftReferences[0].emit('change');},ui=>ui.fields['[data-apply-example]'].onclick(),ui=>ui.setupFields['[data-draft-clear]'].emit('click')]){
    const ui=await screen({prepare:true});await flush();ui.draftLines[0].value='2';const canvas=ui.setupFields['[data-draft-pad]'];signDraft(ui);canvas.emit('pointermove');canvas.emit('pointerup');signDraft(ui);assert.deepEqual(canvas.ink,[1,'move',2]);
    change(ui);assert.deepEqual(canvas.ink,[]);canvas.emit('pointermove');assert.deepEqual(canvas.ink,[]);await saveDraft(ui);assert.equal(ui.writes.length,0);
    signDraft(ui);canvas.emit('pointermove');canvas.emit('pointerup');assert.deepEqual(canvas.ink,[3,'move']);await saveDraft(ui);assert.equal(ui.writes[0].input.officeSetup.signature,'가상 서명:3,move');
  }
});

test('같은 입력 값의 뒤늦은 change와 서명 후속 획은 현재 서명을 지우지 않는다',async()=>{
  const ui=await screen({prepare:true,title:'서명할 제목'});await flush();ui.draftLines[0].value='2';ui.form.emit('input');const canvas=ui.setupFields['[data-draft-pad]'];signDraft(ui);canvas.emit('pointerup');ui.form.emit('change');assert.deepEqual(canvas.ink,[1]);
  signDraft(ui);canvas.emit('pointermove');canvas.emit('pointerup');ui.draftLines[0].emit('change');assert.deepEqual(canvas.ink,[1,2,'move']);await saveDraft(ui);assert.equal(ui.writes[0].input.officeSetup.signature,'가상 서명:1,2,move');
});

test('잘못된 본문을 비교할 수 없으면 이벤트 오류 없이 서명과 획을 초기화한다',async()=>{
  const ui=await screen({prepare:true});await flush();ui.draftLines[0].value='2';const canvas=ui.setupFields['[data-draft-pad]'];signDraft(ui);ui.bodyNode.textContent='가'.repeat(200000);assert.doesNotThrow(()=>ui.form.emit('input'));assert.deepEqual(canvas.ink,[]);canvas.emit('pointermove');assert.deepEqual(canvas.ink,[]);
});

test('추천 응답은 선택 중인 결재선·서명·변경된 문서와 종류를 덮어쓰지 않는다',async()=>{
  for(const change of [ui=>ui.draftLines[0].emit('pointerdown'),ui=>ui.draftLines[0].emit('keydown'),ui=>{ui.draftLines[0].value='3';ui.draftLines[0].emit('change');},signDraft,ui=>{ui.form.elements.title.value='새 제목';ui.form.emit('input');},ui=>{ui.form.elements.kind.value='휴가신청서';ui.form.emit('change');}]){
    let finish;const ui=await screen({prepare:true,suggestion:()=>new Promise(resolve=>{finish=resolve;})});change(ui);const before=ui.draftLines.map(item=>item.value);finish(recommendation());await flush();assert.deepEqual(ui.draftLines.map(item=>item.value),before);assert.equal(ui.writes.length,0);
  }
});

test('수동 결재선 추천 교체 취소와 기타 구분 입력은 선택을 보존한다',async t=>{
  const previous=globalThis.confirm;globalThis.confirm=()=>false;t.after(()=>{if(previous)globalThis.confirm=previous;else delete globalThis.confirm;});
  const ui=await screen({prepare:true,suggestion:async()=>recommendation()});await flush();ui.draftLines[0].value='3';ui.draftLines[0].emit('change');const count=ui.reads.length;await ui.setupFields['[data-default-line]'].onclick();assert.equal(ui.draftLines[0].value,'3');assert.equal(ui.reads.length,count);
  ui.form.elements.kind.value='기타';ui.form.elements.otherKind.value='새 구분';ui.form.elements.otherKind.emit('input');ui.form.elements.otherKind.emit('change');await flush();assert.equal(ui.draftLines[0].value,'3');
});

test('구분 변경 이벤트가 폼까지 전파되어도 최신 추천을 적용하고 기타 입력 즉시 옛 자동선을 지운다',async()=>{
  const ui=await screen({prepare:true,suggestion:async path=>recommendation(path.includes(encodeURIComponent('휴가신청서'))?3:2)});await flush();assert.equal(ui.draftLines[0].value,'2');
  ui.form.elements.kind.value='휴가신청서';ui.form.elements.kind.emit('change');ui.form.emit('change');await flush();assert.equal(ui.draftLines[0].value,'3');
  ui.form.elements.kind.value='기타';ui.form.elements.kind.emit('change');ui.form.emit('change');await flush();assert.equal(ui.draftLines[0].value,'2');
  ui.form.elements.otherKind.value='다른 기타';ui.form.elements.otherKind.emit('input');ui.form.emit('input');assert.equal(ui.draftLines[0].value,'');
});

test('참조 문서 변경·느린 확인·재확인은 이전 서명을 무효화한다',async()=>{
  const resolvers=new Map(),ui=await screen({prepare:true,preview:id=>new Promise(resolve=>resolvers.set(id,resolve))});await flush();ui.draftLines[0].value='2';
  ui.form.elements.referenceDocId.value='9';ui.form.elements.referenceDocId.emit('change');signDraft(ui);await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/참조 문서를 다시/);
  ui.form.elements.referenceDocId.value='10';ui.form.elements.referenceDocId.emit('change');resolvers.get(9)({version:'오래된 버전',reference:{id:9,title:'오래된 참조',date:'',body:'',files:[]}});await flush();assert.doesNotMatch(ui.setupFields['[data-reference-preview]'].innerHTML||'',/오래된 참조/);
  signDraft(ui);resolvers.get(10)({version:'새 버전',reference:{id:10,title:'새 참조',date:'',body:'',files:[{id:3,name:'가상.txt'}]}});await flush();await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/다시 입력/);assert.match(ui.setupFields['[data-reference-preview]'].innerHTML,/\/10\/attachments\/3/);signDraft(ui);await saveDraft(ui);assert.equal(ui.writes[0].input.officeSetup.referenceVersion,'새 버전');
});

test('일괄 저장 실패 후 입력과 선택을 보존하고 저장 중 추천과 이동을 차단한다',async()=>{
  let reject;const saveWait=new Promise((_resolve,fail)=>{reject=fail;}),ui=await screen({prepare:true,title:'보존',saveWait});await flush();ui.draftLines[0].value='2';signDraft(ui);ui.form.onsubmit({preventDefault(){}});assert.equal(ui.editor.inert,true);
  const count=ui.reads.length;await ui.setupFields['[data-default-line]'].onclick();await ui.newButton.onclick();assert.equal(ui.reads.length,count);reject(Error('가상 일괄 저장 실패'));await flush();assert.equal(ui.editor.inert,false);assert.equal(ui.form.elements.title.value,'보존');assert.equal(ui.draftLines[0].value,'2');assert.match(ui.status.textContent,/일괄 저장 실패/);
});

test('이전 문서 조회 중 결재선·서명 변경은 복사를 취소하고 적용된 복사는 재서명을 요구한다',async()=>{
  for(const change of [ui=>{ui.draftLines[0].value='3';ui.draftLines[0].emit('change');},signDraft]){
    let finish;const ui=await screen({prepare:true,sources:[sourceDoc()]});await flush();ui.holdSource(new Promise(resolve=>{finish=resolve;}));ui.setupFields['[data-load-source]'].value='9';const loading=ui.setupFields['[data-load-document]'].onclick();change(ui);finish();await loading;assert.equal(ui.form.elements.title.value,'');assert.match(ui.setupFields['[data-load-status]'].textContent,/바뀌어 불러오지/);
  }
  const ui=await screen({prepare:true,sources:[sourceDoc()]});await flush();ui.draftLines[0].value='2';signDraft(ui);ui.setupFields['[data-load-source]'].value='9';await ui.setupFields['[data-load-document]'].onclick();await saveDraft(ui);assert.equal(ui.writes.length,0);assert.match(ui.status.textContent,/다시 입력/);
});

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
    let release;const saveWait=new Promise(resolve=>{release=resolve;}),ui=await screen({state:'draft',saveWait}),button=key==='transition'?ui.transition:ui.setupFields[key];if(key==='[data-sign]')ui.setupFields['[data-pad]'].emit('pointerdown');const saving=button.onclick();
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
