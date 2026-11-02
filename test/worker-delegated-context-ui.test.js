import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),lines=source.split('\n');
const permission=lines.find(line=>line.includes("fetch('/api/worker/permissions'")),managed=lines.find(line=>line.includes('const loadManaged=async()=>'));
assert.ok(permission&&managed);

test('권한 조회는 최초 계정을 전송하고 변경된 계정의 권한을 적용하지 않는다',async()=>{
  let request;const dayStatus={textContent:''},context={dayStatus,reportContext:{workerId:1,generation:'old'},active:true,workerPanelActive(){return context.active;},stopWorkerDay(){context.active=false;},fetch:(url,options)=>new Promise(resolve=>request={url,options,resolve})};
  const work=runInNewContext('(async()=>{'+permission+';return permissions;})()',context);assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'old');request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'계정 변경'})});assert.equal(await work,undefined);assert.equal(context.active,false);assert.equal(dayStatus.textContent,'계정 변경');
});

test('위임 출역 조회의 계정 변경은 명단과 다른 늦은 응답을 반영하지 않는다',async()=>{
  const requests=[],dayStatus={textContent:''},list={textContent:'기존 명단',replaceChildren(){this.textContent='';},append(){}},context={dayStatus,list,date:{value:'2026-11-01'},managedGeneration:0,reportContext:{workerId:1,generation:'old'},active:true,workerPanelActive(){return context.active;},stopWorkerDay(){context.active=false;},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  runInNewContext(managed+';globalThis.loadManaged=loadManaged;',context);const old=context.loadManaged(),current=context.loadManaged();assert.equal(JSON.parse(requests[1].options.headers['X-Worker-Report-Context']).generation,'old');requests[1].resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'계정 변경'})});await current;
  requests[0].resolve({ok:true,status:200,json:async()=>[]});await old;assert.equal(dayStatus.textContent,'계정 변경');assert.equal(list.textContent,'기존 명단');await context.loadManaged();assert.equal(requests.length,2);
});
