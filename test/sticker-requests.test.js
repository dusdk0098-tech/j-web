import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { StickerRequests } from '../sticker-requests.js';
import { mountStickerRequests } from '../public/sticker-requests.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const input={address:'가상 시험 주소',detail:'가상 상세',recipient:'가상 수령인',phone:'000-0000-0000',quantity:1,note:'가상 비고',consent:true};

test('스티커 DB: 필수값, 서버 현장명, 현장 경계, 잠금 후 인증, 버전, 재시작 보존과 삭제',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sticker-db-')),path=join(dir,'db.sqlite');let store;
  try{
    store=new Store(path);let requests=new StickerRequests(store.db);const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 가상 현장'});
    for(const invalid of [{address:''},{recipient:''},{phone:'abc'},{quantity:0},{quantity:21},{quantity:1.5},{quantity:'1'},{consent:false},{consent:'true'},{note:'x'.repeat(1001)}])assert.throws(()=>requests.create(site.id,{...input,...invalid}));
    let authorized=0;assert.throws(()=>requests.create(site.id,input,()=>{authorized++;assert.equal(store.db.isTransaction,true);throw Error('세션 만료');}),/세션/);assert.equal(authorized,1);assert.equal(requests.list(site.id).length,0);
    let row=requests.create(site.id,{...input,siteName:'조작',quantity:20});assert.equal(row.site_name,'가상 현장');assert.equal(row.quantity,20);assert.equal(requests.list(other.id).length,0);
    assert.throws(()=>requests.change(other.id,row.id,{version:row.version,status:'processing'}),/현장/);assert.throws(()=>requests.change(site.id,row.id,{version:row.version,status:'invalid'}),/상태/);
    for(const remove of [false,true])assert.throws(()=>requests.change(site.id,row.id,{version:row.version,status:'processing'},remove,()=>{assert.equal(store.db.isTransaction,true);throw Error('세션 만료');}),/세션/);
    const old=row.version;row=requests.change(site.id,row.id,{version:old,status:'processing'});assert.notEqual(row.version,old);for(const remove of [false,true])assert.throws(()=>requests.change(site.id,row.id,{version:old,status:'completed'},remove),e=>e.sessionStatus===409);
    store.close();store=new Store(path);requests=new StickerRequests(store.db);row=requests.list(site.id)[0];assert.equal(row.address,input.address);assert.equal(row.status,'processing');
    for(const status of ['completed','cancelled','received'])row=requests.change(site.id,row.id,{version:row.version,status});
    requests.change(site.id,row.id,{version:row.version},true);assert.equal(requests.list(site.id).length,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM sticker_requests').get().n,0);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('스티커 HTTP: 관리자 전용 접수·조회·수동 상태·삭제 및 현장/버전 검증',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sticker-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'가상 다른 현장'},admin)).json(),path=`/api/sites/${site.id}/sticker-requests`;
    for(const method of ['GET','POST'])assert.equal((await call(path,method,method==='POST'?input:undefined)).status,401);
    assert.equal((await call(path,'POST',{...input,consent:false},admin)).status,400);const created=await call(path,'POST',input,admin);assert.equal(created.status,201);let row=await created.json();assert.equal(row.site_name,'가상 현장');assert.equal((await call(path,'GET',undefined,admin)).headers.get('cache-control'),'no-store');
    for(const method of ['PUT','DELETE'])assert.equal((await call(`${path}/${row.id}`,method,{version:row.version,status:'processing'})).status,401);
    assert.equal((await call(`/api/sites/${other.id}/sticker-requests/${row.id}`,'DELETE',{version:row.version},admin)).status,400);
    const old=row.version,updated=await call(`${path}/${row.id}`,'PUT',{version:old,status:'processing'},admin);assert.equal(updated.status,200);row=await updated.json();assert.equal(row.status,'processing');
    for(const method of ['PUT','DELETE'])assert.equal((await call(`${path}/${row.id}`,method,{version:old,status:'completed'},admin)).status,409);
    assert.equal((await call(`${path}/${row.id}`,'DELETE',{version:row.version},admin)).status,200);assert.equal((await (await call(path,'GET',undefined,admin)).json()).length,0);
    assert.equal((await call('/sticker-requests.js','GET',undefined,admin)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('스티커 UI 가상 DOM: 빈 입력·동의·수량 안내, 현장 전환 늦은 응답 차단',async()=>{
  const elements=new Map(),get=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:''});return elements.get(selector);};
  const dialog={isConnected:false,open:false,innerHTML:'',querySelector:get,showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.isConnected=false;}},document={createElement:()=>dialog,body:{append(node){node.isConnected=true;}}},button={},siteSelect={addEventListener(event,callback){this.change=callback;}};let selected=1,release;
  mountStickerRequests({button,document,siteSelect,site:()=>({id:selected,name:'가상 <현장>'}),currentSite:()=>selected,api:()=>new Promise(resolve=>{release=resolve;})});
  const pending=button.onclick();assert.match(dialog.innerHTML,/업체 전송/);assert.match(dialog.innerHTML,/name="address" maxlength="300" required/);assert.match(dialog.innerHTML,/name="consent" type="checkbox" required/);assert.match(dialog.innerHTML,/min="1" max="20"/);assert.match(dialog.innerHTML,/가상 &lt;현장&gt;/);
  selected=2;siteSelect.change();selected=1;release([]);await pending;assert.equal(dialog.isConnected,false);assert.equal(get('[data-list]').innerHTML,'');
});

test('스티커 UI 가상 DOM: 접수 데이터 변환, 수동 상태 저장, 개인정보 삭제',async()=>{
  const node=()=>({innerHTML:'',textContent:'',children:new Map(),querySelector(selector){if(!this.children.has(selector))this.children.set(selector,node());return this.children.get(selector);}}),dialog=node();Object.assign(dialog,{isConnected:false,open:false,showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.isConnected=false;}});
  const document={createElement:()=>dialog,body:{append(element){element.isConnected=true;}}},button={},siteSelect={addEventListener(){}},calls=[];let rows=[],resets=0;
  const api=async(path,options={})=>{const data=options.body&&JSON.parse(options.body);calls.push({path,method:options.method||'GET',data});if(options.method==='POST')rows=[{id:1,site_name:'가상 현장',created_at:'시험',...input,version:'v1',status:'received'}];if(options.method==='PUT')rows=[{...rows[0],status:data.status,version:'v2'}];if(options.method==='DELETE')rows=[];return rows;};
  mountStickerRequests({button,document,siteSelect,site:()=>({id:5,name:'가상 현장'}),currentSite:()=>5,api,confirm:()=>true});await button.onclick();
  const form=dialog.querySelector('form');form.reset=()=>resets++;const Original=globalThis.FormData;globalThis.FormData=class{constructor(){return new Map(Object.entries({...input,quantity:'1',consent:'on'}));}};
  try{await form.onsubmit({preventDefault(){}});}finally{globalThis.FormData=Original;}
  const sent=calls.find(call=>call.method==='POST');assert.equal(sent.path,'/api/sites/5/sticker-requests');assert.equal(sent.data.consent,true);assert.equal(sent.data.quantity,1);assert.equal(resets,1);
  const list=dialog.querySelector('[data-list]'),card=list.querySelector('[data-id="1"]');card.querySelector('select').value='processing';await card.querySelector('[data-save]').onclick();assert.deepEqual(calls.find(call=>call.method==='PUT').data,{version:'v1',status:'processing'});
  card.querySelector('[data-delete]').onclick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.find(call=>call.method==='DELETE').data,{version:'v2'});assert.match(list.innerHTML,/신청 내역이 없습니다/);
});
