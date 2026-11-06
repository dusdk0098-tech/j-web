import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const line=source.split('\n').find(value=>value.includes("content.querySelectorAll('[data-delete-equipment-check]')"));
assert.ok(line);
const handler=line.slice(line.indexOf("content.querySelectorAll('[data-delete-equipment-check]')"),line.lastIndexOf('}'));
function screen({version='a'.repeat(64),accept=true,fail=false}={}){
  const button={dataset:{deleteEquipmentCheck:'5'}},calls=[],errors=[];let renders=0;
  const equipmentChecks=[{id:5,version}],doc={id:9};
  runInNewContext(handler,{content:{querySelectorAll:()=>[button]},equipmentChecks,doc,confirm:()=>accept,api:async(path,options)=>{calls.push({path,method:options.method});if(fail)throw Error('점검이 변경되었습니다. 다시 조회해 주세요.');},render:async()=>{renders++;},showError:error=>errors.push(error.message),encodeURIComponent,Number,Error});
  return {click:()=>button.onclick(),calls,errors,renders:()=>renders};
}

test('점검 삭제는 표시된 기록의 확인값을 전송하고 충돌 시 화면을 유지한다',async()=>{
  const ok=screen();await ok.click();assert.deepEqual(ok.calls,[{path:'/api/documents/9/equipment-checks/5?version='+ 'a'.repeat(64),method:'DELETE'}]);assert.equal(ok.renders(),1);
  const conflict=screen({fail:true});await conflict.click();assert.equal(conflict.renders(),0);assert.match(conflict.errors[0],/변경/);
  const noVersion=screen({version:''});await noVersion.click();assert.equal(noVersion.calls.length,0);assert.match(noVersion.errors[0],/다시 조회/);
  const cancelled=screen({accept:false});await cancelled.click();assert.equal(cancelled.calls.length,0);
});
