import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerPlanCopy} from '../public/plan-charts.js';

const node=tag=>({tag,children:[],isConnected:true,disabled:false,value:'',textContent:'',attributes:{},append(...items){for(const item of items)if(typeof item!=='string'){item.parent=this;this.children.push(item);}},setAttribute(key,value){this.attributes[key]=value;},remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}});
function setup(){
 globalThis.document={createElement:node};const row=node('p'),editor={children:[]},status={textContent:''},calls=[],updates=[];let enabled=true,release;const doc={id:1,site_id:7,edit_version:10},documents=[doc,{id:2,type:'work_plan',edit_version:5,date:'2026-11-01',title:'<가상>',details:JSON.stringify({heavyLoads:[{kind:'가상 중량'}]})}],reportContext={id:'가상'};
 mountWorkerPlanCopy({row,doc,documents,editor,status,reportContext,active:()=>enabled,send:(...args)=>{calls.push(args);return new Promise(resolve=>{release=resolve;});},updateList:async()=>updates.push(1)});const button=row.children[0];return {row,button,editor,status,calls,updates,open(){button.onclick();const panel=row.children[1];return {panel,select:panel?.children[1],apply:panel?.children[2]};},stop(){enabled=false;},resolve(){release({});}};
}
test('근로자 항목 복사는 편집 중 전송을 막고 본인 목록과 버전을 사용한다',async()=>{
 const ui=setup();ui.editor.children.push({});ui.button.onclick();assert.match(ui.status.textContent,/저장하거나 닫은/);assert.equal(ui.row.children.length,1);ui.editor.children=[];const {panel,select,apply}=ui.open();assert.match(panel.children[0].textContent,/서명/);assert.match(select.children[1].textContent,/<가상>/);select.value='0';ui.editor.children.push({});await apply.onclick();assert.equal(ui.calls.length,0);ui.editor.children=[];const pending=apply.onclick();assert.equal(apply.disabled,true);assert.equal(select.disabled,true);ui.button.onclick();assert.equal(ui.row.children.length,2);await apply.onclick();assert.equal(ui.calls.length,1);assert.deepEqual(ui.calls[0][2],{siteId:7,sourceId:2,sourceVersion:5,targetVersion:10,kind:'heavy',index:0,reportContext:{id:'가상'}});ui.resolve();await pending;assert.equal(ui.updates.length,1);assert.match(ui.status.textContent,/가져왔습니다/);
});
test('응답 대기 중 편집을 열면 입력을 유지하고 이탈한 화면은 갱신하지 않는다',async()=>{
 const ui=setup(),{select,apply}=ui.open();select.value='0';const pending=apply.onclick();ui.editor.children.push({value:'가상 입력'});ui.resolve();await pending;assert.equal(ui.editor.children[0].value,'가상 입력');assert.equal(ui.updates.length,0);assert.match(ui.status.textContent,/가져왔습니다/);
 const next=setup(),controls=next.open();controls.select.value='0';const delayed=controls.apply.onclick();next.stop();next.resolve();await delayed;assert.equal(next.updates.length,0);assert.equal(next.status.textContent,'');
});
