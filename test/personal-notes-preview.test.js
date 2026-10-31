import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPersonalNotes,showPersonalNotePreview,mountPersonalNoteTools } from '../public/personal-notes-tools.js';

function fakeDocument(){
  const state={prints:0,frames:[],last:null,toolbar:null};
  const doc={body:{append(dialog){state.last=dialog;}},querySelector(){return state.last?.open?state.last:null;},defaultView:{print(){state.prints++;},requestAnimationFrame(callback){state.frames.push(callback);}},createElement(tag){
    if(tag==='div'){const controls={};for(const selector of ['author','from','to','query','search','all','preview','print','batch-status'])controls[`[data-note-${selector}]`]={value:'',textContent:''};return state.toolbar={controls,querySelector(selector){return controls[selector];}};}
    const buttons={'[data-preview-close]':{},'[data-preview-print]':{},'[data-preview-status]':{}};return {open:false,removed:false,buttons,setAttribute(){},querySelector(selector){return buttons[selector];},addEventListener(type,callback){if(type==='close')this.onclose=callback;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.removed=true;}};
  }};return {doc,state};
}

test('개인업무 검색은 같은 이름의 작성자를 계정별로 구분한다',()=>{
  const notes=[{id:1,author_id:11,author_name:'같은 이름',date:'2026-10-01',content:'가상 기록'},{id:2,author_id:12,author_name:'같은 이름',date:'2026-10-03',content:'다른 기록'}];
  assert.deepEqual(filterPersonalNotes(notes,{author:'12',from:'2026-10-02',to:'2026-10-04',q:'다른'}).map(row=>row.id),[2]);assert.deepEqual(filterPersonalNotes(notes,{author:'11',q:'다른'}),[]);
});

test('선택 일지의 내용과 파일명은 안전하게 표시하고 활성 화면에서만 인쇄한다',()=>{
  const {doc,state}=fakeDocument(),item={date:'2026-10-30',author_name:'<작성자>',private:1,checked:0,content:'<script>가상</script>',files:[{name:'<파일>.txt'}]};let active=true;
  const dialog=showPersonalNotePreview(doc,{siteName:'<현장>',items:[item]},{autoPrint:true,active:()=>active});assert.match(dialog.innerHTML,/&lt;현장&gt;/);assert.match(dialog.innerHTML,/&lt;script&gt;가상&lt;\/script&gt;/);assert.match(dialog.innerHTML,/&lt;파일&gt;\.txt/);assert.doesNotMatch(dialog.innerHTML,/<script>/);
  active=false;state.frames.shift()();dialog.buttons['[data-preview-print]'].onclick();assert.equal(state.prints,0);active=true;dialog.buttons['[data-preview-print]'].onclick();assert.equal(state.prints,1);dialog.buttons['[data-preview-close]'].onclick();assert.equal(dialog.removed,true);
});

test('선택 보기와 인쇄는 현재 선택과 일지 버전을 서버에 보내고 늦은 변경을 거절한다',async()=>{
  const {doc,state}=fakeDocument(),note={id:1,version:'버전',author_id:1,author_name:'가상',date:'2026-10-30',content:'가상',private:0,checked:0,files:[]},checkbox={checked:false,dataset:{noteSelect:'1'}},card={hidden:false,insertAdjacentHTML(){},querySelector(){return checkbox;}};
  const target={ownerDocument:doc,isConnected:true,insertBefore(){},querySelector(selector){if(selector==='article'||selector==='[data-review-note="1"]')return card;if(selector==='[data-review-note="1"] [data-note-select]')return checkbox;},querySelectorAll(){return checkbox.checked?[checkbox]:[];}};let posted,delay=false,release;
  const api=async(path,options)=>{posted={path,body:JSON.parse(options.body)};if(delay)return new Promise(resolve=>{release=resolve;});return {siteName:'가상',items:[note]};};
  mountPersonalNoteTools({target,notes:[note],api,base:'/api/reviewer/personal-notes',siteId:3,cardAttribute:'data-review-note',filters:{}});const controls=state.toolbar.controls;
  await controls['[data-note-preview]'].onclick();assert.match(controls['[data-note-batch-status]'].textContent,/선택/);controls['[data-note-all]'].onclick();await controls['[data-note-preview]'].onclick();assert.deepEqual(posted,{path:'/api/reviewer/personal-notes/preview',body:{siteId:3,items:[{id:1,version:'버전'}]}});assert.equal(state.last.open,true);state.last.close();
  await controls['[data-note-print]'].onclick();state.frames.shift()();assert.equal(state.prints,1);state.last.close();delay=true;const pending=controls['[data-note-preview]'].onclick();checkbox.checked=false;release({siteName:'가상',items:[note]});await pending;assert.match(controls['[data-note-batch-status]'].textContent,/선택이 변경/);assert.equal(state.last.open,false);
  checkbox.checked=true;controls['[data-note-query]'].value='없는 내용';controls['[data-note-search]'].onclick();assert.equal(card.hidden,true);assert.equal(checkbox.checked,false);controls['[data-note-query]'].value='';controls['[data-note-search]'].onclick();assert.equal(card.hidden,false);
});
