import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReviewerProfile} from '../public/reviewer-profile.js';

function fixture(api){
 const listeners={},output={textContent:'',isConnected:true},button={disabled:false},photo={files:[]},clear={addEventListener(){},click(){}},canvas={addEventListener(){}},reload={after(){}},controls={'[data-password]':{checked:false},'[data-password-fields]':{},'[data-replace-signature]':{checked:false},'[data-remove-signature]':null,'[data-signature-fields]':{},'[data-clear]':clear,'[data-signature]':canvas,'[data-photo]':photo,'[data-remove-photo]':null,'[type=submit]':button};
 const elements=Object.fromEntries(['phone','phoneExtension','mobile','email','postcode','address','addressDetail','currentPassword'].map(name=>[name,{value:'가상'}])),form={elements,isConnected:true,querySelector:key=>controls[key],addEventListener:(name,fn)=>{listeners[name]=fn;}},target={innerHTML:'',querySelector:key=>({'[data-profile]':form,'[data-status]':output,'[data-reload]':reload}[key])};
 return {listeners,output,button,form,target,async mount(){await mountReviewerProfile({target,api,pad:()=>()=>'',active:()=>true,onPasswordChanged(){}});}};
}
const profile={person:{name:'가상',loginId:'virtual'},profile:{hasPhoto:false},version:'v1'};

test('직원 정보 저장 중에는 입력을 잠그고 추가 편집이 감지되면 보존한다',async()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({isConnected:true,after(){}})};try{
  let finish,gets=0,writes=0;const api=async(path,options)=>{if(path.endsWith('/recovery'))return {enabled:false};if(!options){gets++;return profile;}writes++;return new Promise(resolve=>{finish=resolve;});},ui=fixture(api);await ui.mount();
  const pending=ui.form.onsubmit({preventDefault(){}});assert.equal(ui.form.inert,true);ui.form.elements.phone.value='추가 입력';ui.listeners.input();finish({passwordChanged:false});await pending;
  assert.equal(ui.form.inert,false);assert.equal(ui.form.elements.phone.value,'추가 입력');assert.match(ui.output.textContent,/추가로 바꾼 내용은 저장되지 않았습니다/);assert.equal(ui.button.disabled,true);assert.equal(gets,1);await ui.form.onsubmit({preventDefault(){}});assert.equal(writes,1);
 }finally{globalThis.document=old;}
});

test('저장 성공 후 재조회 실패는 저장 완료로 안내하고 이전 버전 재전송을 막는다',async()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({isConnected:true,after(){}})};try{
  let gets=0,writes=0;const api=async(path,options)=>{if(path.endsWith('/recovery'))return {enabled:false};if(!options){if(++gets>1)throw Error('조회 실패');return profile;}writes++;return {passwordChanged:false};},ui=fixture(api);await ui.mount();await ui.form.onsubmit({preventDefault(){}});
  assert.match(ui.output.textContent,/저장은 완료됐지만 다시 조회하지 못했습니다/);assert.equal(ui.button.disabled,true);assert.equal(ui.form.inert,false);await ui.form.onsubmit({preventDefault(){}});assert.equal(writes,1);
 }finally{globalThis.document=old;}
});

test('저장 요청 자체가 실패하면 입력을 보존하고 재시도할 수 있다',async()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({isConnected:true,after(){}})};try{
  const api=async(path,options)=>{if(path.endsWith('/recovery'))return {enabled:false};if(!options)return profile;throw Error('저장 실패');},ui=fixture(api);await ui.mount();await ui.form.onsubmit({preventDefault(){}});assert.equal(ui.form.elements.phone.value,'가상');assert.equal(ui.output.textContent,'저장 실패');assert.equal(ui.button.disabled,false);assert.equal(ui.form.inert,false);
 }finally{globalThis.document=old;}
});

test('저장 후 추가 편집이 없으면 최신 정보를 다시 불러온다',async()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({isConnected:true,after(){}})};try{
  let gets=0,writes=0;const api=async(path,options)=>{if(path.endsWith('/recovery'))return {enabled:false};if(!options){gets++;return {...profile,version:`v${gets}`};}writes++;return {passwordChanged:false};},ui=fixture(api);await ui.mount();await ui.form.onsubmit({preventDefault(){}});assert.equal(writes,1);assert.equal(gets,2);assert.equal(ui.output.textContent,'내 정보를 저장했습니다.');assert.equal(ui.button.disabled,false);assert.equal(ui.form.inert,false);
 }finally{globalThis.document=old;}
});

test('다시 열린 화면에는 이전 저장 응답을 적용하지 않는다',async()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({isConnected:true,after(){}})};try{
  let finish,gets=0,writes=0;const api=async(path,options)=>{if(path.endsWith('/recovery'))return {enabled:false};if(!options){gets++;return profile;}writes++;return new Promise(resolve=>{finish=resolve;});},ui=fixture(api);await ui.mount();
  const pending=ui.form.onsubmit({preventDefault(){}});ui.form.isConnected=false;finish({passwordChanged:false});await pending;assert.equal(gets,1);assert.equal(ui.output.textContent,'');assert.equal(ui.form.inert,false);await ui.form.onsubmit({preventDefault(){}});assert.equal(writes,1);
 }finally{globalThis.document=old;}
});
