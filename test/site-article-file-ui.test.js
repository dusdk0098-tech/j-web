import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {siteArticleImageLimits} from '../public/site-article-images.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf("  if(state.page==='site-articles')"),to=source.indexOf("  if(state.page==='wages')",from);assert.ok(from>=0&&to>from);

async function screen(){
  const state={page:'site-articles',siteId:1,query:'',admin:{}},input={files:[{name:'가상.txt'}]},button={dataset:{file:'3'}},section={innerHTML:'',querySelector:()=>input,querySelectorAll:()=>[button]},node={isConnected:true,append(){}},content={innerHTML:'',querySelectorAll:selector=>selector==='article'?[node]:[]},elements={'#article-query':{closest:()=>({insertAdjacentHTML(){}})},'#article-add':{},'#article-search':{}},calls=[];let release,renders=0;
  const context={state,detailEpoch:1,content,document:{createElement:()=>section},URLSearchParams,encodeURIComponent,siteArticleImageLimits,richBody:()=>'',api:async(path,options)=>{calls.push({path,options});if(!options?.method)return [{id:2,title:'가상',category:'기타',version:'article-v',files:[{id:3,name:'가상.txt',version:'file-v'}]}];return {};},fetch:(path,options)=>{calls.push({path,options});return new Promise(resolve=>{release=resolve;});},$:selector=>elements[selector],render:async()=>{renders++;},showError:error=>{throw error;}};
  await runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async(renderEpoch)=>{${source.slice(from,to)}})(1)`,context);return {state,input,button,section,calls,release:()=>release({ok:true}),renders:()=>renders};
}

test('파일 업로드는 게시글 버전을 보내고 화면 이동 후 중복 실행과 재표시를 막는다',async()=>{
  const ui=await screen(),pending=ui.input.onchange({target:ui.input});assert.equal(ui.input.disabled,true);await ui.input.onchange({target:ui.input});assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].options.headers['x-article-version'],'article-v');
  ui.state.page='dashboard';ui.release();await pending;assert.equal(ui.renders(),0);assert.equal(ui.input.disabled,false);
});

test('첨부 삭제는 조회한 파일 버전을 전송한다',async()=>{
  const ui=await screen();assert.match(ui.section.innerHTML,/version=file-v/);await ui.button.onclick();assert.match(ui.calls.at(-1).path,/version=file-v/);assert.equal(ui.calls.at(-1).options.method,'DELETE');assert.equal(ui.renders(),1);
});
