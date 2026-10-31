import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mountReviewerBasicDocuments } from '../public/reviewer-basic-documents.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const row=(id=1,title='가상 기본 서류')=>({id,title,date:'2026-10-31',category:'안전 자료',site_id:7,shared:0});
const response=id=>({document:{...row(id),body:'가상 본문'},attachments:[{id:9,name:'가상 첨부.txt'}]});

// shortcut: 조회 패널의 선택자와 이벤트만 모의 처리하므로 실제 배치는 별도 브라우저 검증이 필요하다.
function node(){
  return {isConnected:true,hidden:false,markup:'',buttons:[],links:[],children:new Map(),
    set innerHTML(value){this.markup=value;this.buttons=[...value.matchAll(/data-open="(\d+)"/g)].map(match=>({dataset:{open:match[1]}}));this.links=[...value.matchAll(/<a href="([^"]+)">/g)].map(match=>({href:match[1]}));},
    get innerHTML(){return this.markup;},set textContent(value){this.markup=value;this.buttons=[];this.links=[];},get textContent(){return this.markup;},
    querySelector(key){if(!this.children.has(key))this.children.set(key,node());return this.children.get(key);},querySelectorAll(key){return key==='a'?this.links:this.buttons;},
    remove(){this.isConnected=false;this.onremove?.();}
  };
}
function screen(api){const target=node();let active=true;return {target,ready:mountReviewerBasicDocuments({target,siteId:7,api,active:()=>active}),list:()=>target.querySelector('[data-list]'),detail:()=>target.querySelector('[data-detail]'),status:()=>target.querySelector('[data-status]'),reload:()=>target.querySelector('[data-reload]').onclick(),stop(){active=false;target.remove();}};}

test('기본 서류 목록·상세·첨부는 읽기 전용 경로와 이스케이프한 내용만 표시한다',async()=>{
  const calls=[],attack='<img src=x onerror="alert(1)">',item={...row(1,attack),category:attack,date:attack},ui=screen(async(path,options)=>{calls.push([path,options]);return path.endsWith('/1')?{document:{...item,body:attack},attachments:[{id:9,name:attack},{id:'../escape',name:'잘못된 파일'}]}:{documents:[item,{...row(2),site_id:8,shared:1}]};});await ui.ready;
  assert.match(ui.target.innerHTML,/J웹의 독립 시험 기능/);assert.match(ui.list().innerHTML,/본인 소속 현장 · 현장 자료/);assert.match(ui.list().innerHTML,/다른 현장 · 공유 자료/);assert.ok(!ui.list().innerHTML.includes('<img'));
  await ui.list().buttons[0].onclick();assert.ok(!ui.detail().innerHTML.includes('<img'));assert.match(ui.detail().innerHTML,/&lt;img/);assert.deepEqual(ui.detail().links.map(link=>link.href),['/api/reviewer/basic-documents/1/attachments/9']);assert.deepEqual(calls,[['/api/reviewer/basic-documents',undefined],['/api/reviewer/basic-documents/1',undefined]]);
  ui.detail().querySelector('[data-close]').onclick();assert.equal(ui.detail().textContent,'');
});

test('빈 목록·첨부와 조회 실패는 명확한 안내를 표시한다',async()=>{
  const empty=screen(async()=>({documents:[]}));await empty.ready;assert.match(empty.list().innerHTML,/조회할 승인된 기본 서류가 없습니다/);
  const ui=screen(async path=>path.endsWith('/1')?{document:{...row(),body:''},attachments:[]}:{documents:[row()]});await ui.ready;await ui.list().buttons[0].onclick();assert.match(ui.detail().innerHTML,/첨부파일이 없습니다/);
  const failed=screen(async()=>{throw Error('조회 불가');});await failed.ready;assert.equal(failed.status().textContent,'조회 불가');
});

test('새 목록 조회는 이전 상세와 파일 링크를 즉시 지우고 늦은 목록·오류를 무시한다',async()=>{
  const waits=[],ui=screen(path=>{if(path.endsWith('/1'))return response(1);const wait=deferred();waits.push(wait);return wait.promise;});waits[0].resolve({documents:[row()]});await ui.ready;await ui.list().buttons[0].onclick();const oldLink=ui.detail().links[0],oldButton=ui.list().buttons[0],first=ui.reload();assert.equal(ui.detail().innerHTML,'');assert.equal(ui.list().innerHTML,'');
  let prevented=false;oldLink.onclick({preventDefault(){prevented=true;}});assert.equal(prevented,true);await oldButton.onclick();assert.equal(waits.length,2);
  const second=ui.reload();waits[2].resolve({documents:[row(2,'새 목록')]});await second;waits[1].resolve({documents:[row(1,'옛 목록')]});await first;assert.match(ui.list().innerHTML,/새 목록/);assert.ok(!ui.list().innerHTML.includes('옛 목록'));
  const older=ui.reload(),latest=ui.reload();waits[4].resolve({documents:[row(3,'최신 목록')]});await latest;waits[3].reject(Error('옛 오류'));await older;assert.equal(ui.status().textContent,'');assert.match(ui.list().innerHTML,/최신 목록/);
});

test('상세 조회와 목록 재조회가 겹치면 마지막 요청의 자료만 표시한다',async()=>{
  const waits=[],ui=screen(path=>{if(path==='/api/reviewer/basic-documents')return {documents:[row(1),row(2)]};const wait=deferred();waits.push(wait);return wait.promise;});await ui.ready;
  const first=ui.list().buttons[0].onclick(),second=ui.list().buttons[1].onclick();waits[1].resolve(response(2));await second;waits[0].resolve(response(1));await first;assert.equal(ui.detail().links[0].href,'/api/reviewer/basic-documents/2/attachments/9');
  const pending=ui.list().buttons[0].onclick();await ui.reload();waits[2].resolve(response(1));await pending;assert.equal(ui.detail().innerHTML,'');
  const wrong=ui.list().buttons[0].onclick();waits[3].resolve(response(2));await wrong;assert.equal(ui.detail().innerHTML,'');assert.match(ui.status().textContent,/요청한 서류/);
});

test('중지·분리된 패널에는 늦은 목록·상세·오류가 표시되지 않는다',async()=>{
  for(const kind of ['list','detail','error']){const wait=deferred(),ui=screen(path=>kind==='list'?wait.promise:path.endsWith('/1')?wait.promise:{documents:[row()]});let pending=ui.ready;if(kind!=='list'){await ui.ready;pending=ui.list().buttons[0].onclick();}ui.stop();const before=[ui.list().innerHTML,ui.detail().innerHTML,ui.status().textContent];if(kind==='error')wait.reject(Error('뒤늦은 오류'));else wait.resolve(kind==='list'?{documents:[row()]}:response(1));await pending;assert.deepEqual([ui.list().innerHTML,ui.detail().innerHTML,ui.status().textContent],before);}
});

test('직원 화면 연동은 계정·소속 현장 변경과 로그아웃 때 이전 패널을 분리한다',async()=>{
  const nodes=new Map(['#message','#review-login','#review-main','#review-list','#review-document','#review-logout'].map(key=>[key,node()])),pending=[],document={querySelector:key=>nodes.get(key)||null,createElement:()=>node()};
  nodes.get('#review-main').append=panel=>{nodes.set('#'+panel.id,panel);panel.onremove=()=>nodes.delete('#'+panel.id);};
  const context={document,mountReviewerBasicDocuments,fetch:path=>{if(path==='/api/reviewer/basic-documents'){const wait=deferred();pending.push(wait);return wait.promise;}return new Promise(()=>{});}};
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace("refresh().catch(()=>{login.hidden=false;main.hidden=true;});",'');runInNewContext(source+'\nglobalThis.testHooks={renderPersonalNotes,logoutScreen};',context);
  context.testHooks.renderPersonalNotes({id:1,site_id:7});const old=nodes.get('#review-basic-documents');context.testHooks.renderPersonalNotes({id:2,site_id:8});const fresh=nodes.get('#review-basic-documents');assert.notEqual(old,fresh);assert.equal(old.isConnected,false);
  pending[1].resolve({ok:true,json:async()=>({documents:[{...row(2,'새 직원 서류'),site_id:8}]})});await flush();pending[0].resolve({ok:true,json:async()=>({documents:[row(1,'이전 직원 서류')]})});await flush();assert.match(fresh.querySelector('[data-list]').innerHTML,/새 직원 서류/);assert.ok(!old.querySelector('[data-list]').innerHTML.includes('이전 직원 서류'));
  const priorSite=fresh.querySelector('[data-reload]').onclick();context.testHooks.renderPersonalNotes({id:2,site_id:9});const moved=nodes.get('#review-basic-documents');assert.notEqual(moved,fresh);assert.equal(fresh.isConnected,false);pending[3].resolve({ok:true,json:async()=>({documents:[{...row(4,'옮긴 현장 서류'),site_id:9}]})});await flush();pending[2].resolve({ok:true,json:async()=>({documents:[{...row(3,'이전 현장 서류'),site_id:8}]})});await priorSite;assert.match(moved.querySelector('[data-list]').innerHTML,/옮긴 현장 서류/);assert.match(moved.querySelector('[data-list]').innerHTML,/본인 소속 현장/);assert.ok(!fresh.querySelector('[data-list]').innerHTML.includes('이전 현장 서류'));
  const loading=moved.querySelector('[data-reload]').onclick();context.testHooks.logoutScreen('로그아웃');assert.equal(moved.isConnected,false);assert.equal(nodes.has('#review-basic-documents'),false);assert.equal(nodes.get('#review-main').hidden,true);pending[4].resolve({ok:true,json:async()=>({documents:[row(5,'로그아웃 후 자료')]})});await loading;assert.ok(!moved.querySelector('[data-list]').innerHTML.includes('로그아웃 후 자료'));
});
