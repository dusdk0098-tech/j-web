import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture(store){
  const a=store.createSite({name:'가상 검색 현장'}),b=store.createSite({name:'가상 다른 현장'});
  const add=(company,title='가상 계획',date='2026-11-02',siteId=a.id)=>store.createDocument({siteId,type:'work_plan',title,date,details:{company}});
  const first=add('가상 A 업체','가상 선택 계획'),second=add('가상 A 업체','가상 다른 계획','2026-11-01'),special=add("가상 %_[' 업체");
  add('가상 다른 업체','가상 A 업체');add('가상 A 업체','가상 선택 계획','2026-11-02',b.id);
  const legacy=add('');store.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({companyId:first.id,description:'가상 A 업체'}),legacy.id);
  return {a,b,first,second,special};
}
const snapshot=store=>JSON.stringify(store.db.prepare('SELECT * FROM documents ORDER BY id').all());

test('작업업체명은 계획서의 문자열만 리터럴 검색하고 날짜·일반검색과 교집합을 구한다',()=>{
  const store=new Store(':memory:');try{
    const {a,first,second,special}=fixture(store),before=snapshot(store);
    const find=(company,q='',from='',to='',type='work_plan')=>store.documents(a.id,type,q,from,to,'','','','','','','',company).map(row=>row.id);
    assert.deepEqual(find('  A 업체  '),[first.id,second.id]);
    assert.deepEqual(find('A 업체','선택','2026-11-02','2026-11-02'),[first.id]);
    assert.deepEqual(find('A 업체','선택','2026-11-01','2026-11-01'),[]);
    assert.deepEqual(find("%_['"),[special.id]);assert.deepEqual(find(String(first.id)),[]);
    assert.equal(find(' ').length,5);assert.deepEqual(find('a 업체'),[]);
    for(const type of ['', 'permit', 'risk'])assert.throws(()=>find('A 업체','','','',type),/작업계획서 검색 조건/);
    for(const input of [null,123,[],{}])assert.throws(()=>find(input),/작업업체명 검색 조건/);
    assert.equal(snapshot(store),before);
  }finally{store.close();}
});

test('등록 업체 변경·삭제는 기록된 업체명 검색을 바꾸지 않고 문서의 새 기록을 반영한다',()=>{
  const store=new Store(':memory:');try{
    const {a,first,second}=fixture(store),company=store.createCompany({siteId:a.id,name:'가상 A 업체',trade:'가상'}),find=name=>store.documents(a.id,'work_plan','','','','','','','','','','',name).map(row=>row.id);
    store.db.prepare('UPDATE companies SET name=? WHERE id=?').run('가상 변경 업체',company.id);assert.deepEqual(find('A 업체'),[first.id,second.id]);
    store.db.prepare('DELETE FROM companies WHERE id=?').run(company.id);assert.deepEqual(find('A 업체'),[first.id,second.id]);
    store.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify({company:'새 기록 업체'}),first.id);const before=snapshot(store);assert.deepEqual(find('A 업체'),[second.id]);assert.deepEqual(find('새 기록'),[first.id]);assert.equal(snapshot(store),before);
  }finally{store.close();}
});

test('작업업체명 검색 HTTP는 인증·유형·현장을 유지하며 저장 자료를 변경하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-plan-company-')),store=new Store(join(dir,'jweb.sqlite')),{a,b,first,second,special}=fixture(store),before=snapshot(store);
  const accounts=new AdminAccounts(store.db);accounts.bootstrap('virtual-plan-company-password');accounts.create({loginId:'limited_plan',name:'가상 제한',password:'virtual-plan-company-password',scope:'restricted',siteIds:[a.id]});
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-plan-company-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);
    const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-plan-company-password'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],path=(extra={})=>'/api/documents?'+new URLSearchParams({siteId:a.id,type:'work_plan',workPlanCompany:'A 업체',...extra}),get=(extra={},authenticated=true)=>fetch(base+path(extra),{headers:authenticated?{cookie}:{}}),ids=async extra=>{const response=await get(extra);assert.equal(response.status,200);return (await response.json()).map(row=>row.id);};
    assert.equal((await get({},false)).status,401);assert.deepEqual(await ids(),[first.id,second.id]);
    assert.deepEqual(await ids({q:'선택',from:'2026-11-02',to:'2026-11-02'}),[first.id]);
    assert.deepEqual(await ids({q:'선택',from:'2026-11-01',to:'2026-11-01'}),[]);
    assert.deepEqual(await ids({workPlanCompany:"%_['"}),[special.id]);
    assert.deepEqual(await ids({workPlanCompany:String(first.id)}),[]);
    assert.equal((await ids({siteId:b.id})).length,1);
    for(const type of ['', 'permit', 'risk'])assert.equal((await get({type})).status,400);
    const limitedLogin=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId:'limited_plan',password:'virtual-plan-company-password'})});assert.equal(limitedLogin.status,200);const limitedCookie=limitedLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+path({siteId:b.id}),{headers:{cookie:limitedCookie}})).status,403);
    assert.equal(snapshot(store),before);
  }finally{if(child.exitCode===null&&!child.signalCode){const done=once(child,'exit');child.kill();await done;}store.close();rmSync(dir,{recursive:true,force:true});}
});

