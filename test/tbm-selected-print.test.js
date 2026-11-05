import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {selectBatchDocuments} from '../public/batch-print.js';
import {prepareWorkerPdfs} from '../public/plan-pdf.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({images=[],detail}={}){
  const nodes={},flashes=[],seen=[],state={siteId:1,page:'documents',detail:null};let prints=0,restores=0;
  const content={children:[],style:{},append(){},querySelectorAll:()=>images};
  const document={body:{inert:false},createDocumentFragment:()=>({querySelectorAll:()=>[],append(){}}),createElement:()=>({append(){},prepend(){},querySelectorAll:()=>[]})};
  const context={freezeBatchImages:async()=>({dispose(){},check:async()=>{}}),api:async()=>({authenticated:true,admin:{scope:'global'},context:'batch-test'}),adminSession:Promise.resolve({context:'batch-test'}),showError:error=>flashes.push(error.message),detailEpoch:0,state,content,document,$:id=>nodes[id]??={},flash:message=>flashes.push(message),window:{print(){assert.equal(document.body.inert,false);assert.equal(content.style.visibility,'');prints++;}},render:async()=>{context.detailEpoch++;restores++;},renderDetail:async()=>{context.detailEpoch++;const id=state.detail,site_id=state.siteId;seen.push(id);return detail?detail(id):{id,site_id};}};
  context.prepareWorkerPdfs=prepareWorkerPdfs;
  runInNewContext(source.slice(start,end),context);
  return {context,state,nodes,flashes,seen,content,document,prints:()=>prints,restores:()=>restores,run:(auto=true)=>context.showBatchPreview([1,2],[],1,false,null,auto)};
}

