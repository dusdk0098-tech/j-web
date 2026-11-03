import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function screen(){
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),line=source.split('\n').find(row=>row.includes("initialLoads.push(async()=>{try{if(!workerPanelActive())return;const response=await fetch('/api/worker/articles'"));assert.ok(line);
  const target={textContent:'',children:[],append(item){this.children.push(item);}},requests=[],loads=[],dayStatus={textContent:''},context={archive:{querySelector:()=>target},initialLoads:loads,reportContext:{workerId:1,siteId:2,generation:'old'},dayStatus,active:true,stopped:false,workerPanelActive:()=>context.active,stopWorkerDay:()=>{context.stopped=true;context.active=false;},fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),document:{createElement:()=>({append(){},set textContent(value){this.text=value;},set innerHTML(value){this.html=value;}})},richBody:()=>''};
  runInNewContext(line,context);return {context,target,requests,run:loads[0]};
}

test('자료실은 열린 세션을 전송하고 다른 계정으로 바뀌면 표시와 다른 입력을 보호한다',async()=>{
  const ui=screen(),pending=ui.run(),request=ui.requests[0];assert.equal(request.url,'/api/worker/articles');assert.deepEqual(JSON.parse(request.options.headers['X-Worker-Report-Context']),{workerId:1,siteId:2,generation:'old'});request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'세션 변경'})});await pending;assert.equal(ui.context.stopped,true);assert.equal(ui.context.dayStatus.textContent,'세션 변경');assert.equal(ui.target.children.length,0);
});

test('자료실의 늦은 성공과 오류는 닫힌 화면을 바꾸지 않는다',async()=>{
  for(const fail of [false,true]){const ui=screen(),pending=ui.run(),request=ui.requests[0];ui.context.active=false;if(fail)request.reject(Error('오래된 오류'));else request.resolve({ok:true,status:200,json:async()=>[{title:'오래된 글',files:[]}]});await pending;assert.equal(ui.target.textContent,'불러오는 중입니다.');assert.equal(ui.target.children.length,0);}
  const ui=screen(),pending=ui.run();ui.requests[0].resolve({ok:true,status:200,json:async()=>[]});await pending;assert.equal(ui.target.textContent,'공개된 게시글이 없습니다.');
});
