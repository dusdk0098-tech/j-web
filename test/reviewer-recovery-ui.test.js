import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mountReviewerProfile } from '../public/reviewer-profile.js';

const source=readFileSync(new URL('../public/review-recovery.js',import.meta.url),'utf8');
const event={preventDefault(){}};
function page(hash,fetch,pathname='/review-recovery'){
  const requestButton={disabled:false},verifyButton={disabled:false},resetButton={disabled:false},status={textContent:''},identityLabel={textContent:''};
  const request={hidden:false,elements:{name:{value:'가상 직원'},email:{value:'worker@example.test'},mode:{value:'id'},identity:{value:'가상 발주처'},phone:{value:'010-0000-0000'}},querySelector:()=>requestButton};
  const verify={hidden:true,querySelector:()=>verifyButton};
  const reset={hidden:true,elements:{password:{value:'virtual-new-password-456',disabled:false},confirmPassword:{value:'virtual-new-password-456',disabled:false}},querySelector:()=>resetButton,reset(){this.elements.password.value='';this.elements.confirmPassword.value='';}};
  const elements={'#recovery-request':request,'#recovery-verify':verify,'#recovery-reset':reset,'#recovery-status':status,'#recovery-identity-label':identityLabel},history=[];
  runInNewContext(source,{document:{querySelector:selector=>elements[selector]},location:{hash,pathname},history:{replaceState:(...args)=>history.push(args)},URLSearchParams,fetch});
  return {request,verify,reset,status,requestButton,verifyButton,resetButton,history,identityLabel};
}

test('계정 찾기 화면은 이름과 이메일을 보내고 일반 응답을 표시한다',async()=>{
  let request;const ui=page('',async(path,options)=>{request={path,body:JSON.parse(options.body)};return {ok:true,json:async()=>({message:'가상 요청 완료'})};});
  await ui.request.onsubmit(event);assert.equal(request.path,'/api/reviewer/recovery/request');assert.deepEqual(request.body,{name:'가상 직원',email:'worker@example.test'});assert.equal(ui.status.textContent,'가상 요청 완료');assert.equal(ui.requestButton.disabled,false);
});

test('발주처 찾기는 선택한 방식과 휴대전화를 발주처 API에 보낸다',async()=>{
  let request;const ui=page('',async(path,options)=>{request={path,body:JSON.parse(options.body)};return {ok:true,json:async()=>({message:'가상 요청 완료'})};},'/client-recovery');
  assert.equal(ui.identityLabel.textContent,'이름');ui.request.elements.mode.value='password';ui.request.elements.mode.onchange();assert.equal(ui.identityLabel.textContent,'아이디');ui.request.elements.identity.value='virtual_client';
  await ui.request.onsubmit(event);assert.equal(request.path,'/api/client/recovery/request');assert.deepEqual(request.body,{mode:'password',identity:'virtual_client',phone:'010-0000-0000',email:'worker@example.test'});assert.equal(ui.status.textContent,'가상 요청 완료');
});

test('이메일 확인 링크를 주소에서 지우고 확인 버튼으로 한 번 전송한다',async()=>{
  const value='A'.repeat(43);let request;const ui=page(`#verify=${value}`,async(path,options)=>{request={path,body:JSON.parse(options.body)};return {ok:true,json:async()=>({ok:true})};});
  assert.equal(ui.request.hidden,true);assert.equal(ui.verify.hidden,false);assert.equal(ui.history[0][2],'/review-recovery');await ui.verify.querySelector().onclick({currentTarget:ui.verifyButton});
  assert.equal(request.path,'/api/reviewer/recovery/verify');assert.equal(request.body.token,value);assert.equal(ui.verify.hidden,true);assert.match(ui.status.textContent,/이메일을 확인/);
});

test('암호 변경 응답이 유실되면 입력을 보존하고 로그인 확인을 안내한다',async()=>{
  let release,request;const pending=new Promise((resolve,reject)=>{release=()=>reject(Error('network'));});const ui=page(`#reset=${'B'.repeat(43)}`,async(path,options)=>{request={path,body:JSON.parse(options.body)};return pending;});
  const result=ui.reset.onsubmit(event);assert.equal(ui.reset.elements.password.disabled,true);assert.equal(ui.resetButton.disabled,true);release();await result;
  assert.equal(request.path,'/api/reviewer/recovery/reset');assert.equal(request.body.token,'B'.repeat(43));assert.equal(ui.reset.elements.password.value,'virtual-new-password-456');assert.equal(ui.reset.elements.password.disabled,false);assert.match(ui.status.textContent,/로그인을 먼저 확인/);
});

test('직원 내 정보에서 저장된 이메일의 확인을 요청하고 미저장 변경은 보존한다',async()=>{
  const original=globalThis.document,listeners={},output={textContent:'',isConnected:true},canvas={addEventListener(){}},clear={addEventListener(){},click(){}},change={},passwordFields={},replace={},signatureFields={},reload={after(value){this.recovery=value;}};
  const fields={'[data-photo]':{files:[]},'[data-remove-photo]':null,'[data-password]':change,'[data-password-fields]':passwordFields,'[data-replace-signature]':replace,'[data-remove-signature]':null,'[data-signature-fields]':signatureFields,'[data-clear]':clear,'[data-signature]':canvas};
  const form={querySelector:selector=>fields[selector],addEventListener:(name,handler)=>{listeners[name]=handler;}},target={innerHTML:'',querySelector:selector=>({'[data-profile]':form,'[data-status]':output,'[data-reload]':reload}[selector])};let count=0,body;
  globalThis.document={createElement:()=>({isConnected:true,after(value){this.next=value;}})};
  try{
    const api=async(path,options)=>{if(path==='/api/reviewer/profile')return {person:{name:'가상 직원',loginId:'virtual'},profile:{},version:'version-1'};if(!options)return {enabled:true,verified:false};count++;body=JSON.parse(options.body);return {ok:true};};
    await mountReviewerProfile({target,api,pad:()=>()=>'',active:()=>true,onPasswordChanged(){}});assert.match(reload.recovery.next.textContent,/확인 필요/);
    await reload.recovery.onclick();assert.equal(count,1);assert.deepEqual(body,{version:'version-1'});assert.match(output.textContent,/전달을 요청/);
    listeners.input();await reload.recovery.onclick();assert.equal(count,1);assert.match(output.textContent,/먼저 저장/);
  }finally{globalThis.document=original;}
});
