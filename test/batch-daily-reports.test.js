import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {siteReportsForDay,dailyBatchReport,mountSiteBatchResults,selectBatchItems,reloadDailyBatchRows} from '../public/batch-print.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const site={id:1,name:'<가상 현장>'},date='2026-11-01';
test('당일 보호구 재집계·전체 내역과 두 현장 출역 스냅샷을 구분한다',async()=>{
  const paths=[],worker={name:'<시험>',category:'근로자',company:'가상',occupation:'가상직종'},rows=Array.from({length:23},(_,i)=>({date,item:'안전모',quantity:i+1,worker}));
  const reports=await siteReportsForDay([site,{id:2,name:'둘째'}],date,async path=>{paths.push(path);if(path.startsWith('/api/workers/joined-on')||path.includes('/print-self-checks'))return [];return path.startsWith('/api/ppe')?{rows:[...rows,{date:'2026-11-02',item:'안전화',quantity:900,worker}],totals:[{item:'틀린 월 합계',quantity:999}]}:[{name:'<시험>',present:1,company:'현재',occupation:'현재',attendance_category:'과거구분',attendance_company:'과거소속',attendance_occupation:'과거직종',units_hundredths:0},{name:'미기록자',present:1,units_hundredths:null},{name:'미출역자',present:0,units_hundredths:999}];});
  assert.equal(reports.length,6);assert.deepEqual(reports[0].rows,[{item:'안전모',quantity:276}]);assert.equal(reports[1].rows.length,23);assert.equal(reports[2].rows.length,2);assert.equal(reports[3].site.id,2);
  assert.ok(paths.includes('/api/ppe-issues?siteId=2&month=2026-11'));assert.ok(paths.includes('/api/attendance?siteId=1&date=2026-11-01'));
  const html=dailyBatchReport(reports[2],esc);assert.match(html,/과거소속/);assert.match(html,/>0.00</);assert.match(html,/공수 미기록 1명/);assert.match(html,/&lt;시험&gt;/);assert.doesNotMatch(html,/미출역자|>현재<|<시험>/);
  assert.equal((dailyBatchReport(reports[1],esc).match(/<tr>/g)||[]).length,24);
  assert.match(dailyBatchReport({...reports[0],rows:[]},esc),/기록이 없습니다/);
  assert.throws(()=>selectBatchItems(Array.from({length:18},(_,i)=>({id:i+1})),reports,Array.from({length:18},(_,i)=>i+1),[1,2,3]),/20개/);
  await assert.rejects(()=>siteReportsForDay([site],date,async()=>{throw Error('권한 없음');}),/권한 없음/);
});

function harness(api,preview=()=>{}){
  const nodes=Object.fromEntries(['site-print-date','site-print-search','site-print-all','site-print-preview','site-print-select-all'].map(id=>['#'+id,{value:date,disabled:false}])),inputs=[{dataset:{printSite:'1'},checked:true}],errors=[],state={};let live=true;
  const target={isConnected:true,innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll:()=>[]};
  const content={querySelector:id=>nodes[id],querySelectorAll:query=>query.includes(':checked')?inputs.filter(input=>input.checked):inputs};
  mountSiteBatchResults({content,target,sites:[site],state,api,current:()=>live,esc,preview,onError:error=>errors.push(error.message)});
  return {nodes,inputs,target,errors,state,stop(){live=false;}};
}
test('조회 A→B→A 및 겹친 요청·오래된 오류가 새 결과를 덮지 않는다',async()=>{
  const pending=[];const h=harness(path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject})));
  const first=h.nodes['#site-print-search'].onclick();assert.equal(pending.length,5);
  h.nodes['#site-print-date'].value='2026-11-02';h.nodes['#site-print-date'].onchange();h.nodes['#site-print-date'].value=date;h.nodes['#site-print-date'].onchange();
  const next=h.nodes['#site-print-search'].onclick();
  for(const request of pending.slice(5))request.resolve(request.path.startsWith('/api/ppe')?{rows:[]}:[]);await next;
  const html=h.target.innerHTML;assert.match(html,/보호구 당일 요약/);assert.match(html,/출역일보/);
  pending[0].reject(Error('오래된 권한 오류'));pending[1].resolve({rows:[]});pending[2].resolve([]);pending[3].resolve([]);pending[4].resolve([]);await first;
  assert.equal(h.target.innerHTML,html);assert.deepEqual(h.errors,[]);
  const failed=harness(async()=>{throw Error('로그인 만료');});await failed.nodes['#site-print-search'].onclick();assert.deepEqual(failed.errors,['로그인 만료']);assert.equal(failed.target.innerHTML,'');
  const changed=harness(async path=>{changed.stop();return path.startsWith('/api/ppe')?{rows:[]}:[];});await changed.nodes['#site-print-search'].onclick();assert.equal(changed.target.innerHTML,'');
});

