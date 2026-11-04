import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf("    if(select.value!=='daily_report') return;"),end=app.indexOf('    for(const [key,label] of Object.entries(dailyRows)){',start);
assert.ok(start>=0&&end>start);

// shortcut: 입력과 조회 제어만 모사하므로 실제 화면 배치는 브라우저 시험이 필요하다.
function screen(){
  const pending=[],actor={id:1},state={siteId:1,page:'documents',admin:actor,types:{tbm:'TBM'}},select={value:'daily_report'},dialog={open:true},date={value:'2026-11-04'},previousButton={isConnected:true},sourcesButton={isConnected:true},submit={disabled:false},body={value:''},weather={value:''},error={textContent:''};
  const list={buttons:[],textContent:'',replaceChildren(){this.innerHTML='';},set innerHTML(value){this.html=value;this.buttons=[...value.matchAll(/data-source="(\d+)"/g)].map(([,index])=>({dataset:{source:index},disabled:false}));},get innerHTML(){return this.html||'';},querySelectorAll:()=>list.buttons};
  const form={listeners:new Set(),addEventListener(type,fn){assert.equal(type,'submit');this.listeners.add(fn);},removeEventListener(type,fn){this.listeners.delete(fn);},dispatch(){for(const fn of this.listeners)fn();}},container={insertAdjacentHTML(){}},nodes={'#daily-fields':container,'#dialog-form':form,'#dialog-form [name=date]':date,'#previous-report':previousButton,'#daily-sources':sourcesButton,'#daily-source-list':list,'#dialog-form button[type=submit]':submit,'#dialog-form textarea[name=body]':body,'#dialog-form [name="weather"]':weather,'#dialog-error':error},details={};
  const context={state,actor,siteId:1,page:'documents',select,dialog,details,dailyFields:{weather:'날씨'},dailyRows:{},detailEpoch:3,educationEpoch:3,dailyInvalidationCleanup:()=>{},statusLabels:{approved:'승인'},document:{querySelectorAll:()=>[]},readDailyRow:()=>({}),esc:v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),$:key=>{assert.ok(nodes[key],key);return nodes[key];},api:(url,options,current)=>new Promise((resolve,reject)=>pending.push({url,current,resolve,reject})),renderFields(){context.renders++;},renders:0};
  runInNewContext('globalThis.mount=()=>{'+app.slice(start,end)+'};',context);context.mount();return {pending,state,select,dialog,date,previousButton,sourcesButton,submit,body,weather,error,list,details,context,form};
}

test('이전 일보는 입력 중 작성한 값은 유지하고 빈 항목만 적용한다',async()=>{
  const ui=screen(),loading=ui.previousButton.onclick();assert.match(ui.pending[0].url,/siteId=1/);ui.weather.value='직접 입력';ui.body.value='직접 내용';ui.pending[0].resolve({date:'2026-11-03',details:JSON.stringify({weather:'가상 날씨'}),body:'이전 내용'});await loading;assert.equal(ui.details.weather,'직접 입력');assert.equal(ui.body.value,'직접 내용');assert.equal(ui.context.renders,1);
});

for(const mode of ['previous','sources'])for(const event of ['날짜 변경 후 복귀','현장 변경','계정 변경','문서 유형 변경','창 닫기','저장 중'])for(const failure of [false,true])test(`${mode}: ${event} 후 이전 ${failure?'오류':'결과'}를 적용하지 않는다`,async()=>{
  const ui=screen(),loading=(mode==='previous'?ui.previousButton:ui.sourcesButton).onclick(),request=ui.pending[0];
  if(event==='날짜 변경 후 복귀'){ui.date.value='2026-11-05';ui.date.oninput();ui.date.value='2026-11-04';ui.date.onchange();}else if(event==='현장 변경')ui.state.siteId=2;else if(event==='계정 변경')ui.state.admin={id:2};else if(event==='문서 유형 변경')ui.select.value='tbm';else if(event==='창 닫기')ui.dialog.open=false;else ui.submit.disabled=true;
  ui.error.textContent='보존';assert.equal(request.current(),false);if(failure)request.reject(Error('이전 오류'));else request.resolve(mode==='previous'?{date:'2026-11-03',details:'{"weather":"이전 날씨"}',body:'이전 내용'}:[{type:'tbm',title:'이전 교육',status:'approved'}]);await loading;assert.equal(ui.context.renders,0);assert.equal(ui.body.value,'');assert.equal(ui.list.innerHTML,'');assert.equal(ui.error.textContent,'보존');
});

test('당일 교육 재조회는 이전 버튼을 무효화하고 최신 응답만 표시한다',async()=>{
  const ui=screen(),first=ui.sourcesButton.onclick();ui.pending[0].resolve([{type:'tbm',title:'이전',body:'내용',status:'approved'}]);await first;const oldButton=ui.list.buttons[0],second=ui.sourcesButton.onclick();oldButton.onclick();assert.equal(ui.body.value,'');ui.pending[1].resolve([{type:'tbm',title:'<최신>',body:'내용',status:'approved'}]);await second;assert.match(ui.list.innerHTML,/&lt;최신&gt;/);ui.list.buttons[0].onclick();assert.equal(ui.body.value,'[TBM] <최신>\n내용');
});

test('이전 일보를 두 번 조회할 때 늦은 첫 응답은 새 결과를 덮지 않는다',async()=>{
  const ui=screen(),first=ui.previousButton.onclick(),second=ui.previousButton.onclick();ui.pending[1].resolve({date:'2026-11-03',details:'{"weather":"최신"}',body:''});await second;assert.equal(ui.details.weather,'최신');ui.pending[0].resolve({date:'2026-11-02',details:'{"weather":"이전"}',body:''});await first;assert.equal(ui.details.weather,'최신');assert.equal(ui.context.renders,1);
});

for(const mode of ['previous','sources'])test(`${mode}: 저장이 실패한 뒤 도착한 이전 조회도 적용하지 않는다`,async()=>{
  const ui=screen(),loading=(mode==='previous'?ui.previousButton:ui.sourcesButton).onclick(),request=ui.pending[0];ui.form.dispatch();ui.submit.disabled=true;ui.submit.disabled=false;ui.error.textContent='저장 실패';assert.equal(request.current(),false);request.resolve(mode==='previous'?{date:'2026-11-03',details:'{"weather":"이전"}',body:'이전 내용'}:[{type:'tbm',title:'이전 교육',status:'approved'}]);await loading;assert.equal(ui.context.renders,0);assert.equal(ui.body.value,'');assert.equal(ui.list.innerHTML,'');assert.equal(ui.error.textContent,'저장 실패');
});
