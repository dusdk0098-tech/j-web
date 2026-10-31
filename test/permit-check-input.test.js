import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('허가서 점검에서 미흡을 해제하면 해당 행의 조치 입력만 지운다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('const editCheck=check=>{'),end=source.indexOf("    $('#permit-check-add').onclick",start);
  assert.ok(start>=0&&end>start);
  const rows={querySelectorAll:()=>[]},add={},nodes={'#permit-check-rows':rows,'#permit-check-row-add':add};
  const context={$:key=>nodes[key],showDialog(){},field:()=>'',esc:String,today:()=>'',api(){},doc:{id:1}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.openCheck=editCheck;',context);context.openCheck(null);
  const action={value:'가상 조치'},otherAction={value:'다른 행 조치'},wrap={hidden:false},row={querySelector(key){return key==='[data-action-wrap]'?wrap:action;}};
  const target={value:'pass',matches:key=>key==='[data-check-result]',closest:()=>row};
  rows.onchange({target});assert.equal(wrap.hidden,true);assert.equal(action.value,'');assert.equal(otherAction.value,'다른 행 조치');
  target.value='fail';rows.onchange({target});assert.equal(wrap.hidden,false);assert.equal(action.value,'');
  action.value='다른 조치';target.value='';rows.onchange({target});assert.equal(action.value,'');assert.equal(wrap.hidden,true);
});
