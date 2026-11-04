import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const from=source.indexOf('    let photoEpoch=0;document.querySelectorAll(\'[data-cost-photos]\')');
const to=source.indexOf("    $('#new-cost').onclick",from);
assert.ok(from>=0&&to>from);

function screen(){
  const state={page:'safety-costs',siteId:1,costMonth:'2026-11',admin:{}},buttons=[1,2].map(id=>({dataset:{costPhotos:String(id)},isConnected:true}));
  const add={},remove={dataset:{deleteCostPhoto:'7'}},file={files:[{name:'가상.png',size:50}]},kind={value:'photo'},controls=[add,remove,file,kind];
  const panel={isConnected:true,innerHTML:'',querySelector:s=>({'#cost-photo-add':add,'#cost-photo-file':file,'#cost-photo-kind':kind})[s],querySelectorAll:s=>s==='button,input,select'?controls:s==='[data-delete-cost-photo]'?[remove]:[]};
  const calls=[],errors=[];let resolveAction,rejectAction;
  const context={state,detailEpoch:1,epoch:1,siteId:1,month:'2026-11',data:{rows:[{id:1,description:'첫 내역'},{id:2,description:'다른 내역'}]},today:()=> '2026-11-01',encodeURIComponent,Array,document:{querySelectorAll:()=>buttons},$:()=>panel,esc:x=>x,confirm:()=>true,showError:e=>errors.push(e.message),api:(path,options)=>{calls.push({path,options});if(options?.method)return new Promise((resolve,reject)=>{resolveAction=resolve;rejectAction=reject;});return Promise.resolve([{id:7,name:'가상.png',version:'v1'}]);},fetch:(path,options)=>{calls.push({path,options});return new Promise((resolve,reject)=>{resolveAction=()=>resolve({ok:true,json:async()=>({})});rejectAction=reject;});}};
  runInNewContext(source.slice(from,to),context);
  return {state,buttons,add,remove,controls,calls,errors,resolve:()=>resolveAction(),reject:()=>rejectAction(Error('지연 오류'))};
}

test('사진 첨부 중 중복 클릭은 한 번만 전송하고 완료 후 목록을 갱신한다',async()=>{
  const ui=screen();await ui.buttons[0].onclick();const pending=ui.add.onclick();await ui.add.onclick();assert.equal(ui.calls.length,2);assert.ok(ui.controls.every(c=>c.disabled));ui.resolve();await pending;assert.equal(ui.calls.length,3);assert.ok(ui.controls.every(c=>!c.disabled));
});

test('다른 내역을 연 뒤 이전 첨부 완료는 화면을 되돌리지 않는다',async()=>{
  const ui=screen();await ui.buttons[0].onclick();const pending=ui.add.onclick();await ui.buttons[1].onclick();ui.resolve();await pending;assert.equal(ui.calls.length,3);assert.match(ui.calls[2].path,/safety-costs\/2\/photos/);
});

test('화면이나 계정이 바뀐 뒤 삭제 응답과 오류를 표시하지 않는다',async()=>{
  for(const change of [ui=>{ui.state.page='dashboard';},ui=>{ui.state.admin={};},ui=>{ui.state.costMonth='2026-12';}]){const ui=screen();await ui.buttons[0].onclick();const pending=ui.remove.onclick();await ui.remove.onclick();assert.equal(ui.calls.length,2);assert.match(ui.calls[1].path,/version=v1/);change(ui);ui.reject();await pending;assert.deepEqual(ui.errors,[]);assert.equal(ui.calls.length,2);}
});
