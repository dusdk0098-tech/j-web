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

test('선택한 사진을 점검 내용과 하나의 폼으로 전송한다',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(value=>value.includes("$('#equipment-check-form').onsubmit=")),form={},entries=[],file={name:'가상.png',size:10},fields={item:'가상',result:'적정',checkType:'일반',section:'',action:''},rows={querySelectorAll:()=>[{querySelector:selector=>({value:fields[selector.match(/name=([^\]]+)/)[1]]})}]};let sent;
 class VirtualFormData{append(key,value){entries.push([key,value]);}}const context={$:()=>form,rows,doc:{id:3},useSignature:{checked:false},FormData:VirtualFormData,api:async(path,options)=>{sent={path,body:options.body};},flash:()=>{},render:async()=>{},showError:error=>{throw error;}};
 runInNewContext(line,context);await form.onsubmit({preventDefault(){},currentTarget:{elements:{equipmentId:{value:'4'},date:{value:'2026-11-06'},photos:{files:[file]}}}});assert.equal(sent.path,'/api/documents/3/equipment-checks');assert.ok(sent.body instanceof VirtualFormData);assert.equal(JSON.parse(entries[0][1]).items[0].name,'가상');assert.equal(entries[1][1],file);
});

test('사진 전송 중 중복 제출을 막고 실패하면 버튼과 입력을 유지한다',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(value=>value.includes("$('#equipment-check-form').onsubmit=")),form={},file={name:'가상.png',size:10},fields={item:'가상',result:'적정',checkType:'일반',section:'',action:''},rows={querySelectorAll:()=>[{querySelector:selector=>({value:fields[selector.match(/name=([^\]]+)/)[1]]})}]};let reject,calls=0,error;class VirtualFormData{append(){}}
 const context={$:()=>form,rows,doc:{id:3},useSignature:{checked:false},FormData:VirtualFormData,api:()=>{calls++;return new Promise((_,r)=>reject=r);},flash:()=>{},render:async()=>{},showError:e=>{error=e;}};runInNewContext(line,context);
 const button={disabled:false},target={elements:{equipmentId:{value:'4'},date:{value:'2026-11-06'},photos:{files:[file]}}},event={preventDefault(){},currentTarget:target,submitter:button},pending=form.onsubmit(event);assert.equal(button.disabled,true);await form.onsubmit(event);assert.equal(calls,1);reject(Error('시험 오류'));await pending;assert.equal(button.disabled,false);assert.match(error.message,/시험 오류/);assert.equal(target.elements.photos.files[0],file);
});
