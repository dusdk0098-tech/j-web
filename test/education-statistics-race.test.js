import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fragment(from,to){const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}

test('통계 문서 목록 조회 중 현장이 바뀌면 이전 결과를 그리지 않는다',async()=>{
  const wait=deferred(),state={page:'statistics',siteId:1},context={state,detailEpoch:1,loadDocuments:()=>wait.promise},code=fragment('  const docsRequest=detailEpoch',"  if(state.page==='office-documents')");
  const pending=runInNewContext('(async()=>{'+code+';return docs;})()',context);state.siteId=2;context.detailEpoch++;wait.resolve([{type:'notice'}]);assert.equal(await pending,undefined);
});

test('교육 통계 조회 중 기간이나 현장이 바뀌면 이전 결과를 그리지 않는다',async()=>{
  const waits=[deferred(),deferred()],requests=[...waits],state={page:'statistics',siteId:1,statisticsMonth:'2026-10',statisticsDay:'',types:{}},context={state,detailEpoch:1,docs:[],today:()=>'',api:()=>waits.shift().promise},code=fragment('    const month=state.statisticsMonth||today().slice(0,7),day=state.statisticsDay,siteId=', '    content.innerHTML=`<section class="panel"><div class="panel-head"><div><h2>안전 활동 통계');
  const pending=runInNewContext('(async()=>{'+code+';return education;})()',context);state.statisticsMonth='2026-11';context.detailEpoch++;requests.forEach(wait=>wait.resolve([]));assert.equal(await pending,undefined);
});

test('현재 통계는 조회한 현장의 결과를 사용한다',async()=>{
  const state={page:'statistics',siteId:7,statisticsMonth:'2026-10',statisticsDay:'',types:{}},calls=[],context={state,detailEpoch:1,docs:[],today:()=>'',api:async path=>{calls.push(path);return path.includes('education/report')?[{id:3}]:[];}},code=fragment('    const month=state.statisticsMonth||today().slice(0,7),day=state.statisticsDay,siteId=', '    content.innerHTML=`<section class="panel"><div class="panel-head"><div><h2>안전 활동 통계');
  const rows=await runInNewContext('(async()=>{'+code+';return education;})()',context);assert.equal(rows[0].id,3);assert.ok(calls.every(path=>path.includes('siteId=7')));
});

test('오래된 교육 통계의 안전활동 버튼은 다른 현장을 열지 않는다',()=>{
  const start=source.indexOf("panel.querySelectorAll('[data-education-activity]')"),end=source.indexOf('});}const weekStart',start);assert.ok(start>=0&&end>start);const button={dataset:{educationActivity:'0'}},panel={isConnected:true,querySelectorAll:()=>[button]},state={page:'statistics',siteId:7,statisticsMonth:'2026-10',statisticsDay:''},education=[{id:5}],opened=[];
  const context={panel,state,education,siteId:7,month:'2026-10',day:'',detailEpoch:2,statsEpoch:2,today:()=>'',showWorkerActivities:async worker=>opened.push(worker.id),showError:error=>{throw error;}};runInNewContext(source.slice(start,end+3),context);button.onclick();assert.deepEqual(opened,[5]);state.siteId=8;button.onclick();state.siteId=7;context.detailEpoch++;button.onclick();assert.deepEqual(opened,[5]);
});
