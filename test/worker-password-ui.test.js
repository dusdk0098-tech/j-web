import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerPassword} from '../public/worker-password.js';

function screen(fetcher){
  const fields=Object.fromEntries(['currentPassword','newPassword','confirmPassword'].map(name=>[name,{value:name==='currentPassword'?'virtual-old-password':'virtual-new-password',disabled:false}])),button={disabled:false},status={textContent:''},form={elements:fields,querySelector:()=>button},section={innerHTML:'',querySelector:selector=>selector==='form'?form:status},panel={isConnected:true,ownerDocument:{createElement:()=>section},append(){}},context={workerId:7,siteId:3,generation:'가상 세션'};let changed=0;
  mountWorkerPassword(panel,context,()=>{changed++;panel.isConnected=false;},fetcher);return {panel,form,fields,button,status,context,changed:()=>changed,submit:()=>form.onsubmit({preventDefault(){}})};
}
const response=(status,data={})=>({ok:status>=200&&status<300,status,json:async()=>data});

test('입력 오류와 거절은 암호를 보존하고 다시 시도할 수 있다',async()=>{
  let calls=0;const ui=screen(async()=>{calls++;return response(403,{error:'현재 암호를 확인해 주세요.'});});
  ui.fields.confirmPassword.value='다름';await ui.submit();assert.equal(calls,0);assert.match(ui.status.textContent,/같게/);
  ui.fields.confirmPassword.value=ui.fields.newPassword.value;await ui.submit();assert.equal(calls,1);assert.match(ui.status.textContent,/현재 암호/);assert.equal(ui.fields.currentPassword.value,'virtual-old-password');assert.equal(ui.button.disabled,false);assert.ok(Object.values(ui.fields).every(field=>!field.disabled));
});

test('중복 제출을 막고 요청한 세션의 성공에서만 화면을 정리한다',async()=>{
  let release,calls=0,body;const ui=screen((path,options)=>{calls++;assert.equal(path,'/api/worker/password');assert.equal(options.method,'PUT');body=JSON.parse(options.body);return new Promise(resolve=>{release=resolve;});});
  const pending=ui.submit();assert.equal(ui.button.disabled,true);assert.ok(Object.values(ui.fields).every(field=>field.disabled));await ui.submit();assert.equal(calls,1);assert.deepEqual(body.reportContext,ui.context);
  release(response(200,{ok:true}));await pending;assert.equal(ui.changed(),1);assert.equal(ui.panel.isConnected,false);
});

test('응답 유실과 지연 응답은 저장 여부를 단정하거나 새 화면을 바꾸지 않는다',async()=>{
  const uncertain=screen(async()=>{throw Error('가상 연결 오류');});await uncertain.submit();assert.match(uncertain.status.textContent,/변경 여부를 확인하지 못했습니다/);assert.equal(uncertain.changed(),0);
  let release;const stale=screen(()=>new Promise(resolve=>{release=resolve;})),pending=stale.submit();stale.panel.isConnected=false;release(response(200,{ok:true}));await pending;assert.equal(stale.changed(),0);
});
