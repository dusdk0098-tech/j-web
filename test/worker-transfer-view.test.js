import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerTransfer} from '../public/worker-transfer-view.js';

function fixture(api){
 const names=['[data-source]','[data-target]','[data-preview]','[data-result]','[data-sign]','[data-submit]','[data-clear]','[data-refresh]','canvas','[data-sign-title]'];
 const nodes=Object.fromEntries(names.map(name=>[name,{value:'',disabled:false,hidden:false,textContent:'',style:{},selectedOptions:[{textContent:'가상 대상'}],click(){this.onclick?.();}}]));
 const panel={isConnected:true,innerHTML:'',querySelector:key=>nodes[key]};let completed=null,cleared=0,refreshed=0;
 const esc=value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 mountWorkerTransfer({panel,rows:[{id:1,name:'<기존>',company:'가상'},{id:2,name:'대상',company:'가상'}],siteId:3,date:'2026-11-01',esc,api,signaturePad:(_canvas,clear)=>{clear.onclick=()=>cleared++;return()=>'가상 서명';},current:()=>true,onComplete:async result=>{completed=result;},onRefresh:()=>{refreshed++;}});
 return {panel,nodes,get completed(){return completed;},get cleared(){return cleared;},get refreshed(){return refreshed;}};
}
const valid={siteId:3,sourceId:1,targetId:2,date:'2026-11-01',version:'가상',counts:{attendance:1,meals:2},conflicts:[]};

test('출역 전환 화면은 영향과 대상자를 확인하고 실패한 요청을 같은 내용으로 재시도한다',async()=>{
 const requests=[],f=fixture(async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});if(path.endsWith('/preview'))return valid;if(requests.filter(x=>x.path.endsWith('/transfers')).length===1)throw Error('연결 오류');return {id:7};});
 assert.match(f.panel.innerHTML,/&lt;기존&gt;/);const n=f.nodes;n['[data-source]'].value='1';n['[data-target]'].value='2';await n['[data-preview]'].onclick();assert.match(n['[data-result]'].textContent,/출역 1건 · 식대 2건/);assert.equal(n['[data-sign]'].hidden,false);
 await n['[data-submit]'].onclick();assert.match(n['[data-result]'].textContent,/같은 요청으로 다시 시도/);assert.equal(n['[data-source]'].disabled,true);assert.equal(n['[data-refresh]'].hidden,false);n['[data-refresh]'].onclick();assert.equal(f.refreshed,1);await n['[data-submit]'].onclick();
 const writes=requests.filter(x=>x.path.endsWith('/transfers'));assert.deepEqual(writes[0].body,writes[1].body);assert.equal(f.completed.id,7);
});

test('미리보기 중 선택이 바뀌면 이전 응답으로 서명을 열지 않는다',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;})),n=f.nodes;n['[data-source]'].value='1';n['[data-target]'].value='2';const pending=n['[data-preview]'].onclick();n['[data-target]'].value='1';n['[data-target]'].onchange();finish(valid);await pending;assert.equal(n['[data-sign]'].hidden,true);assert.equal(n['[data-result]'].textContent,'');
});

test('같은 출입자와 충돌 기록은 전환을 허용하지 않는다',async()=>{
 const f=fixture(async()=>({...valid,conflicts:['meals']})),n=f.nodes;n['[data-source]'].value='1';n['[data-target]'].value='1';await n['[data-preview]'].onclick();assert.match(n['[data-result]'].textContent,/서로 다른/);n['[data-target]'].value='2';await n['[data-preview]'].onclick();assert.match(n['[data-result]'].textContent,/중복: 식대/);assert.equal(n['[data-sign]'].hidden,true);
});

test('전환 이력은 선택한 날짜만 조회하고 상세에 보존된 기록자를 텍스트로 표시한다',async()=>{
 const {mountWorkerTransferHistory}=await import('../public/worker-transfer-view.js');
 const element=()=>({textContent:'',children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;this.textContent='';}}),nodes=Object.fromEntries(['[data-status]','[data-list]','[data-detail]','[data-reload]'].map(key=>[key,element()])),panel={isConnected:true,innerHTML:'',querySelector:key=>nodes[key]},old=globalThis.document,requests=[];
 globalThis.document={createElement:element};try{
  const api=async path=>{requests.push(path);return path.includes('/7?')?{id:7,source_name:'<이전>',target_name:'대상',records:[{kind:'notices',record_key:'[4]',original_name:'<기록자>',has_signature:1,record:{document_title:'<가상 공지>'}}]}:[{id:7,created_at:'가상 시각',source_name:'<이전>',target_name:'대상',actor_name:'관리자'}];};
  mountWorkerTransferHistory({panel,siteId:3,date:'2026-11-01',api,current:()=>true});await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(requests[0],/siteId=3&date=2026-11-01/);assert.equal(nodes['[data-status]'].textContent,'1건');const line=nodes['[data-list]'].children[0];assert.match(line.textContent,/<이전>/);await line.children[0].onclick();
  const detail=nodes['[data-detail]'];assert.match(detail.children[0].textContent,/<이전>/);assert.match(detail.children[1].href,/signature\?siteId=3/);assert.match(detail.children[2].children[1].textContent,/<기록자>/);assert.match(detail.children[2].children[2].textContent,/<가상 공지>/);assert.match(detail.children[2].children[3].href,/kind=notices/);
 }finally{globalThis.document=old;}
});

test('전환 요청 번호는 보안 연결 여부와 관계없이 난수로 UUID 형식을 만든다',async()=>{
 const {newTransferId}=await import('../public/worker-transfer-view.js');const id=newTransferId({getRandomValues:bytes=>bytes.fill(255)});
 assert.equal(id,'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
