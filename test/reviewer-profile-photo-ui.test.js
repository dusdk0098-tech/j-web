import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReviewerProfile} from '../public/reviewer-profile.js';

test('사진 읽기 중 입력 변경을 감지하고 다시 저장할 때 사진을 전송한다',async()=>{
  const originalDocument=globalThis.document,originalReader=globalThis.FileReader,listeners={},output={textContent:'',isConnected:true},button={},photo={files:[{type:'image/png',size:80}]},removePhoto={checked:false},canvas={addEventListener(){}},clear={addEventListener(){},click(){}},reload={after(value){this.recovery=value;}},controls={'[data-password]':{checked:false},'[data-password-fields]':{},'[data-replace-signature]':{checked:false},'[data-remove-signature]':null,'[data-signature-fields]':{},'[data-clear]':clear,'[data-signature]':canvas,'[data-photo]':photo,'[data-remove-photo]':removePhoto,'[type=submit]':button};
  const elements=Object.fromEntries(['phone','phoneExtension','mobile','email','postcode','address','addressDetail','currentPassword'].map(name=>[name,{value:'가상'}])),form={elements,isConnected:true,querySelector:selector=>controls[selector],addEventListener:(name,fn)=>{listeners[name]=fn;}},target={innerHTML:'',querySelector:selector=>({'[data-profile]':form,'[data-status]':output,'[data-reload]':reload}[selector])};let reader,request;
  globalThis.document={createElement:()=>({isConnected:true,after(value){this.next=value;}})};globalThis.FileReader=class{constructor(){reader=this;}readAsDataURL(){}};
  try{
    const api=async(path,options)=>{if(path==='/api/reviewer/profile'&&!options)return {person:{name:'가상 직원',loginId:'virtual'},profile:{hasPhoto:true},version:'v1'};if(path.endsWith('/recovery'))return {enabled:false};request=JSON.parse(options.body);return {passwordChanged:true};};
    await mountReviewerProfile({target,api,pad:()=>()=>'',active:()=>true,onPasswordChanged(){}});assert.match(target.innerHTML,/data-photo/);
    let saving=form.onsubmit({preventDefault(){}});listeners.input();reader.result='data:image/png;base64,YWJj';reader.onload();await saving;assert.equal(request,undefined);assert.match(output.textContent,/입력이 변경/);
    saving=form.onsubmit({preventDefault(){}});reader.result='data:image/png;base64,YWJj';reader.onload();await saving;assert.equal(request.photo,'data:image/png;base64,YWJj');assert.equal(request.version,'v1');
    photo.files=[];removePhoto.checked=true;await form.onsubmit({preventDefault(){}});assert.equal(request.photo,null);
  }finally{globalThis.document=originalDocument;globalThis.FileReader=originalReader;}
});
