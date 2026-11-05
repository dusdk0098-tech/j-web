import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('소득세 시험 계산은 명시적으로 적용하고 기존 총액·오류 입력·다른 화면을 보존한다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/id=\"wage-local-example\"/);
 const start=source.indexOf("      const localButton=$('#wage-local-example')"),end=source.indexOf('      const manual=',start);assert.ok(start>0&&end>start);
 const actor={},state={admin:actor,siteId:1,page:'wages'},submit={disabled:false},form={elements:{income:{value:'12345'},local:{value:'777'},manualTotal:{value:'888'}},querySelector:()=>submit},button={isConnected:true},status={textContent:''},dialog={open:true};
 const context={state,siteId:1,epoch:2,detailEpoch:2,form,dialog,$:key=>key==='#wage-local-example'?button:status};runInNewContext(source.slice(start,end),context);
 button.onclick();assert.equal(form.elements.local.value,'1230');assert.equal(form.elements.manualTotal.value,'888');assert.match(status.textContent,/직접 입력한 공제 총액/);
 for(const [input,expected] of [['99','0'],['100','10'],['999999999','99999990']]){form.elements.income.value=input;button.onclick();assert.equal(form.elements.local.value,expected);}
 for(const input of ['', '-1','1.2','1000000000','abc']){form.elements.income.value=input;form.elements.local.value='77';button.onclick();assert.equal(form.elements.local.value,'77');assert.match(status.textContent,/정수/);}
 form.elements.income.value='12345';for(const change of [()=>state.admin={},()=>state.siteId=2,()=>state.page='other',()=>context.detailEpoch++,()=>dialog.open=false,()=>button.isConnected=false,()=>submit.disabled=true]){state.admin=actor;state.siteId=1;state.page='wages';context.detailEpoch=2;dialog.open=true;button.isConnected=true;submit.disabled=false;form.elements.local.value='77';change();button.onclick();assert.equal(form.elements.local.value,'77');}
});
