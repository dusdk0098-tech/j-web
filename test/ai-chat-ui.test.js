import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountAiChat,validateAiImage} from '../public/ai-chat.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Element {
  constructor(tagName='div',ownerDocument){this.tagName=tagName;this.ownerDocument=ownerDocument;this.value='';this.hidden=false;this.open=false;this.children=[];this.attributes={};this.files=[];this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this[name];}
  focus(){this.focused=true;this.ownerDocument.activeElement=this;}
  showModal(){this.open=true;this.modalShown=true;}
  close(){this.open=false;this.onclose?.();}
}
function fixture(api,loadImage){
  const doc={createElement:tagName=>new Element(tagName,doc)};
  const nodes=Object.fromEntries(['panel','toggle','form','text','file','send','error','status','remove','attachment','filename','preview','preview-open','image-dialog','image-full','image-name','image-close','close','messages'].map(id=>[id,new Element('div',doc)]));
  nodes.panel.hidden=true;
  const root={querySelector:selector=>nodes[selector.slice(4)],ownerDocument:doc};
  mountAiChat(root,{api,loadImage});return nodes;
}
const submit=nodes=>nodes.form.onsubmit({preventDefault(){}});

test('AI는 명시적으로 열고 전송할 때만 요청하며 미설정이면 전송하지 않는다',async()=>{
  const calls=[],nodes=fixture(async(path,body)=>{calls.push({path,body});return {configured:false,message:'AI 제공업체 미설정'};});
  assert.equal(calls.length,0);await nodes.toggle.onclick();assert.equal(calls.length,1);assert.equal(nodes.status.textContent,'AI 제공업체 미설정');assert.equal(nodes.send.disabled,true);
  nodes.text.value='가상 질문';await submit(nodes);assert.equal(calls.length,1);nodes.close.onclick();assert.equal(nodes.text.value,'가상 질문');assert.equal(nodes.toggle.attributes['aria-expanded'],'false');
});

test('늦은 연결 상태 응답은 새 상태를 덮어쓰지 않는다',async()=>{
  const first=deferred(),second=deferred();let count=0;const nodes=fixture(()=>++count===1?first.promise:second.promise);
  const old=nodes.toggle.onclick();nodes.close.onclick();const current=nodes.toggle.onclick();second.resolve({configured:false,message:'새 미설정 상태'});await current;first.resolve({configured:true,message:'이전 상태'});await old;
  assert.equal(nodes.status.textContent,'새 미설정 상태');assert.equal(nodes.send.disabled,true);
});

test('전송 중복을 막고 실패한 질문·사진을 보존하며 성공 답변을 텍스트로 표시한다',async()=>{
  const pending=deferred(),calls=[];let fail=true;const nodes=fixture(async(path,body)=>{calls.push({path,body});if(path==='status')return {configured:true};if(fail)return pending.promise;return {id:'answer-1',answer:'<img src=x onerror=alert(1)> 시험 답변'};},async()=>'YWJj');
  await nodes.toggle.onclick();nodes.file.files=[{name:'가상.png',type:'image/png',size:3}];await nodes.file.onchange();assert.equal(calls.length,1);
  nodes.text.value='가상 질문';const sending=submit(nodes);await submit(nodes);assert.equal(calls.length,2);assert.equal(nodes.text.disabled,true);assert.equal(nodes.file.disabled,true);assert.equal(nodes.remove.disabled,true);
  nodes.close.onclick();pending.reject(Error('시험 서버 오류'));await sending;assert.equal(nodes.text.value,'가상 질문');assert.equal(nodes.attachment.hidden,false);assert.equal(nodes.error.textContent,'시험 서버 오류');assert.equal(nodes.send.disabled,false);
  fail=false;await submit(nodes);assert.deepEqual(calls[2],{path:'chat',body:{text:'가상 질문',image:{name:'가상.png',mimeType:'image/png',data:'YWJj'}}});
  assert.equal(nodes.text.value,'');assert.equal(nodes.attachment.hidden,true);assert.equal(nodes.messages.children.length,1);assert.equal(nodes.messages.children[0].children[2].textContent,'<img src=x onerror=alert(1)> 시험 답변');
});

