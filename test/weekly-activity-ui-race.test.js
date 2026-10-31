import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function setup(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf('let weeklyGeneration=0;'),to=source.indexOf(';wireDocLinks();',from);assert.ok(from>=0&&to>from);
  const input={value:'2026-10-25',isConnected:true},target={innerHTML:'',replaceChildren(){this.innerHTML='';},querySelectorAll(){return [];}},button={},state={siteId:1,page:'statistics',types:{}},pending=[],errors=[];
  const api=path=>path.startsWith('/api/weekly-activity')?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve([]);
  const context={state,detailEpoch:1,statsEpoch:1,api,URLSearchParams,encodeURIComponent,weeklyPpeMarkup:()=>'',esc:value=>String(value),statusLabels:{},showError:error=>errors.push(error.message),$:selector=>({'#weekly-start':input,'#weekly-result':target,'#weekly-load':button}[selector])};
  runInNewContext(source.slice(from,to),context);
  const rows=attendance=>[{date:'2026-10-25',attendance,attendanceCategories:[],attendanceOccupations:[],documents:{},noticeReads:0,trainingByType:{tbm:0,education:0},workerChecks:0,managerChecks:0,hazardReports:0,ppeIssues:[],ppeReceipts:{confirmed:0,total:0},checklists:[]}];
  return {input,target,button,state,pending,errors,rows,context};
}

test('같은 기간의 주간 조회는 마지막 응답만 표시한다',async()=>{
  const {button,target,pending,rows}=setup(),old=button.onclick(),latest=button.onclick();
  pending[1].resolve(rows(22));await latest;pending[0].resolve(rows(11));await old;
  assert.match(target.innerHTML,/<td>22<\/td>/);assert.doesNotMatch(target.innerHTML,/<td>11<\/td>/);
});

test('기간이나 화면이 바뀐 뒤 도착한 결과와 오류는 무시한다',async()=>{
  const {button,input,target,pending,errors,rows,context}=setup(),old=button.onclick();
  input.value='2026-11-01';input.onchange();input.value='2026-10-25';input.onchange();pending[0].resolve(rows(11));await old;assert.equal(target.innerHTML,'');
  const failure=button.onclick();context.detailEpoch++;pending[1].reject(Error('이전 조회 오류'));await failure;assert.deepEqual(errors,[]);
});
