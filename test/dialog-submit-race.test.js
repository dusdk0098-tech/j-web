import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const from=source.indexOf('function showDialog('),to=source.indexOf("$('#menu-toggle').onclick",from);
  assert.ok(from>=0&&to>from);
  const form={values:[['title','가상 제목']]},submit={disabled:false},error={textContent:''},flashes=[];
  const elements={'#dialog-form':form,'#dialog-form button[type=submit]':submit,'#dialog-title':{},'#dialog-body':{},'#dialog-error':error,'#dialog-close':{},'#dialog-cancel':{}};
  const dialog={open:false,close(){this.open=false;},showModal(){this.open=true;}};
  let renders=0;
  const context={$:selector=>elements[selector],dialog,flash:message=>flashes.push(message),render:async()=>{renders++;},FormData:class {constructor(target){return target.values;}}};
  runInNewContext(source.slice(from,to),context);
  return {show:context.showDialog,send:()=>form.onsubmit({preventDefault(){},currentTarget:form}),close:()=>elements['#dialog-close'].onclick(),cancel:()=>elements['#dialog-cancel'].onclick(),submit,error,dialog,flashes,renders:()=>renders};
}

test('성공 결과의 안내를 표시한다',async()=>{const ui=setup();ui.show('시험 창','',async()=>({loginId:'virtual_user'}),()=>true,result=>'시험 아이디: '+result.loginId);await ui.send();assert.deepEqual(ui.flashes,['시험 아이디: virtual_user']);});

test('저장 중 현장 범위가 바뀌면 반환된 계정 정보를 표시하지 않는다',async()=>{const ui=setup(),pending=deferred();let current=true;ui.show('시험 창','',()=>pending.promise,()=>current,result=>'시험 아이디: '+result.loginId);const save=ui.send();current=false;pending.resolve({loginId:'virtual_user'});await save;assert.deepEqual(ui.flashes,[]);assert.equal(ui.renders(),0);});

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

for(const outcome of ['success','failure'])test(`이전 저장 ${outcome} 응답은 새 대화상자와 저장 중 버튼을 바꾸지 않는다`,async()=>{
  const ui=setup(),old=deferred(),current=deferred();
  ui.show('이전 창','',()=>old.promise);
  const oldSave=ui.send();
  assert.equal(ui.submit.disabled,true);
  ui.close();
  ui.show('새 창','',()=>current.promise);
  assert.equal(ui.submit.disabled,false);
  const currentSave=ui.send();
  ui.error.textContent='새 창 안내';
  if(outcome==='success')old.resolve();else old.reject(Error('이전 저장 오류'));
  await oldSave;
  assert.equal(ui.dialog.open,true);
  assert.equal(ui.submit.disabled,true);
  assert.equal(ui.error.textContent,'새 창 안내');
  assert.deepEqual(ui.flashes,[]);
  assert.equal(ui.renders(),0);
  current.resolve();await currentSave;
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.submit.disabled,false);
  assert.deepEqual(ui.flashes,['저장했습니다.']);
  assert.equal(ui.renders(),1);
});

for(const outcome of ['success','failure'])test(`취소한 창의 저장 ${outcome} 응답은 화면과 오류를 바꾸지 않는다`,async()=>{
  const ui=setup(),pending=deferred();
  ui.show('취소할 창','',()=>pending.promise);
  const saving=ui.send();ui.cancel();
  if(outcome==='success')pending.resolve();else pending.reject(Error('취소 후 오류'));
  await saving;
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.error.textContent,'');
  assert.deepEqual(ui.flashes,[]);
  assert.equal(ui.renders(),0);
});

test('현재 창은 중복 제출을 막고 저장 오류 후 다시 저장할 수 있다',async()=>{
  const ui=setup(),pending=deferred();let calls=0;
  ui.show('현재 창','',data=>{assert.equal(data.title,'가상 제목');calls++;return calls===1?pending.promise:Promise.resolve();});
  const first=ui.send();await ui.send();assert.equal(calls,1);
  pending.reject(Error('저장 실패'));await first;
  assert.equal(ui.dialog.open,true);
  assert.equal(ui.error.textContent,'저장 실패');
  assert.equal(ui.submit.disabled,false);
  await ui.send();assert.equal(calls,2);
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.renders(),1);
});
