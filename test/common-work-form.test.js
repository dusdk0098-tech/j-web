import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCommonWork } from '../public/common-work-view.js';

function fixture(){
  const controls={},draft={disabled:false},submit={},calls=[];
  const elements=Object.fromEntries(['date','category','process','participants','instructor','location','title','status'].map(key=>[key,{value:key==='status'?'draft':'',focus(){this.focused=true;},querySelector:()=>draft}]));
  const form={elements,querySelector:()=>submit,reset(){for(const [key,element] of Object.entries(elements))element.value=key==='status'?'draft':'';}};
  const files={files:[],disabled:false,set value(value){assert.equal(value,'');this.files=[];},get value(){return this.files.length?'fakepath':'';}};
  const editor={ownerDocument:{},childNodes:[],replaceChildren(){this.childNodes=[];},querySelectorAll:()=>[]};
  for(const name of ['work-status','work-cancel','work-recover','new-files-list','rich-toolbar','work-search','work-select-all','work-preview','work-print'])controls['[data-'+name+']']={};
  Object.assign(controls,{'[data-work-form]':form,'[data-work-new-files]':files,'[data-rich-editor]':editor});
  const target={isConnected:true,querySelector:selector=>controls[selector],querySelectorAll:()=>[]};
  return {target,controls,form,files,editor,draft,submit,calls,api:async(path,options)=>{calls.push({path,options});return [];}};
}

test('신규 취소는 모든 입력·본문·첨부를 비우고 재작성과 현장 표시를 유지한다',async()=>{
  const f=fixture();
  await mountCommonWork({target:f.target,base:'/api/common-work',siteId:1,siteName:'가상 <현장>',api:f.api});
  assert.match(f.target.innerHTML,/<form data-work-form><p data-work-site>현장: 가상 &lt;현장&gt;<\/p>/);
  assert.match(f.target.innerHTML,/<button type="button" data-work-cancel>취소<\/button>/);
  for(let attempt=0;attempt<2;attempt++){
    for(const element of Object.values(f.form.elements))element.value='가상 입력';
    f.editor.childNodes=[{nodeType:3,textContent:'가상 본문'}];
    f.files.files=[{name:'가상.txt',size:4}];f.files.onchange();
    assert.equal(f.controls['[data-new-files-list]'].textContent,'가상.txt');
    f.controls['[data-work-status]'].textContent='이전 오류';
    f.controls['[data-work-cancel]'].onclick();
    for(const [key,element] of Object.entries(f.form.elements))assert.equal(element.value,key==='status'?'draft':'');
    assert.deepEqual(f.editor.childNodes,[]);assert.deepEqual(f.files.files,[]);
    assert.equal(f.controls['[data-new-files-list]'].textContent,'');assert.equal(f.controls['[data-work-status]'].textContent,'');
    assert.equal(f.files.disabled,false);assert.equal(f.submit.disabled,false);assert.equal(f.draft.disabled,false);
    assert.equal(f.controls['[data-work-cancel]'].hidden,false);assert.equal(f.form.elements.title.focused,true);
  }
  assert.equal(f.calls.filter(call=>call.options).length,0);
});

test('저장 응답 대기 중 취소는 입력을 보존한다',async()=>{
  const f=fixture();let release;
  const api=async(path,options)=>options?new Promise(resolve=>release=resolve):[];
  await mountCommonWork({target:f.target,base:'/api/common-work',siteId:1,api});
  f.form.elements.title.value='가상 저장 중';
  const original=globalThis.FormData;
  globalThis.FormData=class{constructor(form){return Object.entries(form.elements).map(([key,item])=>[key,item.value]);}};
  try{
    const pending=f.form.onsubmit({preventDefault(){}});
    assert.equal(typeof release,'function');f.controls['[data-work-cancel]'].onclick();
    assert.equal(f.form.elements.title.value,'가상 저장 중');
    release({});await pending;
  }finally{globalThis.FormData=original;}
});

test('현장명이 없는 결재자 화면은 현장 번호를 표시한다',async()=>{
  const f=fixture();
  await mountCommonWork({target:f.target,base:'/api/reviewer/common-work',siteId:73,actorId:4,api:f.api});
  assert.match(f.target.innerHTML,/<p data-work-site>현장: 현장 #73<\/p>/);
});
