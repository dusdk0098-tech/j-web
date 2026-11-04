import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('안전관리비 검색은 항목·내역·비고를 찾고 월 전체 합계를 유지한다',async()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf("  if(state.page==='safety-costs'){"),end=code.indexOf("  if(state.page==='rigging'){",start);
  assert.ok(start>=0&&end>start);
  const data={total:'3000',rows:[{id:1,date:'2026-10-01',category:1,description:'가상 장갑',note:'빨강',unit_price:'1000',quantity:'1',unit:'개',amount:'1000'},{id:2,date:'2026-10-02',category:2,description:'가상 모자',note:'파랑',unit_price:'2000',quantity:'1',unit:'개',amount:'2000'}]};
  async function check(keyword,expected,absent){
    const nodes={'#cost-search':{insertAdjacentHTML(_where,html){this.html=html;}},'#cost-photos':{previousElementSibling:{}},'#new-cost':{},'#new-cost-report':{},'#cost-month-file-add':{}};
    const content={innerHTML:'',querySelector:()=>({insertAdjacentHTML(){}}),querySelectorAll:()=>[]};
    const context={detailEpoch:1,state:{page:'safety-costs',siteId:7,costMonth:'2026-10',costKeyword:keyword},content,api:async path=>path.includes('month-files')?[]:structuredClone(data),today:()=>'',costCategories:['보호구','안전시설'],esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),$:key=>nodes[key],document:{querySelectorAll:()=>[]},showDialog(){},field(){},render:async()=>{},showError(){},encodeURIComponent};
    await runInNewContext('(async()=>{'+code.slice(start,end)+'})()',context);
    assert.match(content.innerHTML,/해당 월 합계: 3000원/);assert.ok(content.innerHTML.includes(expected));assert.ok(!content.innerHTML.includes(absent));return nodes;
  }
  await check('보호구','가상 장갑','가상 모자');await check('모자','가상 모자','가상 장갑');await check('빨강','가상 장갑','가상 모자');
  const nodes=await check('없는 검색어','등록된 시험 사용내역이 없습니다.','가상 장갑');assert.match(nodes['#cost-photos'].previousElementSibling.textContent,/검색 조건/);
  const escaped=await check('<"','등록된 시험 사용내역이 없습니다.','가상 장갑');assert.match(escaped['#cost-search'].html,/&lt;&quot;/);
});

test('관리비 검색은 독립 증빙과 결재서류의 설명·비고도 제한하고 원본 목록은 유지한다',async()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf("  if(state.page==='safety-costs'){"),end=code.indexOf("  if(state.page==='rigging'){",start),files=[{id:1,kind:'evidence',date:'2026-10-01',description:'가상 난간',note:'현장 사진',name:'a.png'},{id:2,kind:'approval',date:'2026-10-02',description:'가상 보고',note:'결재 메모',name:'b.png'}];
  async function check(keyword){let section='';const nodes={'#cost-search':{insertAdjacentHTML(){}},'#cost-photos':{previousElementSibling:{}},'#new-cost':{},'#new-cost-report':{},'#cost-month-file-add':{}},content={innerHTML:'',querySelector:()=>({insertAdjacentHTML(_where,html){section+=html;}}),querySelectorAll:()=>[]};
    const context={detailEpoch:1,state:{page:'safety-costs',siteId:7,costMonth:'2026-10',costKeyword:keyword},content,api:async path=>path.includes('month-files')?files:{total:'0',rows:[]},today:()=>'',costCategories:[],esc:String,$:key=>nodes[key],document:{querySelectorAll:()=>[]},showDialog(){},field(){},render:async()=>{},showError(){},encodeURIComponent};await runInNewContext('(async()=>{'+code.slice(start,end)+'})()',context);return section;}
  let html=await check('난간');assert.match(html,/가상 난간/);assert.doesNotMatch(html,/가상 보고/);html=await check('결재 메모');assert.match(html,/가상 보고/);assert.doesNotMatch(html,/가상 난간/);html=await check('없는 내용');assert.match(html,/검색 조건에 맞는 시험 자료가 없습니다/);assert.equal(files.length,2);html=await check('');assert.match(html,/가상 난간/);assert.match(html,/가상 보고/);
});

test('안전관리비의 늦은 검색과 사진 응답은 마지막 화면을 덮지 않는다',async()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf("  if(state.page==='safety-costs'){"),end=code.indexOf("  if(state.page==='rigging'){",start),run='(async()=>{'+code.slice(start,end)+'})()',data={total:'3000',rows:[{id:1,date:'2026-10-01',category:1,description:'첫 내역'},{id:2,date:'2026-10-02',category:1,description:'둘째 내역'}]},buttons=[{dataset:{costPhotos:'1'}},{dataset:{costPhotos:'2'}}],panel={isConnected:true,innerHTML:'',previousElementSibling:{},querySelector:()=>({}),querySelectorAll:()=>[]},nodes={'#cost-search':{insertAdjacentHTML(){}},'#cost-photos':panel,'#new-cost':{},'#new-cost-report':{},'#cost-month-file-add':{}},content={innerHTML:'',querySelector:()=>({insertAdjacentHTML(){}}),querySelectorAll:()=>[]};let releaseList,releasePhoto,delayList=true;const pendingList=new Promise(resolve=>releaseList=resolve),pendingPhoto=new Promise(resolve=>releasePhoto=resolve),errors=[];
  const context={detailEpoch:1,state:{page:'safety-costs',siteId:7,costMonth:'2026-10',costKeyword:''},content,api:async path=>path.includes('/1/photos')?pendingPhoto:path.includes('/2/photos')?[]:path.includes('month-files')?[]:delayList?pendingList:structuredClone(data),today:()=>'',costCategories:['보호구'],esc:String,$:key=>nodes[key],document:{querySelectorAll:selector=>selector==='[data-cost-photos]'?buttons:[]},showDialog(){},field(){},render:async()=>{},showError:error=>errors.push(error),encodeURIComponent};assert.ok(start>=0&&end>start);
  const old=runInNewContext(run,context);context.detailEpoch++;context.state.costKeyword='둘째';delayList=false;await runInNewContext(run,context);assert.match(content.innerHTML,/둘째 내역/);assert.doesNotMatch(content.innerHTML,/첫 내역/);releaseList(structuredClone(data));await old;assert.match(content.innerHTML,/둘째 내역/);assert.doesNotMatch(content.innerHTML,/첫 내역/);
  context.state.costKeyword='';context.detailEpoch++;await runInNewContext(run,context);const first=buttons[0].onclick();await buttons[1].onclick();assert.match(panel.innerHTML,/둘째 내역/);releasePhoto([]);await first;assert.match(panel.innerHTML,/둘째 내역/);assert.doesNotMatch(panel.innerHTML,/첫 내역/);assert.deepEqual(errors,[]);
});
