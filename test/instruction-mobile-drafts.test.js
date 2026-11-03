import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// shortcut: 실제 지시 목록 코드를 가상 DOM에서 실행하며 화면 배치는 브라우저 검증 대상이다.
function screen(){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.value='';this.disabled=false;this.isConnected=true;this._text='';}
    set textContent(value){this._text=value;this.children=[];}get textContent(){return this._text;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    setAttribute(){} remove(){this.isConnected=false;} click(){downloads.push(this.download);}
    set value(value){this._value=value;if(this.tag==='input'&&value==='')this.files=[];}get value(){return this._value;}
    set innerHTML(value){if(this.tag==='form'){this.elements={date:{value:''},content:{value:''}};this.parts={canvas:new Node('canvas'),'button[type=button]':new Node('button'),'button[type=submit]':new Node('button')};}else if(value.includes('사진 첨부')){this.parts={ul:new Node('ul'),'[role=status]':new Node('p'),button:new Node('button'),input:Object.assign(new Node('input'),{files:[]}),select:Object.assign(new Node('select'),{value:'before'})};}}
    querySelector(key){return this.parts[key];}
  }
  const list=new Node('div'),instructions=new Node('section');instructions.parts={'#instruction-list':list};
  const requests=[],downloads=[],panel={isConnected:true},logout={disabled:false};
  const context={instructions,panel,logout,siteKey:'A',workerSiteKey:'A',dayStopped:false,reportContext:{workerId:1,siteId:1,generation:'A'},initialLoads:[],document:{createElement:tag=>new Node(tag),body:new Node('body')},URL:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},setTimeout:()=>{},Date,
    signaturePad:canvas=>({value(){if(!canvas.signature)throw Error('서명 필요');return canvas.signature;},clear(){canvas.signature='';}}),
    FormData:class{constructor(form){return Object.entries(form.elements).map(([key,input])=>[key,input.value]);}},
    endWorkerDay(){context.dayStopped=true;panel.isConnected=false;},
    fetch:(url,options)=>new Promise(resolve=>{requests.push({url,options,resolve});})};
  const start=source.indexOf('    const instructionList='),end=source.indexOf('    const notices=',start);
  const helper=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8'),functions=helper.slice(helper.indexOf('export function workerDocumentRequest'),helper.indexOf('export async function mountWorkerDocuments')).replaceAll('export ','');assert.ok(start>0&&end>start);runInNewContext(functions+'\nconst workerFileRequest=workerDocumentRequest(reportContext,()=>panel.isConnected&&!dayStopped,text=>endWorkerDay(text));\n'+source.slice(start,end)+'\nglobalThis.load=loadInstructions;',context);
  const reply=async(req,data,status=200)=>{req.resolve({ok:status<300,status,json:async()=>data});await tick();};
  const pending=(url,method='GET')=>requests.filter(r=>r.url===url&&(r.options?.method||'GET')===method).at(-1);
  const items=[1,2].map(id=>({id,title:'가상 '+id,body:'가상 지시',result_date:null}));
  async function finishLoad(values=items){await reply(pending('/api/worker/instructions'),values);for(const item of values){for(const kind of ['attachments','photos']){const req=pending(`/api/worker/instructions/${item.id}/${kind}`);if(req&&!req.done){req.done=true;await reply(req,[]);}}}}
  const form=index=>list.children[index].children.find(n=>n.tag==='form');
  const edit=(form,text)=>{form.elements.content.value=text;form.parts.canvas.signature=text+' 서명';};
  return {context,list,instructions,requests,downloads,items,panel,logout,pending,reply,finishLoad,form,edit,submit:form=>form.onsubmit({preventDefault(){}}),async start(){const p=context.load();await finishLoad();await p;}};
}

test('작업지시 첨부는 원래 세션과 현재 행을 확인한다',async()=>{
  for(const mode of ['success','replace','session']){const ui=screen(),load=ui.context.load();await ui.reply(ui.pending('/api/worker/instructions'),[ui.items[0]]);await ui.reply(ui.pending('/api/worker/instructions/1/attachments'),[{id:9,name:'가상.txt'}]);await load;const button=ui.list.children[0].children[2].children[1].children[0].children[0],pending=button.onclick(),request=ui.pending('/api/worker/instructions/1/attachments/9');assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'A');if(mode==='replace'){const next=ui.context.load();await ui.reply(ui.pending('/api/worker/instructions'),[]);await next;}if(mode==='session')request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'세션 변경'})});else request.resolve({ok:true,status:200,blob:async()=>new Blob(['가상'])});await pending;assert.deepEqual(ui.downloads,mode==='success'?['가상.txt']:[]);if(mode==='session')assert.equal(ui.context.dayStopped,true);}
});

