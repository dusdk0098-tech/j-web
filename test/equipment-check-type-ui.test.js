import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('장비 점검 입력 화면의 유형 선택은 저장 요청에 포함된다',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(value=>value.includes("$('#equipment-check-form').onsubmit="));assert.ok(line);assert.match(source,/<select name="checkType"><option>일반<\/option><option>장비<\/option><\/select>/);
 const form={},fields={item:'가상 항목',result:'적정',checkType:'장비',section:'가상 구분',action:''},rows={querySelectorAll:()=>[{querySelector:selector=>({value:fields[selector.match(/name=([^\]]+)/)[1]]})}]};let sent;
 const context={$:()=>form,rows,doc:{id:3},useSignature:{checked:false},api:async(path,options)=>{sent={path,body:JSON.parse(options.body)};},flash:()=>{},render:async()=>{},showError:error=>{throw error;}};
 runInNewContext(line,context);await form.onsubmit({preventDefault(){},currentTarget:{elements:{equipmentId:{value:'4'},date:{value:'2026-11-06'}}}});assert.equal(sent.path,'/api/documents/3/equipment-checks');assert.equal(sent.body.items[0].checkType,'장비');assert.equal(sent.body.items[0].section,'가상 구분');
});