test('작업업체 검색 입력은 인코딩·기간·검색어를 보존하고 현장·유형 전환에서 초기화한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),lines=source.split(/\r?\n/),wire=lines.find(line=>line.startsWith('function wireSearch()')),load=lines.find(line=>line.startsWith('async function loadDocuments()'));
  const nodes={'#search':{},'#query':{value:'가상 & 선택'},'#type-filter':{value:'work_plan'},'#work-plan-company-filter':{value:'  가상 %_\' &+ 업체  '},'#document-from':{value:'2026-11-01'},'#document-to':{value:'2026-11-02'}},state={page:'documents',siteId:1,type:'work_plan'},calls=[];
  const context={state,$:key=>nodes[key],content:{querySelectorAll:()=>[]},render:async()=>{},showError(){},flash(){},api:async path=>{calls.push(path);return [];},URLSearchParams};
  runInNewContext(wire+'\n'+load+'\nglobalThis.wireSearch=wireSearch;globalThis.loadDocuments=loadDocuments;',context);context.wireSearch();nodes['#search'].onclick();await context.loadDocuments();
  const params=new URL(calls[0],'http://localhost').searchParams;assert.equal(params.get('workPlanCompany'),"가상 %_' &+ 업체");assert.equal(params.get('q'),'가상 & 선택');assert.equal(params.get('from'),'2026-11-01');assert.equal(params.get('to'),'2026-11-02');
  const escaped=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');let html='';state.workPlanCompany='<가상 "업체">';nodes['#search'].insertAdjacentHTML=(_position,text)=>{html=text};runInNewContext(lines.find(line=>line.startsWith("  if(state.type==='work_plan')$('#search').insertAdjacentHTML")),{...context,esc:escaped,riskCompanies:[]});assert.match(html,/&lt;가상 &quot;업체&quot;>/);assert.match(html,/포함 검색/);
  nodes['#type-filter'].value='permit';nodes['#search'].onclick();await context.loadDocuments();assert.equal(state.workPlanCompany,'');assert.equal(new URL(calls[1],'http://localhost').searchParams.has('workPlanCompany'),false);
  state.workPlanCompany='이전 업체';const siteSelect={value:'2'};runInNewContext(lines.find(line=>line.startsWith('siteSelect.onchange=')),{...context,siteSelect});siteSelect.onchange();assert.equal(state.workPlanCompany,'');assert.equal(state.siteId,2);
});

test('계획서 목록의 지연 응답은 A→B→A 전환과 업체 목록 조회 중 전환에서 폐기한다',async()=>{
  const lines=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split(/\r?\n/),start=lines.find(line=>line.startsWith('  const docsRequest=')),guard=lines.find(line=>line.startsWith("  if(docsPage==='documents'"));
  const state={page:'documents',siteId:1,workPlanCompany:'A'},resolvers=[],painted=[],context={state,detailEpoch:1,loadDocuments:()=>new Promise(resolve=>resolvers.push(resolve)),painted};
  const run=()=>runInNewContext('(async()=>{'+start+'\n'+guard+'\npainted.push(allDocs);})()',context);
  const a=run();context.detailEpoch++;state.workPlanCompany='B';const b=run();context.detailEpoch++;state.workPlanCompany='A';const fresh=run();resolvers[2]('최신 A');await fresh;resolvers[0]('이전 A');resolvers[1]('이전 B');await Promise.all([a,b]);assert.deepEqual(painted,['최신 A']);
  let resolve;const filter=lines.find(line=>line.startsWith('  const filterSite='));state.type='permit';context.docsRequest=context.detailEpoch;context.api=()=>new Promise(done=>{resolve=done});const pending=runInNewContext('(async()=>{'+filter+'\npainted.push("stale");})()',context);context.detailEpoch++;resolve([]);await pending;assert.deepEqual(painted,['최신 A']);
});