test('A 조치 저장과 재조회는 B의 내용·날짜·서명 DOM을 보존한다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0),b=ui.form(1);ui.edit(a,'A 입력');ui.edit(b,'B 입력');b.elements.date.value='2030-01-02';
  const saving=ui.submit(a);await ui.submit(a);assert.equal(ui.requests.filter(r=>r.options?.method==='POST').length,1);
  ui.edit(b,'B 추가 입력');await ui.reply(ui.pending('/api/worker/instructions','POST'),{},201);
  await ui.finishLoad([{...ui.items[0],result_date:'2030-01-01',result_content:'A 입력',result_source:'admin'},ui.items[1]]);await saving;
  assert.equal(ui.form(1),b);assert.equal(b.elements.content.value,'B 추가 입력');assert.equal(b.elements.date.value,'2030-01-02');assert.equal(b.parts.canvas.signature,'B 추가 입력 서명');
});

test('전송 중 본인 추가 편집·서명은 남기고 저장 완료 뒤 중복 전송을 막는다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0);ui.edit(a,'전송 내용');const saving=ui.submit(a);ui.edit(a,'전송 뒤 입력');
  await ui.reply(ui.pending('/api/worker/instructions','POST'),{},201);await ui.finishLoad([{...ui.items[0],result_date:'2030-01-01',result_content:'전송 내용'},ui.items[1]]);await saving;
  assert.equal(ui.form(0),a);assert.equal(a.elements.content.value,'전송 뒤 입력');assert.equal(a.parts.canvas.signature,'전송 뒤 입력 서명');assert.equal(a.parts['button[type=submit]'].disabled,true);await ui.submit(a);assert.equal(ui.requests.filter(r=>r.options?.method==='POST').length,1);
  assert.match(a.children.at(-1).textContent,/전송한 내용은 저장됐습니다/);assert.match(a.children.at(-1).textContent,/미저장/);
});

test('조회 실패·서버 충돌은 초안을 지우지 않고 변경된 지시서는 재전송을 막는다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0);ui.edit(a,'보존');const saving=ui.submit(a);await ui.reply(ui.pending('/api/worker/instructions','POST'),{error:'서버 충돌'},409);await saving;
  assert.equal(ui.form(0),a);assert.equal(a.elements.content.value,'보존');assert.equal(a.parts['button[type=submit]'].disabled,false);
  const failed=ui.context.load();await ui.reply(ui.pending('/api/worker/instructions'),{error:'조회 실패'},500);await failed;assert.equal(ui.form(0),a);
  const changed=ui.context.load();await ui.finishLoad([{...ui.items[0],body:'서버 변경'},ui.items[1]]);await changed;assert.equal(ui.form(0),a);assert.equal(a.parts['button[type=submit]'].disabled,true);
});

for(const state of ['logout','detach','site','stopped'])test('지연 응답은 '+state+' 이후 목록을 바꾸거나 추가 조회하지 않는다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0);ui.edit(a,'비공개 초안');const saving=ui.submit(a),count=ui.requests.length;
  if(state==='logout')ui.logout.disabled=true;if(state==='detach')ui.panel.isConnected=false;if(state==='site')ui.context.siteKey='B';if(state==='stopped')ui.context.dayStopped=true;
  await ui.reply(ui.pending('/api/worker/instructions','POST'),{},201);await saving;assert.equal(ui.requests.length,count);assert.equal(ui.form(0),a);
});

test('늦은 목록 응답은 최신 목록을 덮지 않으며 삭제된 대상 초안은 제거한다',async()=>{
  const ui=screen();await ui.start();ui.edit(ui.form(0),'철회 대상');const old=ui.context.load(),oldRequest=ui.pending('/api/worker/instructions'),latest=ui.context.load();await ui.finishLoad([ui.items[1]]);await latest;
  await ui.reply(oldRequest,ui.items);await old;assert.equal(ui.list.children.length,1);assert.equal(ui.list.children[0].children[0].textContent,'가상 2');
});

for(const status of [401,403,409])test('조회 문맥 거절 '+status+'은 기존 계정 화면을 종료한다',async()=>{
  const ui=screen();await ui.start();const work=ui.context.load(),req=ui.pending('/api/worker/instructions');assert.deepEqual(JSON.parse(req.options.headers['X-Worker-Report-Context']),ui.context.reportContext);
  await ui.reply(req,{error:'세션 변경',sessionChanged:true},status);await work;assert.equal(ui.panel.isConnected,false);assert.equal(ui.context.dayStopped,true);
});

