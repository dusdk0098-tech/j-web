import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { CommonWork } from '../common-work.js';
import { newWorkWithFiles,mountCommonWork } from '../public/common-work-view.js';
const input={date:'2026-11-01',title:'가상 신규 첨부',category:'공정회의',process:'시험',participants:'참여',instructor:'지시',location:'구역',content:'시험 내용',status:'published'};
const files=[{name:'가상1.txt',size:3},{name:'가상2.txt',size:3}];
function fixture(overrides={}){
  const store=new Store(':memory:'),work=new CommonWork(store.db),site=store.createSite({name:'가상 현장'}),events=[];
  const actions={create:async data=>{events.push('create');return work.create(site.id,data);},upload:async(row,file)=>{events.push('upload');return work.addFile(site.id,row.id,null,row.version,file.name,Buffer.from('abc'));},publish:async(row,data)=>{events.push('publish');return work.update(site.id,row.id,data);},...overrides};
  return {store,work,site,events,actions,save:newWorkWithFiles(actions)};
}
test('신규 첨부는 임시 생성·두 파일·응답 버전 게시 순서로 저장하고 모든 필드를 보존한다',async()=>{
  const f=fixture();try{await f.save(input,files);assert.deepEqual(f.events,['create','upload','upload','publish']);const [row]=f.work.list(f.site.id);assert.equal(row.status,'published');assert.deepEqual(row.files.map(file=>file.name),files.map(file=>file.name));for(const key of Object.keys(input))assert.equal(row[key],input[key]);await assert.rejects(f.save(input,files),/이미 저장/);assert.equal(f.work.list(f.site.id).length,1);}finally{f.store.close();}
});
test('임시 저장 선택은 모든 첨부 후에도 게시하지 않는다',async()=>{const f=fixture();try{await f.save({...input,status:'draft'},files);assert.deepEqual(f.events,['create','upload','upload']);assert.equal(f.work.list(f.site.id)[0].status,'draft');}finally{f.store.close();}});
test('중복 클릭은 생성 요청 한 건만 실행한다',async()=>{let resolve,count=0;const save=newWorkWithFiles({create:()=>{count++;return new Promise(done=>resolve=done);},upload:async()=>({version:'v2'}),publish:async()=>{}});const first=save(input,[files[0]]);await assert.rejects(save(input,files),/이미 저장/);resolve({id:1,version:'v1'});await first;assert.equal(count,1);});
for(const stage of ['create','upload','publish'])test(stage+' 응답 유실은 재전송 없이 저장 결과 확인을 요구한다',async()=>{
  const f=fixture();try{const original=f.actions[stage];f.actions[stage]=async(...args)=>{await original(...args);throw Error('응답 유실');};const save=newWorkWithFiles(f.actions);await assert.rejects(save(input,files),/목록에서 제목·첨부·상태/);const before=f.events.slice();await assert.rejects(save(input,files),/이미 저장/);assert.deepEqual(f.events,before);const [row]=f.work.list(f.site.id);assert.equal(f.work.list(f.site.id).length,1);assert.equal(row.status,stage==='publish'?'published':'draft');assert.equal(row.files.length,stage==='create'?0:stage==='upload'?1:2);}finally{f.store.close();}
});
for(const code of [401,409])test(code+' 부분 실패 후 다음 첨부 및 게시를 중단한다',async()=>{const f=fixture();try{let uploads=0;const upload=f.actions.upload;const save=newWorkWithFiles({...f.actions,upload:async(...args)=>{if(++uploads===2)throw Error(String(code));return upload(...args);}});await assert.rejects(save(input,files),new RegExp(code+'.*첨부 응답 확인 1/2'));assert.equal(f.work.list(f.site.id)[0].status,'draft');assert.equal(f.work.list(f.site.id)[0].files.length,1);assert.ok(!f.events.includes('publish'));}finally{f.store.close();}});
for(const stage of ['create','upload'])test(stage+' 이후 화면 전환은 후속 저장을 중단한다',async()=>{const f=fixture();try{let active=true;const original=f.actions[stage];const save=newWorkWithFiles({...f.actions,active:()=>active,[stage]:async(...args)=>{const result=await original(...args);active=false;return result;}});await assert.rejects(save(input,files),/화면이 변경/);assert.equal(f.work.list(f.site.id)[0].status,'draft');assert.equal(f.events.filter(event=>event==='upload').length,stage==='create'?0:1);}finally{f.store.close();}});
test('첨부 성공 뒤 다른 관리자의 변경은 최신 버전을 재조회하지 않고 409로 게시를 막는다',async()=>{const f=fixture();try{const upload=f.actions.upload;const save=newWorkWithFiles({...f.actions,upload:async(...args)=>{const result=await upload(...args);const current=f.work.get(f.site.id,args[0].id);f.work.update(f.site.id,current.id,{...input,status:'draft',title:'다른 가상 변경',version:current.version});return result;}});await assert.rejects(save(input,[files[0]]),error=>error.cause.sessionStatus===409);const [row]=f.work.list(f.site.id);assert.equal(row.status,'draft');assert.equal(row.title,'다른 가상 변경');}finally{f.store.close();}});
test('파일 개수·크기·이름·게시 구분은 생성 전에 검증하고 수정 후 재시도 가능하다',async()=>{let count=0;const save=newWorkWithFiles({create:async()=>{count++;return {id:1,version:'v1'};},upload:async()=>({version:'v2'}),publish:async()=>{}});for(const selected of [[],Array(21).fill(files[0]),[{name:'x',size:0}],[{name:'x',size:2097153}],[{name:'../x',size:3}]])await assert.rejects(save(input,selected));await assert.rejects(save({...input,category:''},files),/구분/);assert.equal(count,0);await save(input,[{name:'한도.txt',size:2097152}]);assert.equal(count,1);});
test('서버는 20개 한도와 2MiB 경계를 유지하고 응답 버전은 트랜잭션 결과와 같다',()=>{const f=fixture();try{let row=f.work.create(f.site.id,{...input,status:'draft'});for(let i=0;i<20;i++){const file=f.work.addFile(f.site.id,row.id,null,row.version,'가상'+i+'.txt',Buffer.alloc(i===0?2097152:1));row=f.work.get(f.site.id,row.id);assert.equal(file.version,row.version);}assert.throws(()=>f.work.addFile(f.site.id,row.id,null,row.version,'초과.txt',Buffer.from('x')),/20개/);assert.throws(()=>f.work.addFile(f.site.id,row.id,null,row.version,'크기.txt',Buffer.alloc(2097153)),/2MB/);assert.equal(f.work.files(f.site.id,row.id).length,20);}finally{f.store.close();}});
test('DOM 대역: 복수 선택·중복 클릭 차단·실패 잠금·목록 복구에서 입력 보존',async()=>{
  let controls,html,creates=0,release;const doc={};
  const target={isConnected:true,set innerHTML(value){html=value;controls=Object.fromEntries(['work-status','work-cancel','work-recover','work-new-files','new-files-list','rich-toolbar','work-search','work-select-all','work-preview','work-print'].map(name=>['[data-'+name+']',{}]));const submit={};const elements=Object.fromEntries(Object.keys(input).map(key=>[key,{value:'',querySelector:()=>({}),focus(){}}]));controls['[data-work-form]']={elements,querySelector:()=>submit,reset(){}};controls['[data-rich-editor]']={ownerDocument:doc,childNodes:[],replaceChildren(){},querySelectorAll(){return [];}};controls['[data-work-new-files]'].files=files;},querySelector(selector){return controls[selector];},querySelectorAll(){return Object.values(controls).filter(control=>!control.elements);}};
  const api=async(path,options)=>{assert.equal(options,undefined);return [];};
  const originalFormData=globalThis.FormData,originalFetch=globalThis.fetch;
  globalThis.FormData=class{constructor(form){return Object.entries(form.elements).map(([key,control])=>[key,control.value]);}};
  globalThis.fetch=async(path,options={})=>{if(!options.method)return {ok:true,json:async()=>[]};if(!path.includes('/files')){creates++;return new Promise(done=>release=row=>done({ok:true,json:async()=>row}));}throw Error('가상 연결 끊김');};
  try{await mountCommonWork({target,base:'/api/common-work',siteId:1,api});assert.match(html,/type="file" multiple data-work-new-files/);const form=controls['[data-work-form]'];for(const [key,value] of Object.entries(input))form.elements[key].value=value;controls['[data-work-new-files]'].onchange();assert.match(controls['[data-new-files-list]'].textContent,/가상1.txt/);const first=form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});assert.equal(creates,1);release({id:17,version:'v1'});await first;assert.match(controls['[data-work-status]'].textContent,/업무 #17/);assert.equal(controls['[data-work-recover]'].hidden,false);await form.onsubmit({preventDefault(){}});assert.equal(creates,1);controls['[data-work-recover]'].onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(controls['[data-work-form]'].elements.title.value,input.title);assert.equal(controls['[data-work-form]'].querySelector().disabled,true);assert.match(controls['[data-work-status]'].textContent,/입력은 복사용으로 보존/);}finally{globalThis.FormData=originalFormData;globalThis.fetch=originalFetch;}
});

