import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function screen(){
 const line=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split('\n').find(v=>v.includes("pay.textContent='기본 시험 급여'"));assert.ok(line);
 const buttons=[1,2].map(id=>({dataset:{editWorker:String(id)},after(node){this.pay=node;}})),workers=buttons.map((_,i)=>({id:i+1,name:i?'<둘째>':'첫째'})),form={onsubmit:null},state={page:'workers',siteId:1,admin:{scope:'global'}},calls=[],opened=[];
 const context={workers,state,siteId:1,epoch:1,workerListEpoch:1,workerEditEpoch:0,document:{querySelectorAll:()=>buttons,createElement:()=>({isConnected:true})},$:()=>form,esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),api:(path,options,current)=>{const wait=deferred();calls.push({path,options,current,wait});return wait.promise;},showDialog:(title,html,submit,current)=>{form.onsubmit=submit;opened.push({title,html,submit,current});},showError:e=>{throw e;}};
 runInNewContext(line,context);return {buttons,state,calls,opened};
}
test('기본 급여 화면은 선택 직원과 0원 및 저장 확인값을 표시한다',async()=>{
 const ui=screen(),pending=ui.buttons[1].pay.onclick();ui.calls[0].wait.resolve({kind:'daily',amount:0,version:4});await pending;
 assert.equal(ui.opened.length,1);assert.match(ui.opened[0].html,/&lt;둘째&gt;/);assert.match(ui.opened[0].html,/value="0"/);assert.match(ui.opened[0].html,/value="daily" selected/);
 const saving=ui.opened[0].submit({kind:'daily',amount:'0'}),call=ui.calls[1];assert.equal(call.path,'/api/workers/2/default-pay');assert.deepEqual(JSON.parse(call.options.body),{kind:'daily',amount:'0',siteId:1,version:4});call.wait.resolve({});await saving;
});
test('기본 급여 이전 조회는 다른 직원이나 현장으로 전환한 화면을 바꾸지 않는다',async()=>{
 const ui=screen(),old=ui.buttons[0].pay.onclick(),latest=ui.buttons[1].pay.onclick();ui.calls[1].wait.resolve({kind:null,amount:null,version:0});await latest;ui.calls[0].wait.resolve({kind:'daily',amount:10,version:1});await old;assert.equal(ui.opened.length,1);assert.match(ui.opened[0].html,/&lt;둘째&gt;/);
 const next=screen(),pending=next.buttons[0].pay.onclick();next.state.siteId=2;next.calls[0].wait.resolve({kind:'daily',amount:10,version:1});await pending;assert.equal(next.opened.length,0);
});
