import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function api('),end=source.indexOf('function flash(',start);
assert.ok(start>=0&&end>start);
const stickerSource=readFileSync(new URL('../public/sticker-requests.js',import.meta.url),'utf8');
const response=(status,data={})=>({status,ok:status<400,json:async()=>data});
const values={address:'가상 주소',detail:'가상 상세',recipient:'가상 수령인',phone:'000-0000-0000',quantity:'2',note:'보존할 가상 메모',consent:'on'};

// shortcut: 실제 API·스티커 핸들러를 가상 DOM에서 실행하며 기본 dialog 동작·배치는 브라우저 검증이 허용될 때 확인한다.
function screen(){
  const dialogs=[],redirects=[],calls=[],main={open:false};let resets=0,selected=1;
  const node=()=>({textContent:'',innerHTML:'',children:new Map(),querySelector(selector){if(!this.children.has(selector))this.children.set(selector,node());return this.children.get(selector);}});
  const document={body:{append(element){element.isConnected=true;dialogs.push(element);}},querySelector(selector){assert.equal(selector,'dialog[open]');return dialogs.find(element=>element.isConnected&&element.open)||null;},createElement(tag){assert.equal(tag,'dialog');return {...node(),isConnected:false,open:false,showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.isConnected=false;}};}};
  const ui={main,dialogs,redirects,calls,reply:async(_path,options)=>response(200,options.method?{}:[]),resets:()=>resets};
  const context={document,dialog:main,location:{assign:path=>redirects.push(path)},fetch:async(path,options)=>{calls.push({path,options});return ui.reply(path,options);},FormData:class{constructor(form){return Object.entries(form.values);}}};
  runInNewContext(source.slice(start,end)+'\n'+stickerSource.replace('export function mountStickerRequests','function mountStickerRequests'),context);
  const button={},siteSelect={addEventListener(_event,callback){this.change=callback;}};context.mountStickerRequests({button,document,api:context.api,site:()=>({id:selected,name:'가상 현장'}),currentSite:()=>selected,siteSelect,confirm:()=>true});
  ui.select=id=>{selected=id;siteSelect.change();};
  ui.api=context.api;ui.open=async()=>{await button.onclick();ui.dialog=dialogs.at(-1);ui.form=ui.dialog.querySelector('form');ui.form.values={...values};ui.form.reset=()=>{resets++;ui.form.values={quantity:'1'};};ui.message=ui.dialog.querySelector('[data-status]');};
  ui.save=()=>ui.form.onsubmit({preventDefault(){}});return ui;
}

test('실제 API 401: 스티커 창의 모든 입력·동의를 보존하고 재로그인 안내 후 같은 값으로 재시도한다',async()=>{
  const ui=screen();await ui.open();assert.equal(ui.main.open,false);
  ui.reply=async()=>response(401);await ui.save();
  assert.deepEqual(ui.redirects,[]);assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.isConnected,true);assert.deepEqual(ui.form.values,values);assert.equal(ui.resets(),0);assert.match(ui.message.textContent,/다른 탭에서 다시 로그인한 뒤 저장/);
  const failed=JSON.parse(ui.calls.at(-1).options.body);assert.deepEqual(failed,{...values,quantity:2,consent:true});
  ui.reply=async(_path,options)=>response(200,options.method?{}:[]);await ui.save();
  const posts=ui.calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,2);assert.deepEqual(JSON.parse(posts[1].options.body),failed);assert.equal(ui.resets(),1);assert.deepEqual(ui.form.values,{quantity:'1'});assert.match(ui.message.textContent,/처리했습니다/);assert.deepEqual(ui.redirects,[]);
});

test('실제 API 401: 기본 대화상자가 열려 있어도 기존 재로그인 안내를 유지한다',async()=>{
  const ui=screen();ui.main.open=true;ui.reply=async()=>response(401);
  await assert.rejects(ui.api('/api/sites'),/다른 탭에서 다시 로그인/);assert.deepEqual(ui.redirects,[]);assert.equal(ui.main.open,true);
});

test('실제 API 401: 열린 대화상자가 없거나 이미 닫혔으면 기존 로그인 이동을 유지한다',async()=>{
  for(const closed of [false,true]){const ui=screen();if(closed){await ui.open();ui.dialog.close();}ui.reply=async()=>response(401);
    await assert.rejects(ui.api('/api/sites'),/관리자 로그인이 필요/);assert.deepEqual(ui.redirects,['/login']);}
});

test('실제 API 401: 요청 후 창이 닫혀 범위가 만료된 오래된 응답은 무시한다',async()=>{
  const ui=screen();await ui.open();let release;ui.reply=()=>new Promise(resolve=>{release=resolve;});
  const pending=ui.api('/api/sites',{},()=>ui.dialog.isConnected&&ui.dialog.open);ui.dialog.close();release(response(401));
  assert.equal(await pending,undefined);assert.deepEqual(ui.redirects,[]);assert.equal(ui.dialog.open,false);assert.deepEqual(ui.form.values,values);assert.equal(ui.resets(),0);
});

for(const method of ['GET','POST','PUT','DELETE'])for(const change of ['닫기','현장 왕복'])test(`스티커 실제 ${method}: ${change} 뒤 늦은 401은 새 화면을 이동하거나 오류를 표시하지 않는다`,async()=>{
  const ui=screen(),row={id:1,status:'received',version:'v1',...values};ui.reply=async()=>response(200,[row]);await ui.open();
  const oldDialog=ui.dialog,oldForm=ui.form,oldMessage=ui.message,card=oldDialog.querySelector('[data-list]').querySelector('[data-id="1"]');card.querySelector('select').value='processing';
  let release;
  ui.reply=()=>new Promise(resolve=>{release=resolve;});
  const request=method==='GET'?oldDialog.querySelector('[data-refresh]').onclick():method==='POST'?ui.save():card.querySelector(method==='PUT'?'[data-save]':'[data-delete]').onclick();
  assert.equal(ui.calls.at(-1).options.method||'GET',method);
  if(change==='닫기')oldDialog.close();else{ui.select(2);ui.select(1);}
  ui.reply=async()=>response(200,[]);
  release(response(401));
  if(request)await request;else await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.redirects,[]);assert.equal(oldDialog.open,false);assert.equal(oldDialog.isConnected,false);assert.equal(oldMessage.textContent,'처리 중입니다.');assert.deepEqual(oldForm.values,values);assert.equal(ui.resets(),0);assert.equal(ui.dialog.open,false);assert.deepEqual(ui.form.values,values);
});
