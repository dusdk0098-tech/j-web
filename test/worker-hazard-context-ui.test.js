import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('신고 목록은 계정 변경과 늦은 응답을 감지한다',async()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
  const line=source.split('\n').find(value=>value.includes('const loadHazards=async'));
  assert.ok(line);
  const requests=[],hazardList={textContent:'기존 목록',replaceChildren(){this.textContent='';},append(){}},dayStatus={textContent:''},context={hazardList,dayStatus,reportContext:{workerId:1,siteId:2,generation:'a'},active:true,reportActive(){return context.active;},stopWorkerDay(){context.active=false;},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  runInNewContext(line+';globalThis.loadHazards=loadHazards;',context);
  const old=context.loadHazards(),current=context.loadHazards();
  assert.equal(JSON.parse(requests[1].options.headers['X-Worker-Report-Context']).generation,'a');
  requests[1].resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'계정 변경'})});await current;
  assert.equal(context.active,false);assert.equal(dayStatus.textContent,'계정 변경');
  requests[0].resolve({ok:true,status:200,json:async()=>[]});await old;
  assert.equal(hazardList.textContent,'기존 목록');
  await context.loadHazards();assert.equal(requests.length,2);
});

test('신고 사진은 현재 목록에 연결된 동안 원래 세션 요청으로 불러온다',async()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8').split('\n').find(value=>value.includes('const loadHazards=async'));assert.ok(source);
  const node=()=>({children:[],isConnected:true,append(...nodes){this.children.push(...nodes);},replaceChildren(){for(const child of this.children)for(const nested of child.children)nested.isConnected=false;this.children=[];}}),hazardList=node(),loads=[],context={hazardList,hazardStatus:{textContent:''},dayStatus:{textContent:''},reportContext:{workerId:1},reportActive:()=>true,stopWorkerDay(){},document:{createElement:node},workerFileRequest(){},showWorkerImage:(image,request,path,active)=>{loads.push({image,request,path,active});return Promise.resolve();},fetch:async()=>({ok:true,json:async()=>[{id:12,title:'가상',body:'내용',status:'received',response:'',replies:[],has_photo:true}]})};
  runInNewContext(source+';globalThis.loadHazards=loadHazards;',context);await context.loadHazards();assert.equal(loads[0].path,'/api/worker/hazard-reports/12/photo');assert.equal(loads[0].request,context.workerFileRequest);assert.equal(loads[0].active(),true);await context.loadHazards();assert.equal(loads[0].active(),false);assert.equal(loads[1].active(),true);
});