test('선택 인쇄는 선택한 순서의 문서를 준비해 인쇄를 한 번 실행한다',async()=>{
  const h=harness({images:[{complete:true,naturalWidth:10,decode:async()=>{}}]});await h.run();assert.deepEqual(h.seen,[1,2]);assert.equal(h.prints(),1);assert.equal(h.state.detail,null);
});
test('기존 선택 미리보기는 자동 인쇄하지 않고 수동 인쇄를 유지한다',async()=>{
  const h=harness();await h.run(false);assert.equal(h.prints(),0);await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);
});
test('서명 이미지 준비 완료 전에는 인쇄하지 않는다',async()=>{
  const ready=deferred(),image={complete:false,naturalWidth:0,decode:()=>ready.promise},h=harness({images:[image]});const pending=h.run();await new Promise(setImmediate);assert.equal(h.prints(),0);image.complete=true;image.naturalWidth=10;ready.resolve();await pending;assert.equal(h.prints(),1);
});
test('이미지 준비 실패 또는 완료 뒤 깨진 이미지는 인쇄하지 않는다',async()=>{
  for(const image of [{complete:true,naturalWidth:0,decode:async()=>{throw Error('가상 이미지 실패');}},{complete:true,naturalWidth:0,decode:async()=>{}},{complete:false,naturalWidth:0}]){const h=harness({images:[image]});await h.run();assert.equal(h.prints(),0);assert.match(h.flashes.at(-1),/이미지/);}
});
test('상세 조회 권한 실패 및 다른 문서 응답은 인쇄하지 않고 목록으로 복구한다',async()=>{
  for(const detail of [async()=>{throw Error('가상 권한 거절');},async()=>undefined,async()=>({id:99,site_id:1})]){const h=harness({detail});await assert.rejects(()=>h.run());assert.equal(h.prints(),0);assert.equal(h.restores(),1);assert.equal(h.document.body.inert,false);assert.equal(h.state.detail,null);}
});
test('늦은 상세 성공과 실패는 이동한 화면의 현장과 문서를 덮어쓰지 않는다',async()=>{
  for(const fails of [false,true]){const ready=deferred(),h=harness({detail:()=>ready.promise}),pending=h.run();await new Promise(setImmediate);h.state.siteId=9;h.state.page='workers';h.state.detail=88;h.context.detailEpoch++;if(fails)ready.reject(Error('가상 늦은 실패'));else ready.resolve({id:1,site_id:1});await pending;assert.equal(h.prints(),0);assert.equal(h.restores(),0);assert.equal(h.state.siteId,9);assert.equal(h.state.detail,88);assert.equal(h.document.body.inert,false);assert.equal(h.content.innerHTML,undefined);}
});
test('이미지 대기 중 화면 변경·같은 화면 재조회·미리보기 교체 후에는 인쇄하지 않는다',async()=>{
  for(const change of [h=>{h.state.page='workers';},h=>{h.state.siteId=9;},h=>{h.context.detailEpoch++;},h=>{h.nodes['#batch-print']={};}]){const ready=deferred(),h=harness({images:[{complete:true,naturalWidth:10,decode:()=>ready.promise}]}),pending=h.run();await new Promise(setImmediate);change(h);ready.resolve();await pending;assert.equal(h.prints(),0);}
});
test('준비 중 중복 요청은 추가 문서 조회나 인쇄를 만들지 않는다',async()=>{
  const ready=deferred(),h=harness({detail:id=>id===1?ready.promise:Promise.resolve({id,site_id:1})}),pending=h.run();await new Promise(setImmediate);await h.run();assert.deepEqual(h.seen,[1]);ready.resolve({id:1,site_id:1});await pending;assert.equal(h.prints(),1);
});
test('공유 문서는 기존 미리보기와 동일하게 원래 현장 응답을 허용한다',async()=>{
  const h=harness({detail:async id=>({id,site_id:9})});await h.run();assert.equal(h.prints(),1);
});
test('안전문서 목록의 보기와 인쇄는 같은 선택 검증 경로를 사용한다',async()=>{
  const begin=source.indexOf("  if(state.page==='documents'&&filtered.length){const table="),finish=source.indexOf("  if(state.page==='documents'&&filtered.some",begin);assert.ok(begin>0&&finish>begin);
  const nodes={},inputs=[],calls=[],errors=[],rows=[1,2].map(()=>({insertCell:()=>({append(input){inputs.push(input);}})}));let markup='';
  const table={tHead:{rows:[{insertBefore(){}}]},tBodies:[{rows}],parentElement:{before(control){markup=control.innerHTML;}}};
  const content={querySelector:()=>table,querySelectorAll:selector=>selector.endsWith(':checked')?inputs.filter(input=>input.checked):inputs};
  const context={freezeBatchImages:async()=>({dispose(){},check:async()=>{}}),state:{page:'documents',siteId:1},filtered:[{id:1,title:'가상 TBM'},{id:2,title:'가상 교육'}],content,document:{createElement:()=>({dataset:{},setAttribute(){}})},$:id=>nodes[id]??={},selectBatchDocuments,showBatchPreview:async(...args)=>calls.push(args),showError:error=>errors.push(error.message)};
  runInNewContext(source.slice(begin,finish),context);assert.match(markup,/선택 인쇄/);
  await nodes['#batch-print-selected'].onclick();assert.equal(calls.length,0);assert.match(errors[0],/선택/);
  inputs[1].checked=true;await nodes['#batch-print-selected'].onclick();assert.deepEqual([...calls[0][0]],[2]);assert.equal(calls[0][5],true);
  await nodes['#batch-preview'].onclick();assert.equal(calls[1][5],false);
  nodes['#batch-select-all'].onclick();await nodes['#batch-print-selected'].onclick();assert.deepEqual([...calls[2][0]],[1,2]);
});

test('이미지 대기 중 수동 인쇄하면 예약 자동 인쇄를 취소한다',async()=>{
  const ready=deferred(),h=harness({images:[{complete:true,naturalWidth:10,decode:()=>ready.promise}]}),pending=h.run();await new Promise(setImmediate);await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);ready.resolve();await pending;assert.equal(h.prints(),1);
});
