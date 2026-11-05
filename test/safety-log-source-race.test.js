import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mergeSafetyLogSources} from '../public/safety-log-sources.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf("    if(select.value==='safety_log'){");
const end=source.indexOf("    if(select.value==='patrol'){",start);
assert.ok(start>=0&&end>start);
const fields={weather:'날씨',todayWork:'금일',tomorrowWork:'명일',notices:'공지',training:'교육',inspection:'점검',notes:'특기'};
// shortcut: 자료 적용에 필요한 DOM만 모사하며 실제 브라우저 배치는 별도 확인이 필요하다.
function screen(){
 const pending=[],nodes=new Map(),actor={},state={siteId:1,page:'documents',admin:actor,types:{notice:'공지'}},dialog={open:true};
 const element=tag=>({tag,isConnected:true,value:'',textContent:'',dataset:{},children:[],append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},querySelectorAll(){return this.children.flatMap(label=>label.children||[]).filter(child=>child.dataset?.safetySource);}});
 const document={createElement:element,createTextNode:text=>({text})};
 const context={state,actor,siteId:1,page:'documents',detailEpoch:1,educationEpoch:1,dialog,document,details:{},select:{value:'safety_log'},safetyLogFields:fields,statusLabels:{draft:'작성중'},mergeSafetyLogSources,esc:String,$:key=>{assert.ok(nodes.has(key),key);return nodes.get(key);},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))};
 for(const key of ['#daily-fields','#dialog-form [name=date]','#safety-source-selection','#safety-source-status','#dialog-form','#dialog-form button[type=submit]','#safety-sources',...Object.keys(fields).map(key=>`#dialog-form [name=safety_${key}]`)])nodes.set(key,element('div'));
 const form=nodes.get('#dialog-form'),date=nodes.get('#dialog-form [name=date]'),selection=nodes.get('#safety-source-selection'),status=nodes.get('#safety-source-status'),submit=nodes.get('#dialog-form button[type=submit]');form.onsubmit=()=>{};date.value='2026-11-01';
 runInNewContext('globalThis.mount=()=>{'+source.slice(start,end)+'};mount()',context);
 const load=()=>nodes.get('#safety-sources').onclick(),notice=()=>selection.children.find(label=>label.children?.some(child=>child.dataset?.safetySource==='notice'))?.children.find(child=>child.dataset?.safetySource==='notice'),apply=()=>selection.children.find(child=>child.tag==='button'),target=nodes.get('#dialog-form [name=safety_notices]');
 return {pending,state,dialog,context,date,selection,status,submit,form,load,notice,apply,target};
}
const result=text=>({present:1,documents:[{id:7,type:'notice',title:'가상 자료',status:'draft',body:text}]});

test('선택한 자료는 빈 항목에만 적용하고 저장 중에는 적용하지 않는다',async()=>{
 const ui=screen(),loading=ui.load();ui.pending[0].resolve(result('가상 공지'));await loading;ui.notice().value='7';ui.submit.disabled=true;ui.apply().onclick();assert.equal(ui.target.value,'');assert.match(ui.status.textContent,/저장이 끝난 뒤/);ui.submit.disabled=false;ui.apply().onclick();assert.equal(ui.target.value,'가상 공지');ui.target.value='직접 입력';ui.apply().onclick();assert.equal(ui.target.value,'직접 입력');
});
for(const change of ['date','date-return','site','page','actor','epoch','type','dialog','handler','removed'])for(const outcome of ['success','error'])test(`${change} 변경 후 이전 ${outcome} 결과를 무시한다`,async()=>{
 const ui=screen(),loading=ui.load();
 if(change==='date'||change==='date-return'){ui.date.value='2026-11-02';ui.date.oninput();if(change==='date-return'){ui.date.value='2026-11-01';ui.date.oninput();}}
 if(change==='site')ui.state.siteId=2;if(change==='page')ui.state.page='workers';if(change==='actor')ui.state.admin={};if(change==='epoch')ui.context.detailEpoch++;if(change==='type')ui.context.select.value='patrol';if(change==='dialog')ui.dialog.open=false;if(change==='handler')ui.form.onsubmit=()=>{};if(change==='removed')ui.selection.isConnected=false;
 ui.status.textContent='유지';if(outcome==='success')ui.pending[0].resolve(result('이전 자료'));else ui.pending[0].reject(Error('이전 오류'));await loading;assert.equal(ui.status.textContent,'유지');assert.equal(ui.selection.children.length,0);assert.equal(ui.target.value,'');
});
test('재조회와 날짜 변경은 이전 적용 버튼을 무효화한다',async()=>{
 const ui=screen(),first=ui.load();ui.pending[0].resolve(result('이전 자료'));await first;ui.notice().value='7';const old=ui.apply();const second=ui.load();assert.equal(ui.selection.children.length,0);old.onclick();assert.equal(ui.target.value,'');ui.pending[1].resolve(result('새 자료'));await second;ui.notice().value='7';const latest=ui.apply();ui.date.value='2026-11-02';ui.date.onchange();latest.onclick();assert.equal(ui.target.value,'');assert.equal(ui.selection.children.length,0);
});
