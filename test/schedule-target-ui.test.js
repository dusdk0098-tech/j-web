import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {scheduleTypes,personalScheduleTypes,scheduleTargetRequired,scheduleTimeOptions} from '../public/schedule.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
// shortcut: 실제 폼 함수를 가상 DOM에서 실행하며 화면 배치와 브라우저 기본 유효성 표시는 별도 브라우저 검증이 필요하다.
function screen(row=null,{fail=false,people=[{id:1,name:'가상 직원',login_id:'virtual',site_id:7,active:1}]}={}){
  const nodes=new Map(),controls=new Map(),writes=[];
  const node=()=>({textContent:'',disabled:false});
  for(const id of ['dialog-title','dialog-error','dialog-form','dialog-form button[type=submit]','schedule-target-help'])nodes.set('#'+id,node());
  const body=node();nodes.set('#dialog-body',body);
  Object.defineProperty(body,'innerHTML',{set(html){this.html=html;for(const [,tag,attrs,content=''] of html.matchAll(/<(input|select)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){const name=attrs.match(/name="([^"]+)"/)?.[1];if(!name)continue;const options=[...content.matchAll(/<option([^>]*)>(.*?)<\/option>/g)].map(([,a,t])=>({value:a.match(/value="([^"]*)"/)?.[1]??t,selected:/selected/.test(a)}));controls.set(name,{value:tag==='select'?(options.find(o=>o.selected)||options[0])?.value||'':attrs.match(/value="([^"]*)"/)?.[1]||'',required:/required/.test(attrs)});}}});
  const find=selector=>selector.includes('[name=')?controls.get(selector.match(/\[name=([^\]]+)/)[1]):nodes.get(selector);
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const context={scheduleTypes,personalScheduleTypes,scheduleTargetRequired,scheduleTimeOptions,siteId:7,people,dialog,$:find,today:()=> '2026-11-02',esc:String,field:(name,label,value)=>`<input name="${name}" value="${value}">`,FormData:class{*[Symbol.iterator](){for(const [name,c]of controls)yield [name,c.value];}},api:async(path,options)=>{writes.push({path,...options});if(fail)throw Error('가상 서버 거절');},flash(){},render:async()=>{}};
  const time=source.split('\n').find(line=>line.includes('const timeField=')&&line.includes('scheduleTimeOptions(value)'));
  runInNewContext(source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close')"))+'\n'+time+'\n'+source.slice(source.indexOf('const edit=(row,day=today())=>'),source.indexOf("    $('#schedule-add').onclick"))+'\nglobalThis.edit=edit;',context);
  context.edit(row);
  return {nodes,controls,writes,dialog,html:()=>body.html,help:()=>nodes.get('#schedule-target-help').textContent,error:()=>nodes.get('#dialog-error').textContent,kind(value){controls.get('kind').value=value;controls.get('kind').onchange();},save:()=>nodes.get('#dialog-form').onsubmit({preventDefault(){},currentTarget:nodes.get('#dialog-form')})};
}
const existing=(kind='휴가',target_id=null)=>({id:3,kind,target_id,target_name:target_id?'기존 직원':'',content:'보존할 내용',start_date:'2026-11-02',end_date:'2026-11-02'});
test('신규 개인 10종은 대상 필수 안내·검증과 입력 보존 후 선택 저장',async()=>{
 for(const kind of personalScheduleTypes){const ui=screen();ui.kind(kind);ui.controls.get('content').value='보존할 입력';assert.equal(ui.controls.get('targetId').required,true);assert.match(ui.help(),/어느 직원도/);await ui.save();assert.equal(ui.writes.length,0);assert.equal(ui.dialog.open,true);assert.equal(ui.controls.get('content').value,'보존할 입력');assert.equal(ui.error(),'개인 일정의 대상자를 선택해 주세요.');ui.controls.get('targetId').value='1';await ui.save();assert.equal(JSON.parse(ui.writes[0].body).targetId,1);assert.equal(ui.dialog.open,false);}
});
test('종류 변경으로 공통 4종은 미지정 저장을 허용한다',async()=>{
 for(const kind of scheduleTypes.filter(x=>!personalScheduleTypes.includes(x))){const ui=screen();ui.kind('휴가');ui.kind(kind);assert.equal(ui.controls.get('targetId').required,false);assert.match(ui.help(),/공통 일정/);await ui.save();assert.equal(JSON.parse(ui.writes[0].body).targetId,0);}
});
test('기존 무대상 개인은 개인 종류를 바꿔도 수정되며 공통에서 개인으로 전환은 차단',async()=>{
 const ui=screen(existing());ui.kind('교육');assert.equal(ui.controls.get('targetId').required,false);assert.match(ui.help(),/기존 무대상/);await ui.save();assert.equal(ui.writes[0].method,'PUT');assert.equal(JSON.parse(ui.writes[0].body).targetId,0);
 const common=screen(existing('회의'));common.kind('휴가');await common.save();assert.equal(common.writes.length,0);
});
test('기존 대상의 개인 일정 명시 해제는 차단하고 공통으로 전환하면 허용',async()=>{
 const ui=screen(existing('휴가',1));ui.controls.get('targetId').value='';await ui.save();assert.equal(ui.writes.length,0);ui.kind('회의');await ui.save();assert.equal(JSON.parse(ui.writes[0].body).targetId,0);
});
test('비활성 기존 대상 보존과 다른 현장·비활성 신규 선택 제외',async()=>{
 const ui=screen(existing('휴가',2),{people:[{id:2,name:'중지 직원',site_id:7,active:0},{id:3,name:'다른 현장',site_id:8,active:1},{id:4,name:'새 중지',site_id:7,active:0}]});assert.match(ui.html(),/기존 직원 · 비활성/);assert.doesNotMatch(ui.html(),/다른 현장|새 중지/);await ui.save();assert.equal(JSON.parse(ui.writes[0].body).targetId,2);
});
test('서버 거절은 오류를 표시하고 대상·내용·종류와 열린 폼을 보존',async()=>{
 const ui=screen(existing('휴가',1),{fail:true});ui.controls.get('content').value='서버 실패 입력';await ui.save();assert.equal(ui.error(),'가상 서버 거절');assert.equal(ui.dialog.open,true);assert.equal(ui.controls.get('targetId').value,'1');assert.equal(ui.controls.get('content').value,'서버 실패 입력');assert.equal(ui.controls.get('kind').value,'휴가');assert.equal(ui.nodes.get('#dialog-form button[type=submit]').disabled,false);
});
test('장비 점검 결재 선택 화면은 일정의 siteId 변수 없이 열린다',async()=>{
 const button={dataset:{checkRequest:'5'}},errors=[];let html='';
 const line=source.split('\n').find(line=>line.includes("content.querySelectorAll('[data-check-request]')"));
 runInNewContext(line,{content:{querySelectorAll:()=>[button]},equipmentChecks:[{id:5}],doc:{id:9,site_id:7},state:{detail:9},esc:String,api:async()=>[{id:1,name:'활성 결재자',login_id:'virtual',active:1},{id:2,name:'중지 결재자',active:0}],showDialog:(title,body)=>{html=body;},showError:error=>errors.push(error)});
 await button.onclick();assert.equal(errors.length,0);assert.match(html,/활성 결재자/);assert.doesNotMatch(html,/중지 결재자/);assert.equal((html.match(/<select/g)||[]).length,4);
});
