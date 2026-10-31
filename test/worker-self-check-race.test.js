import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function screen(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showWorkerSelfCheck('),end=source.indexOf('async function showWorkerActivities(',start);assert.ok(start>=0&&end>start);
  let view={isConnected:true},opened=[],waits=[];const dialog={open:true,close(){this.open=false;view=null;}},controls={'#dialog-form button[type=submit]':{},'#self-check-print-button':{}},context={state:{siteId:7},dialog,workerSelfCheckEpoch:0,$:key=>key==='#activity-results'?view:controls[key],api:()=>new Promise((resolve,reject)=>waits.push({resolve,reject})),esc:String,showDialog:(_title,html)=>{opened.push(html);dialog.open=true;},showError:error=>{throw error;},flash(){},window:{print(){}}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.openCheck=showWorkerSelfCheck;',context);return {context,waits,opened,replaceView(){view.isConnected=false;view={isConnected:true};},getView:()=>view};
}

test('다른 근로자의 활동 창을 연 뒤 이전 자가점검 응답을 무시한다',async()=>{
  const ui=screen(),pending=ui.context.openCheck({id:1,name:'가상 A'},7,'2026-10-01');ui.replaceView();ui.waits[0].resolve([{id:1,created_at:'가상',answers:{}}]);await pending;assert.equal(ui.opened.length,0);assert.ok(ui.getView());
});

test('여러 자가점검을 연속 선택하면 마지막 선택만 표시한다',async()=>{
  const ui=screen(),first=ui.context.openCheck({id:1,name:'가상 A'},7,'2026-10-01'),second=ui.context.openCheck({id:2,name:'가상 B'},7,'2026-10-02');ui.waits[0].resolve([{id:1,created_at:'가상',answers:{}}]);await first;assert.equal(ui.opened.length,0);ui.waits[1].resolve([{id:2,created_at:'가상',answers:{}}]);await second;assert.equal(ui.opened.length,1);assert.match(ui.opened[0],/가상 B/);
});

test('이전 창의 오류는 현재 창에 표시하지 않는다',async()=>{
  const ui=screen(),pending=ui.context.openCheck({id:1,name:'가상 A'},7,'2026-10-01');ui.replaceView();ui.waits[0].reject(Error('오래된 오류'));await pending;assert.equal(ui.opened.length,0);assert.ok(ui.getView());
  const current=ui.context.openCheck({id:2,name:'가상 B'},7,'2026-10-02');ui.waits[1].reject(Error('현재 오류'));await assert.rejects(current,/현재 오류/);
});
