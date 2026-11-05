import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(state.page==='equipment'){"),end=source.indexOf('    const edit=item=>',start);
assert.ok(start>0&&end>start);
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// shortcut: 검색 결과와 이벤트를 화면 대역으로 확인하며 실제 브라우저 배치는 별도 확인이 필요하다.
function screen(overrides={}){
 const actor={},state={page:'equipment',siteId:1,admin:actor,equipmentSearchSite:1,equipmentKind:'',equipmentQuery:'',...overrides},nodes={'#equipment-kind':{value:''},'#equipment-query':{value:''},'#equipment-search':{}},requests=[],content={innerHTML:'기존 화면'},errors=[];let renders=0;
 const context={state,content,esc,detailEpoch:1,renderEpoch:1,$:key=>nodes[key],api:(path,options,current)=>new Promise((resolve,reject)=>requests.push({path,current,resolve,reject})),render:async()=>{renders++;},showError:error=>errors.push(error.message)};
 runInNewContext('globalThis.run=async()=>{'+source.slice(start,end)+'}};',context);
 return {state,nodes,requests,content,context,errors,run:()=>context.run(),renders:()=>renders};
}
const items=[{id:1,kind:'굴착기',model:'ABC-10',capacity:'10톤',manufacturer:'가상 제조사',registration:'등록-1'},{id:2,kind:'크레인',model:'XYZ',capacity:'20톤',manufacturer:'다른 제조사',registration:'등록-2'},{id:3,kind:'굴착기',model:'<가상>',capacity:'5톤',manufacturer:'가상 제조사',registration:'등록-3'}];
test('장비 종류와 검색어를 함께 적용하고 화면의 문자를 보호한다',async()=>{
 const ui=screen({equipmentKind:'굴착기',equipmentQuery:'ABC'}),work=ui.run();assert.equal(ui.requests[0].path,'/api/equipment?siteId=1');ui.requests[0].resolve(items);await work;assert.match(ui.content.innerHTML,/ABC-10/);assert.doesNotMatch(ui.content.innerHTML,/XYZ|&lt;가상&gt;/);assert.match(ui.content.innerHTML,/굴착기/);
 const x=screen({equipmentQuery:'<가상>'}),pending=x.run();x.requests[0].resolve(items);await pending;assert.match(x.content.innerHTML,/&lt;가상&gt;/);assert.doesNotMatch(x.content.innerHTML,/<가상>/);
});
test('검색·종류 변경은 조건을 저장하고 한글 조합 중 엔터는 검색하지 않는다',async()=>{
 const ui=screen(),work=ui.run();ui.requests[0].resolve(items);await work;ui.nodes['#equipment-kind'].value='크레인';ui.nodes['#equipment-query'].value='등록-2';let prevented=0;ui.nodes['#equipment-query'].onkeydown({key:'Enter',isComposing:true,preventDefault(){prevented++;}});assert.equal(ui.renders(),0);ui.nodes['#equipment-query'].onkeydown({key:'Enter',isComposing:false,preventDefault(){prevented++;}});assert.equal(ui.state.equipmentKind,'크레인');assert.equal(ui.state.equipmentQuery,'등록-2');assert.equal(prevented,1);assert.equal(ui.renders(),1);
});
test('현장 변경 후 이전 결과와 오류를 무시하고 새 현장 검색을 초기화한다',async()=>{
 for(const failure of [false,true]){const ui=screen({equipmentKind:'굴착기',equipmentQuery:'가상'}),work=ui.run();ui.state.siteId=2;if(failure)ui.requests[0].reject(Error('이전 오류'));else ui.requests[0].resolve(items);await work;assert.equal(ui.content.innerHTML,'기존 화면');assert.equal(ui.requests[0].current(),false);const next=ui.run();assert.equal(ui.state.equipmentKind,'');assert.equal(ui.state.equipmentQuery,'');ui.requests[1].resolve([]);await next;assert.match(ui.content.innerHTML,/등록된 가상 장비가 없습니다/);}
});

test('실제 임시 서버의 현장 장비를 검색하고 다른 현장의 장비는 포함하지 않는다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-equipment-search-')),store=new Store(join(dir,'jweb.sqlite')),a=store.createSite({name:'가상 A'}),b=store.createSite({name:'가상 B'}),add=(siteId,kind,model)=>store.createEquipment({siteId,kind,model,capacity:'',manufacturer:'가상 제조사',registration:'가상 번호'});add(a.id,'굴착기','ABC');add(a.id,'크레인','XYZ');add(b.id,'굴착기','다른 현장');store.close();
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base='http://127.0.0.1:'+port,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-password-123'})}),cookie=login.headers.get('set-cookie').split(';')[0],path=base+'/api/equipment?siteId='+a.id;assert.equal((await fetch(path)).status,401);const rows=await (await fetch(path,{headers:{cookie}})).json(),ui=screen({siteId:a.id,equipmentSearchSite:a.id,equipmentKind:'굴착기',equipmentQuery:'abc'}),work=ui.run();ui.requests[0].resolve(rows);await work;assert.match(ui.content.innerHTML,/ABC/);assert.doesNotMatch(ui.content.innerHTML,/XYZ|다른 현장/);
 }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
});