test('최신 조회 뒤 도착한 이전 권한 오류는 최신 화면을 종료하지 않는다',async()=>{
  const ui=screen();await ui.start();const old=ui.context.load(),request=ui.pending('/api/worker/instructions'),latest=ui.context.load();await ui.finishLoad();await latest;
  await ui.reply(request,{error:'이전 권한 오류'},403);await old;assert.equal(ui.panel.isConnected,true);assert.equal(ui.list.children.length,2);
});

test('전송 중 선택한 다음 사진 파일은 이전 사진 성공 응답이 지우지 않는다',async()=>{
  const ui=screen(),loading=ui.context.load();await ui.finishLoad([{...ui.items[0],result_date:'2030-01-01',result_source:'worker'}]);await loading;
  const photos=ui.list.children[0].children.find(node=>node.parts?.select),input=photos.parts.input,button=photos.parts.button,old={name:'old.png',type:'image/png',size:10},next={name:'new.png',type:'image/png',size:10};input.files=[old];input.value='old.png';
  const saving=button.onclick({currentTarget:button});input.files=[next];input.value='new.png';
  await ui.reply(ui.pending('/api/worker/instructions/1/photos?phase=before','POST'),{},201);await ui.reply(ui.pending('/api/worker/instructions/1/photos'),[]);await saving;
  assert.equal(input.files[0],next);assert.equal(input.value,'new.png');assert.equal(button.disabled,false);
});

test('지시 저장의 세션 변경 거절은 다른 계정에 이전 초안을 표시하지 않는다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0);ui.edit(a,'이전 계정');const saving=ui.submit(a);await ui.reply(ui.pending('/api/worker/instructions','POST'),{error:'다른 계정',sessionChanged:true},409);await saving;assert.equal(ui.panel.isConnected,false);
});

for(const editDuringSave of [false,true])test('저장 성공 뒤 목록 실패는 성공 안내와 '+(editDuringSave?'추가 초안':'저장 내용')+'을 구분해 남긴다',async()=>{
  const ui=screen();await ui.start();const a=ui.form(0);ui.edit(a,'전송 내용');const saving=ui.submit(a);if(editDuringSave)ui.edit(a,'추가 초안');
  await ui.reply(ui.pending('/api/worker/instructions','POST'),{},201);await ui.reply(ui.pending('/api/worker/instructions'),{error:'가상 조회 실패'},500);await saving;
  assert.equal(ui.form(0),a);assert.match(a.children.at(-1).textContent,/저장됐습니다/);assert.match(ui.instructions.children[0].textContent,/가상 조회 실패/);assert.equal(a.parts['button[type=submit]'].disabled,true);
  if(editDuringSave){assert.match(a.children.at(-1).textContent,/미저장/);assert.equal(a.elements.content.value,'추가 초안');assert.equal(a.parts.canvas.signature,'추가 초안 서명');}
  await ui.submit(a);assert.equal(ui.requests.filter(r=>r.options?.method==='POST').length,1);
});

for(const selectNext of [false,true])test('사진 저장 성공 뒤 목록 실패는 성공 안내와 '+(selectNext?'다음 파일':'파일 선택 초기화')+'을 보존한다',async()=>{
  const ui=screen(),loading=ui.context.load();await ui.finishLoad([{...ui.items[0],result_date:'2030-01-01',result_source:'worker'}]);await loading;
  const photos=ui.list.children[0].children.find(node=>node.parts?.select),input=photos.parts.input,button=photos.parts.button,file={name:'saved.png',type:'image/png',size:10},next={name:'pending.png',type:'image/png',size:10};input.files=[file];input.value=file.name;
  const saving=button.onclick({currentTarget:button});if(selectNext){input.files=[next];input.value=next.name;}
  await ui.reply(ui.pending('/api/worker/instructions/1/photos?phase=before','POST'),{},201);await ui.reply(ui.pending('/api/worker/instructions/1/photos'),{error:'가상 목록 실패'},500);await saving;
  assert.match(photos.parts['[role=status]'].textContent,/사진은 저장했습니다/);assert.match(photos.parts['[role=status]'].textContent,/목록 갱신에 실패/);
  if(selectNext){assert.equal(input.files[0],next);assert.equal(input.value,next.name);}else{assert.equal(input.value,'');assert.equal(input.files.length,0);await button.onclick({currentTarget:button});assert.equal(ui.requests.filter(r=>r.options?.method==='POST').length,1);assert.match(photos.parts['[role=status]'].textContent,/선택해 주세요/);}
});
