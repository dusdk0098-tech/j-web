import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf("  if(state.page==='site-photos')"),to=source.indexOf("  if(state.page==='common-work')",from);assert.ok(from>=0&&to>from);

async function screen(){
  const state={page:'site-photos',siteId:1,admin:{}},remove={dataset:{deletePhoto:'7'},isConnected:true},edit={dataset:{editPhoto:'7'},isConnected:true},input={},paragraph={},image={replaceWith(){}},article={querySelector:()=>image},content={innerHTML:'',querySelector:selector=>selector==='#site-photo-add'?input:paragraph,querySelectorAll:selector=>selector==='article'?[article]:selector==='[data-edit-photo]'?[edit]:selector==='[data-delete-photo]'?[remove]:[]},controls={'#photo-search':{},'#site-photo-add':input},calls=[];let release,renders=0,scope;
  const context={state,sitePhotoEpoch:1,content,URLSearchParams,encodeURIComponent,document:{createElement:()=>({setAttribute(){},append(){}}),createTextNode:()=>({})},$:selector=>controls[selector],api:(path,options)=>{calls.push({path,options});if(!options?.method)return Promise.resolve([{id:7,name:'가상.png',date:'2026-11-01',description:'가상',version:'photo-v'}]);return new Promise(resolve=>{release=resolve;});},confirm:()=>true,showDialog:(_title,_html,_submit,current)=>{scope=current;},field:()=>'',render:async()=>{renders++;},showError:error=>{throw error;}};
  await runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async()=>{${source.slice(from,to)}})()`,context);return {state,remove,edit,calls,scope:()=>scope,release:()=>release({ok:true}),renders:()=>renders};
}

test('사진 수정은 화면이 유효한 동안에만 가능하다',async()=>{
  const ui=await screen();ui.edit.onclick();assert.equal(ui.scope()(),true);ui.state.page='dashboard';assert.equal(ui.scope()(),false);
});

test('사진 삭제 중 중복 요청과 화면 이동 후 재표시를 막는다',async()=>{
  const ui=await screen(),pending=ui.remove.onclick();assert.equal(ui.remove.disabled,true);await ui.remove.onclick();assert.equal(ui.calls.length,2);assert.match(ui.calls[1].path,/version=photo-v/);ui.state.page='dashboard';ui.release();await pending;assert.equal(ui.renders(),0);assert.equal(ui.remove.disabled,false);
});

test('계정이 바뀐 뒤 지난 사진 조회의 실패는 표시하지 않는다',async()=>{
  const state={page:'site-photos',siteId:1,admin:{id:1}},pending=[],context={state,sitePhotoEpoch:1,URLSearchParams,api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  const run=runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async()=>{${source.slice(from,to)}})`,context),old=run();state.admin={id:2};pending[0].reject(Error('이전 오류'));await old;
  const current=run();pending[1].reject(Error('현재 오류'));await assert.rejects(current,/현재 오류/);
});