function previewContext(api){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start),nodes={},groups=[],errors=[],state={page:'site-print',siteId:1,detail:null,admin:{id:1}},images=[];
  let prints=0;
  const content={children:[],style:{},append(){},querySelectorAll:()=>images},document={body:{inert:false},createDocumentFragment:()=>({querySelectorAll:()=>[],append:group=>groups.push(group)}),createElement:()=>({})};
  const context={freezeBatchImages:async()=>({dispose(){},check:async()=>{}}),detailEpoch:0,state,content,document,reloadDailyBatchRows,api:path=>path.startsWith('/api/ppe-issues')?Promise.resolve({rows:[]}):api(path),adminSession:Promise.resolve({context:'virtual-context'}),esc,dailyBatchReport,$:id=>nodes[id]??={},flash(){},showError:error=>errors.push(error.message),window:{print(){prints++;}},render:async()=>{}};
  runInNewContext(source.slice(start,end),context);return {context,nodes,groups,errors,images,prints:()=>prints};
}
const report={id:1,kind:'ppe-summary',title:'보호구 당일 요약',rows:[],site,date};
test('선택 미리보기 실패 후 자기 목록 복구는 오류를 표시하고 다른 화면 이동은 보호한다',async()=>{
  for(const mode of ['permission','document']){
    const p=previewContext(async()=>{if(mode==='document')return {authenticated:true,admin:{scope:'global'},context:'virtual-context'};throw Error('현재 권한 실패');}),h=harness(async path=>path.startsWith('/api/ppe')?{rows:[]}:[],()=>p.context.showBatchPreview(mode==='document'?[7]:[],[],1,false,mode==='document'?[{id:7,site_id:1}]:null,false,mode==='document'?[]:[report]));
    p.context.renderDetail=async()=>{throw Error('현재 문서 조회 실패');};
    p.context.render=async()=>{p.context.detailEpoch++;h.stop();h.target.isConnected=false;};
    await h.nodes['#site-print-search'].onclick();
    h.target.querySelectorAll=query=>query==='[data-print-report]:checked'?[{dataset:{printReport:'1'}}]:[];
    await h.nodes['#site-print-preview'].onclick();
    assert.equal(p.context.detailEpoch,1);assert.deepEqual(p.errors,[mode==='document'?'현재 문서 조회 실패':'현재 권한 실패']);assert.deepEqual(h.errors,[]);assert.equal(p.context.document.body.inert,false);
  }
  const moved=previewContext(async()=>{throw Error('오래된 실패');});let finish;
  moved.context.render=()=>{moved.context.detailEpoch++;return new Promise(resolve=>{finish=resolve;});};
  const pending=moved.context.showBatchPreview([],[],1,false,null,false,[report]);
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  moved.context.state.page='workers';moved.context.detailEpoch++;finish();await pending;
  assert.deepEqual(moved.errors,[]);assert.equal(moved.context.state.page,'workers');
});
test('보고서 단독 미리보기는 권한 오류·관리자 변경·미준비 이미지를 인쇄하지 않는다',async()=>{
  let allowed=true,calls=0;const h=previewContext(async()=>{calls++;if(!allowed)throw Error('권한 없음');return {authenticated:true,admin:{scope:'global'},context:'virtual-context'};});
  await h.context.showBatchPreview([],[],1,false,null,false,[report]);assert.equal(h.groups.length,1);assert.equal(calls,2);assert.equal(h.context.document.body.inert,false);
  h.images.push({complete:false,naturalWidth:0});await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),0);
  h.images.length=0;await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);
  allowed=false;await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);assert.deepEqual(h.errors,['권한 없음']);
  h.context.state.admin={id:2};await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);
  const changed=previewContext(async()=>{changed.context.state.admin={id:2};});await changed.context.showBatchPreview([],[],1,false,null,false,[report]);assert.equal(changed.groups.length,0);assert.equal(changed.context.document.body.inert,false);
  const denied=previewContext(async()=>{throw Error('로그인 만료');});await assert.rejects(()=>denied.context.showBatchPreview([],[],1,false,null,false,[report]),/로그인 만료/);assert.equal(denied.groups.length,0);assert.equal(denied.context.document.body.inert,false);
  for(const session of [{authenticated:false},{authenticated:true,admin:{scope:'restricted'},context:'virtual-context'},{authenticated:true,admin:{scope:'global'},context:'different-context'}]){const expired=previewContext(async()=>session);await assert.rejects(()=>expired.context.showBatchPreview([],[],1,false,null,false,[report]),/권한이 변경/);assert.equal(expired.groups.length,0);}
});
