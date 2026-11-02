import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
import {checklistCategories,checklistCategoryForKind} from '../public/checklist-copy.js';

const kinds={
  daily:{morning:9,afternoon:7,evening:10},
  weather:{rain:7,wind:9,thaw:15,heat:8,cold:10,wet_season:6,heavy_rain:11},
  general:{electrical:12,fire:5,formwork:7,falling:8,confined:4,excavation:8},
  semiannual:{semiannual:11}
};
const sorted=values=>values.slice().sort((a,b)=>a-b);
const snapshot=store=>JSON.stringify(store.db.prepare('SELECT * FROM documents ORDER BY id').all());
function fixture(store){
  const site=store.createSite({name:'가상 첫 현장'}),other=store.createSite({name:'가상 다른 현장'}),expected={};
  const add=(kind,length,siteId=site.id)=>store.createDocument({siteId,type:'checklist',title:kind==='rain'?'가상 선택 점검':'가상 '+kind,date:'2026-11-02',details:{kind,answers:Array.from({length},()=>({answer:'',note:''}))}});
  for(const [group,entries] of Object.entries(kinds))expected[group]=Object.entries(entries).map(([kind,length])=>add(kind,length).id);
  const blank=add('',0),unknown=add('',0),foreign=add('wind',9,other.id);
  store.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({kind:'older_kind'}),unknown.id);
  return {site,other,expected,blank,unknown,foreign};
}

test('저장 체크리스트의 기존 종류를 분류하고 현장·기간·검색어와 함께 검색한다',()=>{
  const store=new Store(':memory:');
  try{
    const {site,expected,blank,unknown}=fixture(store),before=snapshot(store);
    const find=(category,q='',from='',to='',type='checklist')=>store.documents(site.id,type,q,from,to,...Array(8).fill(''),category).map(row=>row.id);
    for(const [group,entries] of Object.entries(kinds)){
      for(const kind of Object.keys(entries))assert.equal(checklistCategoryForKind(kind),group);
      assert.deepEqual(sorted(find(group)),sorted(expected[group]));
    }
    for(const kind of ['',null,{},'older_kind','constructor','__proto__'])assert.equal(checklistCategoryForKind(kind),'');
    assert.deepEqual(find('weather','선택','2026-11-02','2026-11-02'),[expected.weather[0]]);
    assert.deepEqual(find('weather','선택','2026-11-01','2026-11-01'),[]);
    assert.ok(find('').includes(blank.id));assert.ok(find('').includes(unknown.id));
    for(const category of ['constructor','unknown'])assert.throws(()=>find(category),/체크리스트 분류/);
    for(const category of [null,1,{}])assert.throws(()=>find(category),/체크리스트 분류/);
    for(const type of ['', 'notice', 'work_plan'])assert.throws(()=>find('weather','','','',type),/체크리스트 분류/);
    assert.equal(snapshot(store),before);
  }finally{store.close();}
});

test('분류 검색 HTTP는 인증과 배정 현장 권한을 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-category-')),store=new Store(join(dir,'jweb.sqlite')),{site,other,expected}=fixture(store),before=snapshot(store);
  const accounts=new AdminAccounts(store.db);accounts.bootstrap('virtual-category-password');accounts.create({loginId:'limited_category',name:'가상 관리자',password:'virtual-category-password',scope:'restricted',siteIds:[site.id]});
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-category-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 시작되지 않았습니다.');})]);
    const base='http://127.0.0.1:'+port,login=async loginId=>{
      const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-category-password',...(loginId?{loginId}:{})})});
      assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
    };
    const global=await login(),limited=await login('limited_category');
    const get=(extra={},cookie=global)=>fetch(base+'/api/documents?'+new URLSearchParams({siteId:site.id,type:'checklist',checklistCategory:'weather',...extra}),{headers:cookie?{cookie}:{}});
    assert.equal((await get({},'')).status,401);
    let response=await get({q:'선택',from:'2026-11-02',to:'2026-11-02'});assert.equal(response.status,200);assert.deepEqual((await response.json()).map(row=>row.id),[expected.weather[0]]);
    response=await get({},limited);assert.equal(response.status,200);assert.deepEqual(sorted((await response.json()).map(row=>row.id)),sorted(expected.weather));
    assert.equal((await get({siteId:other.id},limited)).status,403);
    assert.equal((await get({type:'notice'})).status,400);assert.equal((await get({checklistCategory:'constructor'})).status,400);
    assert.equal(snapshot(store),before);
  }finally{if(child.exitCode===null&&!child.signalCode){const done=once(child,'exit');child.kill();await done;}store.close();rmSync(dir,{recursive:true,force:true});}
});

test('문서·결재 화면은 분류 조건을 전달하고 종류 전환 시 초기화한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),lines=source.split(/\r?\n/),wire=lines.find(line=>line.startsWith('function wireSearch()')),load=lines.find(line=>line.startsWith('async function loadDocuments()'));
  const nodes={'#search':{},'#query':{value:'가상 & 선택'},'#type-filter':{value:'checklist'},'#checklist-category-filter':{value:'weather'},'#document-from':{value:'2026-11-01'},'#document-to':{value:'2026-11-02'}},state={page:'documents',siteId:1,type:'checklist'},calls=[];
  const context={state,$:key=>nodes[key],content:{querySelectorAll:()=>[]},render:async()=>{},showError(){},flash(){},api:async path=>{calls.push(path);return [];},URLSearchParams};
  runInNewContext(wire+'\n'+load+'\nglobalThis.wireSearch=wireSearch;globalThis.loadDocuments=loadDocuments;',context);context.wireSearch();nodes['#search'].onclick();await context.loadDocuments();
  let params=new URL(calls.at(-1),'http://localhost').searchParams;assert.equal(params.get('checklistCategory'),'weather');assert.equal(params.get('q'),'가상 & 선택');assert.equal(params.get('from'),'2026-11-01');
  state.page='approval';await context.loadDocuments();params=new URL(calls.at(-1),'http://localhost').searchParams;assert.equal(params.get('checklistCategory'),'weather');
  nodes['#type-filter'].value='notice';nodes['#search'].onclick();await context.loadDocuments();assert.equal(state.checklistCategory,'');assert.equal(new URL(calls.at(-1),'http://localhost').searchParams.has('checklistCategory'),false);
  let markup='';state.type='checklist';state.checklistCategory='general';nodes['#search'].insertAdjacentHTML=(_where,html)=>{markup=html;};
  runInNewContext(lines.find(line=>line.startsWith("  if(state.type==='checklist')$('#search').insertAdjacentHTML")),{...context,checklistCategories,esc:String});
  assert.match(markup,/value="general" selected/);assert.match(markup,/미기록된 문서는 전체/);
});