test('선택·전송 사진은 같은 데이터로 확대하고 닫기·Escape 후 초점을 복원하며 추가 요청하지 않는다',async()=>{
  const calls=[],nodes=fixture(async(path,body)=>{calls.push({path,body});return path==='status'?{configured:true}:{id:'photo-answer',answer:'가상 답변'};},async file=>file.name==='둘째.webp'?'bmV3':'YWJj');
  await nodes.toggle.onclick();const name='<img src=x onerror=alert(1)>.png';nodes.file.files=[{name,type:'image/png',size:3}];await nodes.file.onchange();
  const src=nodes.preview.src;nodes['preview-open'].onclick();assert.equal(nodes['image-dialog'].modalShown,true);assert.equal(nodes['image-full'].src,src);assert.equal(nodes['image-name'].textContent,name);assert.equal(nodes['image-name'].children.length,0);assert.equal(nodes['image-close'].ownerDocument.activeElement,nodes['image-close']);
  nodes['image-close'].onclick();assert.equal(nodes['image-dialog'].open,false);assert.equal(nodes['image-full'].src,undefined);assert.equal(nodes['image-name'].textContent,'');assert.equal(nodes['preview-open'].ownerDocument.activeElement,nodes['preview-open']);
  await submit(nodes);const photo=nodes.messages.children[0].children[1];assert.equal(photo.tagName,'button');assert.equal(photo.type,'button');assert.equal(photo.attributes['aria-haspopup'],'dialog');assert.equal(photo.attributes['aria-controls'],'ai-image-dialog');assert.equal(photo.children[0].tagName,'img');assert.equal(photo.children[0].src,src);assert.equal(photo.children[0].alt,name);
  nodes.file.files=[{name:'둘째.webp',type:'image/webp',size:3}];await nodes.file.onchange();assert.notEqual(nodes.preview.src,src);photo.onclick();assert.equal(nodes['image-full'].src,src);let canceled=false;nodes['image-dialog'].oncancel({preventDefault(){canceled=true;}});assert.equal(canceled,true);assert.equal(nodes['image-dialog'].open,false);assert.equal(nodes.panel.hidden,false);assert.equal(photo.ownerDocument.activeElement,photo);
  nodes.remove.onclick();photo.onclick();assert.equal(nodes['image-full'].src,src);nodes.close.onclick();assert.equal(nodes['image-dialog'].open,false);assert.equal(nodes.toggle.ownerDocument.activeElement,nodes.toggle);assert.deepEqual(calls.map(call=>call.path),['status','chat']);assert.deepEqual(calls[1].body,{text:'',image:{name,mimeType:'image/png',data:'YWJj'}});
});

test('후속 질문은 이전 질문·사진·답변 없이 전송한다',async()=>{
  const calls=[],nodes=fixture(async(path,body)=>{if(path==='status')return {configured:true};calls.push(body);return {id:`answer-${calls.length}`,answer:'첫 질문 답변'};},async()=>'YWJj');
  await nodes.toggle.onclick();nodes.text.value='첫 질문';nodes.file.files=[{name:'첫째.png',type:'image/png',size:3}];await nodes.file.onchange();await submit(nodes);nodes.text.value='다음 질문';await submit(nodes);
  assert.equal(nodes.messages.children.length,2);assert.deepEqual(calls[1],{text:'다음 질문'});
});

test('미리보기 확대 중 전송이 끝나 첨부 버튼이 숨겨지면 질문 입력으로 초점을 복원한다',async()=>{
  const pending=deferred(),nodes=fixture(async path=>path==='status'?{configured:true}:pending.promise,async()=>'YWJj');
  await nodes.toggle.onclick();nodes.file.files=[{name:'가상.png',type:'image/png',size:3}];await nodes.file.onchange();const sending=submit(nodes);nodes['preview-open'].onclick();pending.resolve({id:'photo-answer',answer:'가상 답변'});await sending;
  assert.equal(nodes.attachment.hidden,true);assert.equal(nodes['image-dialog'].open,true);nodes['image-close'].onclick();assert.equal(nodes.text.ownerDocument.activeElement,nodes.text);assert.equal(nodes.text.disabled,false);
});

