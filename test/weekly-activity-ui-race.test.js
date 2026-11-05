import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {weeklyActivitySummaryMarkup} from '../public/weekly-ppe.js';

function setup(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf('let weeklyGeneration=0;'),to=source.indexOf(';wireDocLinks();',from);assert.ok(from>=0&&to>from);
  const input={value:'2026-10-25',isConnected:true},docButton={dataset:{weeklyDoc:'42'}},target={innerHTML:'',replaceChildren(){this.innerHTML='';},querySelectorAll(){return [docButton];}},button={},state={siteId:1,page:'statistics',types:{}},pending=[],errors=[],renders=[];
  const api=path=>path.startsWith('/api/weekly-activity')?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve([]);
  const context={state,detailEpoch:1,statsEpoch:1,api,URLSearchParams,encodeURIComponent,weeklyPpeMarkup:()=>'',weeklyActivitySummaryMarkup,esc:value=>String(value),statusLabels:{},showError:error=>errors.push(error.message),render:async()=>renders.push(state.detail),$:selector=>({'#weekly-start':input,'#weekly-result':target,'#weekly-load':button}[selector])};
  runInNewContext(source.slice(from,to),context);
  const rows=attendance=>[{date:'2026-10-25',attendance,attendanceCategories:[],attendanceOccupations:[],documents:{},noticeReads:0,trainingByType:{tbm:0,education:0},workerChecks:0,managerChecks:0,hazardReports:0,ppeIssues:[],ppeReceipts:{confirmed:0,total:0},checklists:[]}];
  return {input,target,button,docButton,state,pending,errors,rows,context,renders};
}

test('같은 기간의 주간 조회는 마지막 응답만 표시한다',async()=>{
  const {button,target,pending,rows}=setup(),old=button.onclick(),latest=button.onclick();
  pending[1].resolve(rows(22));await latest;pending[0].resolve(rows(11));await old;
  assert.match(target.innerHTML,/<td>22<\/td>/);assert.match(target.innerHTML,/주간 가상 활동 합계/);assert.doesNotMatch(target.innerHTML,/<td>11<\/td>/);
});

test('기간이나 화면이 바뀐 뒤 도착한 결과와 오류는 무시한다',async()=>{
  const {button,input,target,pending,errors,rows,context}=setup(),old=button.onclick();
  input.value='2026-11-01';input.onchange();input.value='2026-10-25';input.onchange();pending[0].resolve(rows(11));await old;assert.equal(target.innerHTML,'');
  const failure=button.onclick();context.detailEpoch++;pending[1].reject(Error('이전 조회 오류'));await failure;assert.deepEqual(errors,[]);
});

test('이전 주간 결과의 문서 버튼은 현장·날짜·조회·화면 변경 뒤 열리지 않는다',async()=>{
  for(const change of [s=>s.state.siteId=2,s=>{s.input.value='2026-11-01';s.input.onchange();},s=>s.button.onclick(),s=>s.context.detailEpoch++]){
    const s=setup(),load=s.button.onclick();s.pending[0].resolve(s.rows(1));await load;
    change(s);s.docButton.onclick();assert.equal(s.state.detail,undefined);assert.deepEqual(s.renders,[]);
  }
  const s=setup(),load=s.button.onclick();s.pending[0].resolve(s.rows(1));await load;s.docButton.onclick();assert.equal(s.state.detail,42);assert.deepEqual(s.renders,[42]);
});
