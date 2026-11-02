import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const reportContext={workerId:7,siteId:3,generation:'initial-screen'};

test('기존 로그인 복원은 위치 확인 이전 세션 문맥을 보내고 거절시 화면을 열지 않는다',async()=>{
  const start=source.indexOf('const restore=async location=>'),end=source.indexOf(';if(inviteInfo.locationRequired)',start);assert.ok(start>=0&&end>start);
  let calls=[],opened=0,adopted=0,success=false;const data={worker:{id:7,site_id:3},reportContext};
  const restore=runInNewContext(source.slice(start,end)+';restore',{data,inviteInfo:{id:3},siteKey:'virtual-site',token:'virtual-token',fetch:async(path,options)=>{calls.push({path,options});return {ok:success,json:async()=>success?{siteKey:'virtual-site'}:{error:'세션 변경'}};},adoptSiteAddress:()=>adopted++,showWorker:async(worker,context)=>{assert.equal(worker,data.worker);assert.equal(context,reportContext);opened++;},JSON,Error});
  await assert.rejects(restore({latitude:1}),/세션 변경/);assert.deepEqual(JSON.parse(calls[0].options.body).reportContext,reportContext);assert.equal(opened,0);assert.equal(adopted,0);
  success=true;await restore();assert.equal(opened,1);assert.equal(adopted,1);assert.deepEqual(JSON.parse(calls[1].options.body).reportContext,reportContext);
});

function photoScreen(){
  const start=source.indexOf("photos.querySelector('button').onclick=async event=>"),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);
  const button={},file={size:8,type:'image/png',name:'virtual.png'},input={files:[file],_value:'virtual.png',get value(){return this._value;},set value(value){this._value=value;if(value==='')this.files=[];}},status={},row={},item={id:1},instructionRows=new Map([[1,row]]),requests=[];
  const photos={querySelector:selector=>selector==='button'?button:selector==='input'?input:{value:'after'}};
  const context={photos,status,row,item,instructionRows,panel:{isConnected:true},logout:{disabled:false},dayStopped:false,siteKey:'site',workerSiteKey:'site',photoUrl:'/api/worker/instructions/1/photos',reportContext,loaded:0,success:false,
    fetch:async(path,options)=>{requests.push({path,options});await context.beforeResponse?.();return {ok:context.success,status:context.success?201:409,json:async()=>context.success?{id:1}:{error:'저장 거절',sessionChanged:context.sessionChanged!==false}};},
    endWorkerDay(text){context.panel.isConnected=false;context.dayStopped=true;status.textContent=text;},loadPhotos:async()=>context.loaded++,JSON,Error,encodeURIComponent};
  const active=source.split('\n').find(line=>line.includes('const instructionActive='));assert.ok(active);runInNewContext(active+'\n'+source.slice(start,end),context);
  return {context,button,file,input,status,requests,submit:()=>button.onclick({currentTarget:button})};
}

test('지시 사진 업로드는 최초 세션 헤더와 원본 파일을 보내고 세션 거절시 선택을 보존한다',async()=>{
  const ui=photoScreen();await ui.submit();assert.equal(ui.button.disabled,false);assert.equal(ui.input.value,'virtual.png');assert.equal(ui.context.loaded,0);assert.equal(ui.context.panel.isConnected,false);assert.match(ui.status.textContent,/다시 로그인/);assert.deepEqual(JSON.parse(ui.requests[0].options.headers['X-Worker-Report-Context']),reportContext);assert.equal(ui.requests[0].options.body,ui.file);
  const accepted=photoScreen();accepted.context.success=true;await accepted.submit();assert.equal(accepted.input.value,'');assert.equal(accepted.input.files.length,0);assert.equal(accepted.context.loaded,1);
});

test('지시 사진의 일반 저장 거절은 선택을 보존하고 현재 화면에서 오류를 안내한다',async()=>{
  const ui=photoScreen();ui.context.sessionChanged=false;await ui.submit();assert.equal(ui.context.panel.isConnected,true);assert.equal(ui.input.value,'virtual.png');assert.equal(ui.input.files[0],ui.file);assert.equal(ui.context.loaded,0);assert.match(ui.status.textContent,/저장 거절/);assert.equal(ui.button.disabled,false);
});

for(const state of ['logout','detach','site','row'])test('지시 사진 지연 응답은 '+state+' 변경 후 파일 선택과 화면을 바꾸지 않는다',async()=>{
  const ui=photoScreen();ui.context.success=true;ui.context.beforeResponse=async()=>{if(state==='logout')ui.context.logout.disabled=true;if(state==='detach')ui.context.panel.isConnected=false;if(state==='site')ui.context.siteKey='other';if(state==='row')ui.context.instructionRows.set(1,{});};
  await ui.submit();assert.equal(ui.requests.length,1);assert.equal(ui.context.loaded,0);assert.equal(ui.input.value,'virtual.png');assert.equal(ui.input.files[0],ui.file);assert.equal(ui.status.textContent,undefined);
  await ui.submit();assert.equal(ui.requests.length,1);
});
