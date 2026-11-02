import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {locationMapUrl} from '../public/worker-location.js';

test('유효한 좌표만 안전하게 지도 주소로 바꾼다',()=>{
  for(const [lat,lon] of [[0,0],[-90,-180],[90,180],[37.125,-122.75]]){
    const url=new URL(locationMapUrl(lat,lon));
    assert.equal(url.origin,'https://www.google.com');
    assert.equal(url.pathname,'/maps/search/');
    assert.equal(url.searchParams.get('api'),'1');
    assert.equal(url.searchParams.get('query'),lat+','+lon);
  }
  for(const [lat,lon] of [[null,0],[0,null],[NaN,0],[Infinity,0],[0,-Infinity],[-91,0],[91,0],[0,-181],[0,181],['0',0],[0,'"><script>']])assert.equal(locationMapUrl(lat,lon),'');
});

async function screen(deleteRequest=async()=>({ok:true})){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf("  if(state.page==='worker-locations'){"),end=source.indexOf("  if(state.page==='worker-permissions'){",start);assert.ok(start>=0&&end>start);
  const calls=[],errors=[],state={page:'worker-locations',siteId:7,workerLocationDate:'2026-11-02'},form={elements:{enabled:{checked:false},latitude:{},longitude:{},radiusMeters:{},maxAccuracyMeters:{}},querySelector:()=>({disabled:false})};
  const button={dataset:{locationDelete:'12',locationVersion:'a'.repeat(32)},disabled:false},nodes={'#location-policy':form,'#location-search':{},'#location-date':{value:'2026-11-02'}};
  const content={innerHTML:'',insertAdjacentHTML(_position,html){this.innerHTML+=html;},querySelectorAll:selector=>selector==='[data-location-delete]'?[button]:[]};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context={state,content,detailEpoch:4,locationMapUrl,esc,today:()=>'2026-11-02',$:key=>nodes[key],confirm:()=>true,render:async()=>{context.renders++;},renders:0,showError:error=>errors.push(error.message),api:async(path,options={})=>{
    calls.push({path,options});
    if(options.method==='DELETE')return deleteRequest(path,options);
    if(path.endsWith('/location-policy'))return {enabled:false,version:null};
    if(path.includes('/location-events?'))return [{id:12,version:'a'.repeat(32),name:'가상 <이름>',latitude:0,longitude:0,accuracy_meters:2,distance_meters:3,checked_at:1}];
    if(path.includes('/worker-departures?'))return [{id:2,version:'b'.repeat(32),name:'가상 근로자',latitude:37.125,longitude:-122.75,accuracy_meters:2,distance_meters:3,checked_at:1},{id:3,version:'c'.repeat(32),name:'가상 둘째',latitude:null,longitude:null,accuracy_meters:null,distance_meters:null,checked_at:1}];
    if(path.includes('/worker-arrivals?'))return [];
    throw Error('예상하지 못한 요청');
  }};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  return {context,content,state,button,calls,errors};
}

test('위치와 퇴근 화면은 좌표가 있는 행에만 지도 링크를 표시한다',async()=>{
  const ui=await screen(),html=ui.content.innerHTML;
  assert.equal((html.match(/>구글 지도<\/a>/g)||[]).length,2);
  assert.match(html,/href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=0%2C0" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/query=37\.125%2C-122\.75/);assert.match(html,/위치 기록 없음/);
  assert.match(html,/가상 &lt;이름&gt;/);assert.doesNotMatch(html,/<이름>/);
  assert.match(html,/data-location-version="a{32}"/);
  assert.ok(ui.calls.every(call=>call.path.startsWith('/api/sites/7/')));
  await ui.button.onclick();
  assert.equal(ui.calls.at(-1).path,'/api/sites/7/location-events/12?version='+'a'.repeat(32));
  assert.equal(ui.calls.at(-1).options.method,'DELETE');assert.equal(ui.context.renders,1);
});

test('오래된 위치 삭제 응답은 다른 날짜 화면이나 오류 표시를 바꾸지 않는다',async()=>{
  for(const fail of [false,true]){
    let resolve,reject;const pending=new Promise((ok,bad)=>{resolve=ok;reject=bad;});
    const ui=await screen(()=>pending),clicked=ui.button.onclick();ui.state.workerLocationDate='2026-11-03';
    if(fail)reject(new Error('가상 이전 오류'));else resolve({ok:true});
    await clicked;assert.equal(ui.context.renders,0);assert.deepEqual(ui.errors,[]);
    if(fail)assert.equal(ui.button.disabled,false);
  }
});

test('이전 위치 조회의 인증 오류는 현장·날짜·계정 전환 후 로그인 화면으로 보내지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),apiStart=source.indexOf('async function api('),apiEnd=source.indexOf('function flash(',apiStart),start=source.indexOf("  if(state.page==='worker-locations'){"),end=source.indexOf("  if(state.page==='worker-permissions'){",start);
  assert.ok(apiStart>=0&&apiEnd>apiStart&&start>=0&&end>start);
  for(const change of ['site','date','account','page','epoch']){
    const waits=[],redirects=[],state={page:'worker-locations',siteId:7,workerLocationDate:'2026-11-02',admin:{id:1}},content={innerHTML:'현재 화면'};
    const context={state,content,detailEpoch:4,today:()=>'2026-11-02',locationMapUrl,location:{assign:path=>redirects.push(path)},dialog:{open:false},document:{querySelector:()=>null},fetch:()=>new Promise(resolve=>waits.push(resolve))};
    const pending=runInNewContext(source.slice(apiStart,apiEnd)+'\n(async()=>{'+source.slice(start,end)+'})()',context);assert.equal(waits.length,4);
    if(change==='site')state.siteId=8;else if(change==='date')state.workerLocationDate='2026-11-03';else if(change==='account')state.admin={id:2};else if(change==='page')state.page='workers';else context.detailEpoch++;
    for(const done of waits)done({status:401,ok:false,json:async()=>({error:'이전 세션 오류'})});
    await pending;assert.deepEqual(redirects,[]);assert.equal(content.innerHTML,'현재 화면');
  }
});

test('이전 위치 삭제의 인증 오류는 새 화면으로 전파하지 않는다',async()=>{
  const ui=await screen(),source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function api('),end=source.indexOf('function flash(',start),redirects=[];let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  ui.context.api=runInNewContext(source.slice(start,end)+'\napi',{fetch:()=>pending,dialog:{open:false},document:{querySelector:()=>null},location:{assign:path=>redirects.push(path)}});
  const deleting=ui.button.onclick();ui.state.workerLocationDate='2026-11-03';finish({status:401,ok:false,json:async()=>({error:'이전 세션 오류'})});await deleting;
  assert.deepEqual(redirects,[]);assert.deepEqual(ui.errors,[]);assert.equal(ui.context.renders,0);
});
