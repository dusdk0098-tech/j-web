import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {siteReportsForDay,joinedBatchPreview,dailyBatchReport,selectBatchItems} from '../public/batch-print.js';

const date='2026-11-01',site={id:1,name:'가상 현장'},person=siteId=>({siteId,name:'가상 가입자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('가입기록 한국시간 경계·과거 날짜·현장과 수동 등록을 분리한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-joined-')),store=new Store(join(dir,'jweb.sqlite'));
  try{
    const a=store.createSite({name:'가상 현장'}),b=store.createSite({name:'다른 현장'}),add=(siteId,time)=>{
      const worker=store.createWorker(person(siteId));
      if(time)store.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,created_at) VALUES(?,?,?)').run(worker.id,'demo-v1',time);
      return worker;
    };
    const before=add(a.id,'2026-10-31 14:59:59'),start=add(a.id,'2026-10-31 15:00:00'),end=add(a.id,'2026-11-01 14:59:59'),after=add(a.id,'2026-11-01 15:00:00');
    add(a.id,null);add(b.id,'2026-10-31 15:00:00');
    store.db.prepare("UPDATE workers SET created_date='2020-01-01' WHERE id=?").run(start.id);
    const rows=store.joinedWorkersForDay(a.id,date);
    assert.deepEqual(rows.map(row=>row.id),[start.id,end.id]);
    assert.equal(rows[0].created_date,'2020-01-01');
    assert.equal(rows[0].joined_at,'2026-10-31 15:00:00');
    assert.equal(store.previewWorkers(a.id,rows.map(({id,version})=>({id,version}))).workers.length,2);
    assert.deepEqual(store.joinedWorkersForDay(a.id,'2026-10-31').map(row=>row.id),[before.id]);
    assert.deepEqual(store.joinedWorkersForDay(a.id,'2026-11-02').map(row=>row.id),[after.id]);
    assert.deepEqual(store.joinedWorkersForDay(a.id,'2020-01-01'),[]);
    assert.throws(()=>store.joinedWorkersForDay(a.id,'2026-02-30'),/날짜/);
    assert.throws(()=>store.joinedWorkersForDay(999,date),/현장/);
    let checks=0;assert.throws(()=>store.joinedWorkersForDay(a.id,date,()=>{if(++checks===2)throw Error('세션 폐기');}),/세션 폐기/);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

const worker={id:7,site_id:1,version:'a'.repeat(64),joined_at:'2026-10-31 15:00:00',name:'<가상 가입자>',category:'직영',company:'가상',occupation:'가상'};
const preview={siteName:site.name,workers:[{...worker,created_date:'2020-01-01',join:{created_at:worker.joined_at,equipment:[],profile:{phone:'<가상 번호>'}},files:[{name:'<가상 파일>.txt'}],ppe:[],signature:'data:image/png;base64,YWJj'}]};
const report={id:4,kind:'joined-worker',title:'신규 가입 서류',site,date,worker};
test('가입자별 선택 합계·빈 자료·현장 혼입·날짜 및 버전 변경을 차단한다',async()=>{
  const reports=await siteReportsForDay([site],date,async path=>path.startsWith('/api/ppe')?{rows:[]}:path.startsWith('/api/workers')?[worker,{...worker,id:8,site_id:2}]:[]);
  assert.equal(reports.length,4);assert.equal(reports[3].worker.id,7);
  assert.throws(()=>selectBatchItems(Array.from({length:17},(_,i)=>({id:i+1})),reports,Array.from({length:17},(_,i)=>i+1),[1,2,3,4]),/20개/);
  const empty=await siteReportsForDay([site],date,async path=>path.startsWith('/api/ppe')?{rows:[]}:[]);
  assert.equal(empty.length,3);
  const api=async(path)=>path.startsWith('/api/workers/joined-on')?[worker]:preview;
  assert.deepEqual(await joinedBatchPreview(report,api),preview);
  const html=dailyBatchReport({...report,preview},esc);
  assert.match(html,/한국시간/);assert.match(html,/2020-01-01/);assert.match(html,/&lt;가상 번호&gt;/);assert.match(html,/&lt;가상 파일&gt;/);assert.doesNotMatch(html,/<가상/);
  for(const changed of [{...worker,site_id:2},{...worker,version:'b'.repeat(64)},{...worker,joined_at:'2026-10-31 14:59:59'}]){
    await assert.rejects(()=>joinedBatchPreview(report,async()=>[changed]),/변경/);
  }
  await assert.rejects(()=>joinedBatchPreview(report,async path=>path.includes('joined-on')?[worker]:{...preview,workers:[{...preview.workers[0],join:{created_at:'2026-11-02 00:00:00'}}]}),/변경/);
});

function harness(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);
  const nodes={},groups=[],errors=[],images=[],state={page:'site-print',siteId:1,detail:null,admin:{id:1}};let prints=0,allowed=true,changed=false,gate=null;
  const api=async path=>{
    if(gate)await gate;
    if(!allowed)throw Error('로그인 만료');
    if(path==='/api/session')return {authenticated:true,admin:{scope:'global'},context:'test-session'};
    if(path.includes('joined-on'))return [worker];
    return changed?{...preview,workers:[{...preview.workers[0],...changed}]}:preview;
  };
  const context={freezeBatchImages:async()=>({dispose(){},check:async()=>{}}),detailEpoch:0,state,content:{children:[],style:{},append(){},querySelectorAll:()=>images},document:{body:{inert:false},createDocumentFragment:()=>({querySelectorAll:()=>[],append:group=>groups.push(group)}),createElement:()=>({})},api,adminSession:Promise.resolve({context:'test-session'}),esc,dailyBatchReport,joinedBatchPreview,$:id=>nodes[id]??={},flash(){},showError:error=>errors.push(error.message),window:{print(){prints++;}},render:async()=>{}};
  runInNewContext(source.slice(start,end),context);
  return {context,nodes,groups,errors,images,prints:()=>prints,deny(){allowed=false;},change(value={memo:'바뀜'}){changed=value;},block(promise){gate=promise;}};
}
test('가입 서류 준비·인쇄 전 재조회와 이미지 실패·세션 폐기·늦은 응답을 검증한다',async()=>{
  const h=harness();await h.context.showBatchPreview([],[],1,false,null,false,[report]);
  assert.equal(h.groups.length,1);assert.match(h.groups[0].innerHTML,/시험 가입 기록/);
  h.images.push({complete:false,naturalWidth:0});await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),0);
  h.images.length=0;await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);
  h.change();await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);assert.match(h.errors[0],/가입 서류가 변경/);
  h.deny();await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),1);assert.match(h.errors[1],/로그인 만료/);
  const late=harness();let release;late.block(new Promise(resolve=>{release=resolve;}));
  const pending=late.context.showBatchPreview([],[],1,false,null,false,[report]);late.context.state.admin={id:2};release();await pending;
  assert.equal(late.groups.length,0);assert.equal(late.prints(),0);assert.equal(late.context.document.body.inert,false);
  const before=harness();before.deny();await assert.rejects(()=>before.context.showBatchPreview([],[],1,false,null,false,[report]),/로그인 만료/);assert.equal(before.groups.length,0);
});