test('첨부 버전 응답이 없거나 이전 버전이면 게시를 중단한다',async()=>{for(const result of [{id:1},{id:1,version:'v1'}]){let published=0;const save=newWorkWithFiles({create:async()=>({id:1,version:'v1'}),upload:async()=>result,publish:async()=>{published++;}});await assert.rejects(save(input,[files[0]]),/첨부 저장 버전/);assert.equal(published,0);}});
for(const stage of ['create','upload','publish','recover','refresh'])test('DOM 대역 '+stage+' 401은 로그인 강제 이동 없이 입력과 복구 경로를 유지한다',async()=>{
  let controls,failed=false,apiWrites=0;const doc={},response=(ok,data)=>({ok,status:ok?200:401,json:async()=>data});
  const target={isConnected:true,set innerHTML(value){controls=Object.fromEntries(['work-status','work-cancel','work-recover','work-new-files','new-files-list','rich-toolbar','work-search','work-select-all','work-preview','work-print'].map(name=>['[data-'+name+']',{}]));const submit={};controls['[data-work-form]']={elements:Object.fromEntries(Object.keys(input).map(key=>[key,{value:'',querySelector:()=>({}),focus(){}}])),querySelector:()=>submit,reset(){}};controls['[data-rich-editor]']={ownerDocument:doc,childNodes:[],replaceChildren(){},querySelectorAll(){return [];}};controls['[data-work-new-files]'].files=[files[0]];},querySelector(selector){return controls[selector];},querySelectorAll(){return [];}};
  const api=async(path,options)=>{if(options){apiWrites++;throw Error('공통 API 로그인 이동 경로');}return [];};
  const oldForm=globalThis.FormData,oldFetch=globalThis.fetch;
  globalThis.FormData=class{constructor(form){return Object.entries(form.elements).map(([key,item])=>[key,item.value]);}};
  globalThis.fetch=async(path,options={})=>{const step=options.method==='PUT'?'publish':options.method==='POST'?(path.includes('/files')?'upload':'create'):'refresh';if(step===stage||stage==='recover'&&step==='upload'&&!failed){failed=true;return response(false,{error:'가상 세션 만료'});}if(stage==='recover'&&step==='refresh'&&failed)return response(false,{error:'가상 세션 만료'});return response(true,step==='create'?{id:1,version:'v1'}:step==='upload'?{id:1,version:'v2'}:step==='publish'?{id:1,version:'v3'}:[]);};
  try{await mountCommonWork({target,base:'/api/common-work',siteId:1,api});const form=controls['[data-work-form]'];for(const [key,value] of Object.entries(input))form.elements[key].value=value;await form.onsubmit({preventDefault(){}});assert.equal(apiWrites,0);assert.equal(controls['[data-work-form]'],form);assert.equal(form.elements.title.value,input.title);assert.equal(controls['[data-work-recover]'].hidden,false);assert.match(controls['[data-work-status]'].textContent,/다른 탭/);if(stage==='recover'){controls['[data-work-recover]'].onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(controls['[data-work-form]'],form);assert.match(controls['[data-work-status]'].textContent,/다른 탭/);assert.equal(controls['[data-work-recover]'].disabled,false);}}finally{globalThis.FormData=oldForm;globalThis.fetch=oldFetch;}
});

