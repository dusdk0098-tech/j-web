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

test('지시 사진 업로드는 최초 세션 헤더와 원본 파일을 보내고 세션 거절시 선택을 보존한다',async()=>{
  const start=source.indexOf("photos.querySelector('button').onclick=async event=>"),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);
  const button={},file={size:8,type:'image/png',name:'virtual.png'},input={files:[file],value:'virtual.png'},status={};let request,loaded=0,success=false;
  const photos={querySelector:selector=>selector==='button'?button:selector==='input'?input:{value:'after'}};
  runInNewContext(source.slice(start,end),{photos,status,photoUrl:'/api/worker/instructions/1/photos',reportContext,fetch:async(path,options)=>{request={path,options};return {ok:success,json:async()=>success?{id:1}:{error:'세션 변경'}};},loadPhotos:async()=>loaded++,JSON,Error,encodeURIComponent});
  await button.onclick({currentTarget:button});assert.equal(button.disabled,false);assert.equal(input.value,'virtual.png');assert.equal(loaded,0);assert.match(status.textContent,/세션 변경/);assert.deepEqual(JSON.parse(request.options.headers['X-Worker-Report-Context']),reportContext);assert.equal(request.options.body,file);
  success=true;await button.onclick({currentTarget:button});assert.equal(input.value,'');assert.equal(loaded,1);
});
