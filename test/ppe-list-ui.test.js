import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),part=(a,b)=>{const from=source.indexOf(a),to=source.indexOf(b,from);assert.ok(from>=0&&to>from);return source.slice(from,to);},deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('보호구 내역은 이름순으로 정렬하고 처음 20건만 표시한다',async()=>{
  const code=part("  if(state.page==='ppe-issues')",'    const reportPanel='),rows=Array.from({length:45},(_,i)=>({id:i+1,date:'2026-11-01',worker:{name:`가상 ${String(45-i).padStart(2,'0')}`,category:'직영',company:'가상',occupation:'목공'},item:'가상',quantity:1})),content={innerHTML:''},state={page:'ppe-issues',siteId:1,ppeMonth:'2026-11'},api=async path=>path.startsWith('/api/ppe-issues')?{rows,totals:[]}:[];
  await runInNewContext(`(async()=>{${code}}})()`,{content,state,detailEpoch:1,today:()=> '2026-11-01',api,esc:value=>String(value),encodeURIComponent,Promise});assert.ok(content.innerHTML.indexOf('가상 01')<content.innerHTML.indexOf('가상 45'));assert.equal((content.innerHTML.match(/<tr hidden>/g)||[]).length,25);
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(css,/data-ppe-print="detail"[^\n]*tr\[hidden\]\{display:table-row!important\}/);
});

test('더 보기는 20건씩 표시하고 끝나면 버튼을 숨긴다',()=>{
  const code=part('    if(report.rows.length>20){const more=',"    reportPanel.querySelector('.panel-head')"),rows=Array.from({length:45},(_,i)=>({hidden:i>=20})),nodes=[],target={querySelectorAll:()=>rows,after:(...items)=>nodes.push(...items)},reportHeads=[{}, {nextElementSibling:target}],document={createElement:()=>({setAttribute(){}})};
  runInNewContext(code,{report:{rows},reportHeads,document});const [button,note]=nodes;assert.equal(note.textContent,'20 / 45건 표시');button.onclick();assert.equal(rows.filter(row=>!row.hidden).length,40);button.onclick();assert.equal(rows.filter(row=>!row.hidden).length,45);assert.equal(button.hidden,true);
});

test('이전 현장의 늦은 조회는 현재 화면을 덮지 않는다',async()=>{
  const code=part("  if(state.page==='ppe-issues')",'    const reportPanel='),wait=deferred(),content={innerHTML:'현재 화면'},state={page:'ppe-issues',siteId:1,ppeMonth:'2026-11'},api=path=>path.startsWith('/api/ppe-issues')?wait.promise:Promise.resolve([]),pending=runInNewContext(`(async()=>{${code}}})()`,{content,state,detailEpoch:1,today:()=> '2026-11-01',api,esc:value=>String(value),encodeURIComponent,Promise});state.siteId=2;wait.resolve({rows:[],totals:[]});await pending;assert.equal(content.innerHTML,'현재 화면');
});

test('다른 출입자를 선택하면 먼저 요청한 보호구 상세는 열리지 않는다',async()=>{
  const code=part('async function showPpeRecords(worker){','async function showWorkerSelfCheck('),requests=[],opened=[],state={page:'workers',siteId:1},dialog={open:false},api=()=>{const wait=deferred();requests.push(wait);return wait.promise;},context={state,detailEpoch:1,ppeDetailEpoch:0,dialog,api,esc:value=>String(value),showDialog:(title,html)=>opened.push(html),showError:error=>{throw error;},$:()=>({})};runInNewContext(code,context);const old=context.showPpeRecords({id:1,name:'첫째',company:'가상'}),latest=context.showPpeRecords({id:2,name:'둘째',company:'가상'});requests[1].resolve([]);await latest;requests[0].resolve([]);await old;assert.equal(opened.length,1);assert.match(opened[0],/둘째/);
});