for(const stage of ['create','upload','publish','recover','refresh'])for(const pendingBody of [false,true])test('DOM 가상 시계 '+stage+(pendingBody?' 본문':' 요청')+' 정체는 30초 뒤 입력·복구를 보존하고 늦은 응답을 무시한다',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let controls,release,heldSignal,waiting=false,recovering=false;const writes=[],doc={};
  const target={isConnected:true,set innerHTML(value){
    controls=Object.fromEntries(['work-status','work-cancel','work-recover','work-new-files','new-files-list','rich-toolbar','work-search','work-select-all','work-preview','work-print'].map(name=>['[data-'+name+']',{}]));
    const submit={};controls['[data-work-form]']={elements:Object.fromEntries(Object.keys(input).map(key=>[key,{value:'',querySelector:()=>({}),focus(){}}])),querySelector:()=>submit,reset(){}};
    controls['[data-rich-editor]']={ownerDocument:doc,childNodes:[],replaceChildren(){},querySelectorAll(){return [];}};
    controls['[data-work-new-files]'].files=files;
  },querySelector(selector){return controls[selector];},querySelectorAll(){return Object.values(controls).filter(control=>!control.elements);}};
  const response=data=>({ok:true,status:200,json:async()=>data}),flush=()=>new Promise(done=>setImmediate(done));
  const oldForm=globalThis.FormData,oldFetch=globalThis.fetch;
  globalThis.FormData=class{constructor(form){return Object.entries(form.elements).map(([key,item])=>[key,item.value]);}};
  globalThis.fetch=async(path,options={})=>{
    const step=options.method==='PUT'?'publish':options.method==='POST'?(path.includes('/files')?'upload':'create'):recovering?'recover':'refresh';
    if(options.method)writes.push(step);
    if(stage==='recover'&&step==='upload')throw Error('가상 업로드 연결 끊김');
    const data=step==='create'?{id:1,version:'v1'}:step==='upload'?{version:'v'+writes.length}:step==='publish'?{version:'v4'}:[];
    if(step===stage&&!waiting){
      waiting=true;heldSignal=options.signal;
      const held=new Promise(done=>release=()=>done(pendingBody?data:response(data)));
      return pendingBody?{ok:true,status:200,json:()=>held}:held;
    }
    return response(data);
  };
  try{
    await mountCommonWork({target,base:'/api/common-work',siteId:1,api:async()=>[]});
    const form=controls['[data-work-form]'];for(const [key,value] of Object.entries(input))form.elements[key].value=value;
    let pending=form.onsubmit({preventDefault(){}});await flush();
    if(stage==='recover'){await pending;recovering=true;pending=controls['[data-work-recover]'].onclick();await flush();}
    assert.ok(waiting);assert.equal(heldSignal.aborted,false);t.mock.timers.tick(29999);await flush();assert.equal(heldSignal.aborted,false);
    t.mock.timers.tick(1);await pending;
    assert.equal(heldSignal.aborted,true);assert.equal(controls['[data-work-form]'],form);assert.equal(form.elements.title.value,input.title);
    assert.equal(controls['[data-work-new-files]'].files,files);assert.equal(controls['[data-work-recover]'].hidden,false);assert.equal(controls['[data-work-recover]'].disabled,false);
    assert.match(controls['[data-work-status]'].textContent,/30초.*확정할 수 없습니다/);
    const before=writes.slice();await form.onsubmit({preventDefault(){}});release();await flush();assert.deepEqual(writes,before);assert.equal(controls['[data-work-form]'],form);
    if(stage==='create')assert.deepEqual(writes,['create']);if(stage==='upload')assert.deepEqual(writes,['create','upload']);
    recovering=true;await controls['[data-work-recover]'].onclick();assert.notEqual(controls['[data-work-form]'],form);
    assert.equal(controls['[data-work-form]'].elements.title.value,input.title);assert.equal(controls['[data-work-form]'].querySelector().disabled,true);assert.match(controls['[data-work-status]'].textContent,/입력은 복사용으로 보존/);assert.deepEqual(writes,before);
  }finally{globalThis.FormData=oldForm;globalThis.fetch=oldFetch;t.mock.timers.reset();}
});
