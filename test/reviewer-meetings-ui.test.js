import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReviewerMeetings} from '../public/reviewer-meetings.js';

test('직원 회의의 늦은 응답은 화면 이탈 후 표시하지 않는다',async()=>{
  for(const stage of ['list','detail']){
    const elements=new Map(),node=()=>({innerHTML:'',textContent:'',isConnected:true,querySelector:selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll:selector=>selector==='[data-open]'?[button]:[]}),button={dataset:{open:'5'}},target=node();let active=true,resolve;const pending=new Promise(done=>resolve=done),api=path=>path==='/api/reviewer/meetings'?(stage==='list'?pending:Promise.resolve([{id:5,title:'가상 회의',date:'2026-11-05'}])):pending;
    const mounting=mountReviewerMeetings({target,api,active:()=>active});if(stage==='list'){active=false;target.isConnected=false;resolve([{id:5,title:'이전 회의'}]);await mounting;assert.equal(elements.get('[data-list]').innerHTML,'');}else{await mounting;const opening=button.onclick();active=false;target.isConnected=false;resolve({document:{id:5,title:'이전 회의',details:'{}'},attachments:[]});await opening;assert.equal(elements.get('[data-detail]').innerHTML,'');}
  }
});

test('직원 회의 서명은 중복 요청을 막고 실패 후 입력을 보존한다',async()=>{
  const elements=new Map(),node=()=>({innerHTML:'',textContent:'',isConnected:true,disabled:false,querySelector:selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll:selector=>selector==='[data-open]'?[open]:[]}),open={dataset:{open:'5'}},target=node(),requests=[];let finish;
  const api=async(path,options)=>{if(path==='/api/reviewer/meetings')return [{id:5,title:'가상 회의',date:'2026-11-05'}];if(!options)return {document:{id:5,title:'<가상 회의>',details:'{}',edit_version:7},attachments:[]};requests.push(JSON.parse(options.body));return new Promise((resolve,reject)=>finish={resolve,reject});};
  await mountReviewerMeetings({target,api,pad:()=>()=> '가상 서명',active:()=>true});await open.onclick();assert.match(elements.get('[data-detail]').innerHTML,/&lt;가상 회의&gt;/);const confirm=elements.get('[data-confirm]'),feedback=elements.get('[data-confirm-status]');
  let saving=confirm.onclick();await confirm.onclick();assert.deepEqual(requests,[{expectedEditVersion:7,signature:'가상 서명'}]);finish.reject(Error('가상 오류'));await saving;assert.equal(feedback.textContent,'가상 오류');assert.equal(confirm.disabled,false);saving=confirm.onclick();finish.resolve({ok:true});await saving;assert.equal(confirm.disabled,true);assert.match(feedback.textContent,/저장/);
});

test('회의 첨부는 표시된 버전으로 요청하고 화면 이탈 후 내려받지 않는다',async()=>{
  const elements=new Map(),open={dataset:{open:'5'}},file={dataset:{file:'0'},disabled:false,isConnected:true},node=()=>({innerHTML:'',textContent:'',isConnected:true,querySelector:selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll:selector=>selector==='[data-open]'?[open]:selector==='[data-file]'?[file]:[]}),target=node();let active=true,finish,requests=0,clicked=0;
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalTimeout=globalThis.setTimeout;
  try{
    globalThis.fetch=path=>{requests++;assert.equal(path,'/api/reviewer/meetings/5/attachments/3?version=7');return new Promise(resolve=>finish=resolve);};
    globalThis.document={createElement:()=>({click:()=>clicked++,remove:()=>{}}),body:{append:()=>{}}};URL.createObjectURL=()=> 'blob:가상';URL.revokeObjectURL=()=>{};globalThis.setTimeout=()=>0;
    const api=async path=>path==='/api/reviewer/meetings'?[{id:5,title:'가상 회의'}]:{document:{id:5,title:'가상 회의',details:'{}',edit_version:7,confirmed_at:'가상'},attachments:[{id:3,name:'가상.txt'}]};
    await mountReviewerMeetings({target,api,active:()=>active});await open.onclick();let downloading=file.onclick();await file.onclick();assert.equal(requests,1);finish({ok:true,blob:async()=>new Blob(['가상'])});await downloading;assert.equal(clicked,1);
    downloading=file.onclick();active=false;finish({ok:true,blob:async()=>new Blob(['가상'])});await downloading;assert.equal(clicked,1);
  }finally{globalThis.fetch=originalFetch;globalThis.document=originalDocument;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;globalThis.setTimeout=originalTimeout;}
});
