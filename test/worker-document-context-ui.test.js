import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8');
test('신규 문서의 기존 화면 문맥 전송과 409 입력 보존 및 정상 저장',async()=>{
  for(const accepted of [false,true]){
    const from=source.indexOf('    form.onsubmit='),to=source.indexOf("    if(doc&&type==='work_plan')",from);assert.ok(from>=0&&to>from);
    const button={disabled:false},form={isConnected:true,elements:Object.fromEntries(['title','date','body','weather','instructor','work','hazards'].map(key=>[key,{value:'가상 '+key}])),querySelector:()=>button},reportContext={workerId:1,siteId:1,generation:'original'},calls=[],editor={clears:0,replaceChildren(){this.clears++;}},status={textContent:''};
    const context={form,reportContext,doc:null,type:'tbm',editor,status,send:async(path,method,input)=>{calls.push({path,method,input});if(!accepted)throw Error('입력 내용을 복사');},message:error=>{status.textContent=error.message;},updateList:async()=>{}};runInNewContext(source.slice(from,to),context);await form.onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/worker/documents');assert.equal(calls[0].input.reportContext,reportContext);assert.equal(editor.clears,accepted?1:0);assert.equal(form.elements.body.value,'가상 body');assert.equal(button.disabled,false);assert.match(status.textContent,accepted?/저장했습니다/:/입력 내용을 복사/);
  }
});
