import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function screen(){
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),line=source.split('\n').find(row=>row.includes("initialLoads.push(async()=>{try{if(!workerPanelActive())return;const response=await fetch('/api/worker/articles'"));assert.ok(line);
  const helper=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8'),functions=helper.slice(helper.indexOf('export function workerDocumentRequest'),helper.indexOf('export async function mountWorkerDocuments')).replaceAll('export ','');
  const element=()=>({textContent:'',children:[],isConnected:true,append(...items){this.children.push(...items);},remove(){this.isConnected=false;},click(){downloads.push(this.download);}}),target=element(),status=element(),requests=[],loads=[],downloads=[],dayStatus={textContent:''},context={archive:{isConnected:true,querySelector:selector=>selector==='[role=status]'?status:target},initialLoads:loads,reportContext:{workerId:1,siteId:2,generation:'old'},dayStatus,active:true,stopped:false,workerPanelActive:()=>context.active,stopWorkerDay:()=>{context.stopped=true;context.active=false;},fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),document:{createElement:element,body:element()},URL:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},setTimeout:()=>{},richBody:()=>''};
  context.siteArticleImageLimits=()=>({});
  runInNewContext(functions+'\n'+line,context);return {context,target,status,requests,downloads,run:loads[0]};
}

test('자료실은 열린 세션을 전송하고 다른 계정으로 바뀌면 표시와 다른 입력을 보호한다',async()=>{
  const ui=screen(),pending=ui.run(),request=ui.requests[0];assert.equal(request.url,'/api/worker/articles');assert.deepEqual(JSON.parse(request.options.headers['X-Worker-Report-Context']),{workerId:1,siteId:2,generation:'old'});request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'세션 변경'})});await pending;assert.equal(ui.context.stopped,true);assert.equal(ui.context.dayStatus.textContent,'세션 변경');assert.equal(ui.target.children.length,0);
});

test('자료실 첨부는 화면의 세션을 보내며 전환·닫기 뒤 다운로드하지 않는다',async()=>{
  for(const mode of ['success','session','closed']){const ui=screen(),loading=ui.run();ui.requests[0].resolve({ok:true,status:200,json:async()=>[{id:5,title:'가상 자료',files:[{id:8,name:'가상.txt',version:'virtual-version'}]}]});await loading;const button=ui.target.children[0].children[2],pending=button.onclick(),request=ui.requests[1];assert.equal(request.url,'/api/worker/articles/5/files/8?version=virtual-version');assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'old');if(mode==='closed')ui.context.active=false;if(mode==='session')request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'세션 변경'})});else request.resolve({ok:true,status:200,blob:async()=>new Blob(['가상'])});await pending;assert.deepEqual(ui.downloads,mode==='success'?['가상.txt']:[]);if(mode==='session'){assert.equal(ui.context.stopped,true);assert.equal(ui.context.dayStatus.textContent,'세션 변경');}}
});

test('자료실의 늦은 성공과 오류는 닫힌 화면을 바꾸지 않는다',async()=>{
  for(const fail of [false,true]){const ui=screen(),pending=ui.run(),request=ui.requests[0];ui.context.active=false;if(fail)request.reject(Error('오래된 오류'));else request.resolve({ok:true,status:200,json:async()=>[{title:'오래된 글',files:[]}]});await pending;assert.equal(ui.target.textContent,'불러오는 중입니다.');assert.equal(ui.target.children.length,0);}
  const ui=screen(),pending=ui.run();ui.requests[0].resolve({ok:true,status:200,json:async()=>[]});await pending;assert.equal(ui.target.textContent,'공개된 게시글이 없습니다.');
});