test('인쇄 전 개인정보·첨부·서명 변경 및 늦은 권한 응답과 자동 이미지 실패를 차단한다',async()=>{
  for(const change of [{join:{...preview.workers[0].join,profile:{phone:'바뀐 번호'}}},{files:[{name:'바뀐 파일'}]},{signature:'data:image/png;base64,ZGVm'}]){
    const h=harness();await h.context.showBatchPreview([],[],1,false,null,false,[report]);h.change(change);await h.nodes['#batch-print'].onclick();assert.equal(h.prints(),0);assert.match(h.errors[0],/가입 서류가 변경/);
  }
  const late=harness();await late.context.showBatchPreview([],[],1,false,null,false,[report]);let release;late.block(new Promise(resolve=>{release=resolve;}));const printing=late.nodes['#batch-print'].onclick();late.context.state.page='workers';release();await printing;assert.equal(late.prints(),0);
  const broken=harness();broken.images.push({complete:true,naturalWidth:0,decode:async()=>{throw Error('이미지 실패');}});await broken.context.showBatchPreview([],[],1,false,null,true,[report]);assert.equal(broken.prints(),0);
});

test('가입일 조회 HTTP는 전역 관리자만 허용하고 로그아웃 후 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-joined-http-')),store=new Store(join(dir,'jweb.sqlite')),a=store.createSite({name:'가상 현장'}),w=store.createWorker(person(a.id));
  store.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,created_at) VALUES(?,?,?)').run(w.id,'demo-v1',worker.joined_at);store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const login=await call('/api/login','POST',{password:'virtual-password-123'}),cookie=login.headers.get('set-cookie').split(';')[0],path='/api/workers/joined-on?siteId='+a.id+'&date='+date;
    assert.equal((await call(path)).status,401);
    const response=await call(path,'GET',undefined,cookie);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual((await response.json()).map(row=>row.id),[w.id]);
    const restricted=await call('/api/admin-accounts','POST',{loginId:'limited_join',name:'가상 제한 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[a.id]},cookie);assert.equal(restricted.status,201);
    const restrictedLogin=await call('/api/login','POST',{loginId:'limited_join',password:'virtual-password-123'}),limited=restrictedLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await call(path,'GET',undefined,limited)).status,403);
    assert.equal((await call('/api/workers/preview','POST',{siteId:a.id,items:[{id:w.id,version:w.version}]},limited)).status,403);
    await call('/api/logout','POST',{},cookie);assert.equal((await call(path,'GET',undefined,cookie)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
