import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mountEducationDraftWorkers} from '../public/education-draft-workers.js';

test('문서 유형 변경은 이전 날짜 처리기를 제거한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('  const renderFields=()=>{'),end=source.indexOf("    if(select.value==='office'){",start);assert.ok(start>=0&&end>start);
  let calls=0;const date={onchange:()=>calls++},fields={},select={value:'education'},$=key=>key==='#dialog-form [name=date]'?date:fields;
  runInNewContext(source.slice(start,end)+'};renderFields();',{educationReference:null,select,$,dailyFields:{},details:{},Object});assert.equal(date.onchange,null);date.onchange?.();assert.equal(calls,0);
});

test('신규 교육은 출역 명단을 선택하고 날짜 변경 중 선택을 보존한다',async()=>{
  const enable={checked:false},panel={},load={},status={},list={items:[],querySelectorAll(){return this.items.filter(row=>row.checked);},set innerHTML(value){this.html=value;this.items=[...value.matchAll(/data-worker value="(\d+)" (checked)?/g)].map(match=>({value:match[1],checked:!!match[2]}));}},nodes={'[data-enable]':enable,'[data-panel]':panel,'[data-load]':load,'[data-status]':status,'[data-list]':list},host={isConnected:true,querySelector:key=>nodes[key]},dateInput={value:'2026-11-01',addEventListener(event,fn){this.change=fn;}},pending=[];
  const api=(url,options,scope)=>new Promise(resolve=>pending.push({url,scope,resolve}));let active=true;
  const read=mountEducationDraftWorkers(host,{dateInput,siteId:1,api,active:()=>active,esc:String});assert.equal(read(),undefined);
  enable.checked=true;enable.onchange();assert.throws(read,/목록/);pending[0].resolve([{id:1,name:'가상',company:'현재 소속',attendance_company:'출역 당시 소속',present:1},{id:2,name:'미출역',present:0}]);await new Promise(done=>setImmediate(done));assert.deepEqual(list.items.map(row=>row.value),['1']);assert.match(list.html,/출역 당시 소속/);assert.doesNotMatch(list.html,/현재 소속/);list.items[0].checked=true;assert.deepEqual(read(),[1]);
  dateInput.value='2026-11-02';dateInput.change();assert.throws(read,/목록/);dateInput.value='2026-11-03';dateInput.change();pending[1].resolve([{id:9,name:'오래된',present:1}]);pending[2].resolve([{id:3,name:'새 출역',company:'가상',present:1}]);await new Promise(done=>setImmediate(done));assert.deepEqual(list.items.map(row=>row.value),['3','1']);assert.match(list.html,/이전 날짜 선택/);assert.deepEqual(read(),[1]);
  dateInput.value='2026-11-04';dateInput.change();active=false;pending[3].resolve([{id:4,name:'늦은 응답',present:1}]);await new Promise(done=>setImmediate(done));assert.doesNotMatch(list.html,/늦은 응답/);assert.throws(read,/목록/);
});