test('사진 선택의 역순 완료와 제거 이후 읽기 완료를 무시한다',async()=>{
  const first=deferred(),second=deferred();let reads=0;const nodes=fixture(async()=>({configured:true}),()=>++reads===1?first.promise:second.promise);await nodes.toggle.onclick();
  nodes.file.files=[{name:'처음.png',type:'image/png',size:3}];const old=nodes.file.onchange();assert.equal(nodes.send.disabled,true);
  nodes.file.files=[{name:'나중.png',type:'image/png',size:3}];const latest=nodes.file.onchange();second.resolve('bmV3');await latest;first.resolve('b2xk');await old;
  assert.equal(nodes.filename.textContent,'나중.png');assert.equal(nodes.preview.src,'data:image/png;base64,bmV3');
  const reading=deferred(),other=fixture(async()=>({configured:true}),()=>reading.promise);await other.toggle.onclick();other.file.files=[{name:'제거.png',type:'image/png',size:3}];const removed=other.file.onchange();other.remove.onclick();reading.resolve('YWJj');await removed;assert.equal(other.attachment.hidden,true);assert.equal(other.send.disabled,false);
});

test('잘못된 사진·빈 질문·초과 질문은 전송하지 않으며 기존 사진을 보존한다',async()=>{
  for(const file of [{type:'image/svg+xml',size:1},{type:'image/png',size:0},{type:'image/png',size:5*1024*1024+1}])assert.throws(()=>validateAiImage(file));
  validateAiImage({type:'image/webp',size:5*1024*1024});const calls=[],nodes=fixture(async path=>{calls.push(path);return {configured:true};},async()=>'YWJj');await nodes.toggle.onclick();await submit(nodes);assert.match(nodes.error.textContent,/질문이나 사진/);
  nodes.text.value='가'.repeat(4001);await submit(nodes);assert.match(nodes.error.textContent,/4,000/);assert.deepEqual(calls,['status']);
  nodes.file.files=[{name:'유지.png',type:'image/png',size:1}];await nodes.file.onchange();nodes.file.files=[{name:'거절.svg',type:'image/svg+xml',size:1}];await nodes.file.onchange();assert.equal(nodes.filename.textContent,'유지.png');assert.match(nodes.error.textContent,/JPEG/);
});

test('평가 중복 클릭과 좋음·나쁨 경합을 막고 실패 후 다시 평가할 수 있다',async()=>{
  const pending=deferred(),calls=[];let failing=true;const nodes=fixture(async(path,body)=>{if(path==='status')return {configured:true};if(path==='chat')return {id:'answer-2',answer:'가상 답변'};calls.push(body);if(failing)return pending.promise;return {ok:true};});
  await nodes.toggle.onclick();nodes.text.value='가상';await submit(nodes);const [, ,good,bad,status]=nodes.messages.children[0].children;
  const sending=good.onclick();await bad.onclick();assert.equal(calls.length,1);assert.equal(bad.disabled,true);pending.reject(Error('평가 시험 오류'));await sending;assert.equal(good.attributes['aria-pressed'],'false');assert.equal(status.textContent,'평가 시험 오류');assert.equal(bad.disabled,false);
  failing=false;await bad.onclick();assert.deepEqual(calls[1],{id:'answer-2',rating:'bad'});assert.equal(bad.attributes['aria-pressed'],'true');assert.equal(good.attributes['aria-pressed'],'false');
});

test('관리자만 위젯을 연결하며 입력 라벨과 반응형·인쇄 규칙을 제공한다',()=>{
  const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),join=readFileSync(new URL('../public/join.html',import.meta.url),'utf8'),css=readFileSync(new URL('../public/ai-chat.css',import.meta.url),'utf8');
  assert.match(index,/src="\/ai-chat.js"/);assert.doesNotMatch(join,/ai-chat/);assert.match(index,/for="ai-text"/);assert.match(index,/for="ai-file"/);assert.match(index,/aria-controls="ai-panel"/);assert.match(index,/role="log"/);assert.match(css,/100dvh/);assert.match(css,/@media print/);
  assert.match(index,/<button id="ai-preview-open" type="button"[^>]*aria-label="선택한 사진 확대 보기"[^>]*aria-haspopup="dialog"/);assert.match(index,/<dialog id="ai-image-dialog" aria-labelledby="ai-image-title" aria-describedby="ai-image-name">/);assert.match(index,/id="ai-image-close" type="button"[^>]*autofocus/);assert.match(index,/각 질문은 독립적으로 처리되며 이전 대화는 제공업체에 전송되지 않습니다/);
  assert.match(css,/#ai-image-dialog\{[^}]*width:calc\(100vw - 32px\)[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow:auto/);assert.match(css,/#ai-image-full\{[^}]*max-width:100%[^}]*object-fit:contain/);
});
