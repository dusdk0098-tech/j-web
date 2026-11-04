import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {permitCheckSources,permitCheckSourceNames} from '../public/permit-sources.js';
import {Store} from '../store.js';

test('허가서 점검에서 미흡을 해제하면 해당 행의 조치 입력만 지운다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('const editCheck=check=>{'),end=source.indexOf("    $('#permit-check-add').onclick",start);
  assert.ok(start>=0&&end>start);
  const rows={querySelectorAll:()=>[]},add={},nodes={'#permit-check-rows':rows,'#permit-check-row-add':add,'#permit-check-source-load':{},'#permit-check-source-list':{}};
  const context={$:key=>nodes[key],showDialog(){},field:()=>'',esc:String,today:()=>'',api(){},doc:{id:1}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.openCheck=editCheck;',context);context.openCheck(null);
  const action={value:'가상 조치'},otherAction={value:'다른 행 조치'},wrap={hidden:false},row={querySelector(key){return key==='[data-action-wrap]'?wrap:action;}};
  const target={value:'pass',matches:key=>key==='[data-check-result]',closest:()=>row};
  rows.onchange({target});assert.equal(wrap.hidden,true);assert.equal(action.value,'');assert.equal(otherAction.value,'다른 행 조치');
  target.value='fail';rows.onchange({target});assert.equal(wrap.hidden,false);assert.equal(action.value,'');
  action.value='다른 조치';target.value='';rows.onchange({target});assert.equal(action.value,'');assert.equal(wrap.hidden,true);
});

test('이전 점검은 같은 현장·위험작업·승인 상태와 날짜를 확인해 이름만 추가한다',()=>{
  const source={id:1,site_id:3,type:'permit',status:'approved',date:'2026-11-01',title:'가상',details:JSON.stringify({kinds:['화기작업']})},rows=[source,{...source,id:2,site_id:4},{...source,id:3,status:'draft'},{...source,id:4,date:'2026-11-06'},{...source,id:5,details:JSON.stringify({kinds:['굴착작업']})}];
  assert.deepEqual(permitCheckSources(rows,3,'2026-11-05',9,['화기작업']).map(row=>row.id),[1]);assert.deepEqual(permitCheckSources(rows,3,'2026-11-05',1,['화기작업']),[]);
  const checks=[{id:1,date:'2026-11-01',items:[{name:'가상 항목',result:'fail',action:'가상 조치'}]},{id:2,date:'2026-11-06',items:[{name:'미래 항목'}]}];assert.deepEqual(permitCheckSourceNames(checks,'2026-11-05',1),[{name:'가상 항목'}]);assert.throws(()=>permitCheckSourceNames(checks,'2026-11-05',20),/20개/);assert.throws(()=>permitCheckSourceNames(checks,'2026-10-01',0),/이전 점검/);
});

test('가상 저장소의 이전 허가서와 점검을 조회해 새 항목에 적용한다',()=>{
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),make=(title,date)=>store.createDocument({siteId:site.id,type:'permit',title,date,details:{kinds:['화기작업']}}),old=make('이전 허가','2026-11-01'),current=make('새 허가','2026-11-05');store.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(old.id);store.savePermitCheck(old.id,{date:'2026-11-02',items:[{name:'가상 점검',result:'fail',action:'가상 조치'}]});const sources=permitCheckSources(store.documents(site.id,'permit'),site.id,'2026-11-05',current.id,['화기작업']);assert.deepEqual(sources.map(item=>item.id),[old.id]);const names=permitCheckSourceNames(store.permitChecks(old.id),'2026-11-05',0);assert.deepEqual(names,[{name:'가상 점검'}]);assert.throws(()=>store.savePermitCheck(current.id,{date:'2026-11-05',items:names}),/결과/);store.savePermitCheck(current.id,{date:'2026-11-05',items:names.map(item=>({...item,result:'pass',action:''}))});assert.equal(store.permitChecks(current.id)[0].items[0].action,'');assert.equal(store.permitChecks(old.id)[0].items[0].action,'가상 조치');}finally{store.close();}
});

test('점검 화면은 이전 기록의 항목만 불러오며 날짜 전환과 변경된 허가서를 차단한다',async()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf('const editCheck=check=>{'),end=code.indexOf("    $('#permit-check-add').onclick",start),source={id:1,site_id:3,type:'permit',status:'approved',date:'2026-11-01',title:'가상',details:JSON.stringify({kinds:['화기작업']})};assert.ok(start>=0&&end>start);
  const added=[],rows={querySelectorAll:()=>[{}],insertAdjacentHTML:(_where,html)=>added.push(html)},date={value:'2026-11-05'},list={},load={},nodes={'#permit-check-rows':rows,'#permit-check-row-add':{},'#permit-check-source-list':list,'#permit-check-source-load':load,'#dialog-form [name=date]':date};let current=true,latest=source,release;
  const context={$:key=>nodes[key],showDialog(){},field:()=>'',esc:String,today:()=>'',doc:{id:9,site_id:3},details:{kinds:['화기작업']},currentDetail:()=>current,dialog:{open:true},URLSearchParams,permitCheckSources,permitCheckSourceNames,api:async path=>{if(path.startsWith('/api/documents?'))return [source];if(path.endsWith('/permit-checks'))return [{id:2,date:'2026-11-04',items:[{name:'가상 항목',result:'fail',action:'이전 조치'}]}];if(release)await new Promise(resolve=>{release.resolve=resolve;});return latest;}};
  runInNewContext(code.slice(start,end)+'\nglobalThis.openCheck=editCheck;',context);context.openCheck(null);await load.onclick();await list.onclick({target:{matches:()=>true,dataset:{checkSource:'0'}}});assert.equal(added.length,1);assert.match(added[0],/가상 항목/);assert.doesNotMatch(added[0],/이전 조치|selected/);
  await load.onclick();latest={...source,status:'draft'};await list.onclick({target:{matches:()=>true,dataset:{checkSource:'0'}}});assert.equal(added.length,1);assert.match(list.textContent,/변경/);
  latest=source;await load.onclick();release={};const pending=list.onclick({target:{matches:()=>true,dataset:{checkSource:'0'}}});date.value='2026-11-06';release.resolve();await pending;assert.equal(added.length,1);current=false;
});
