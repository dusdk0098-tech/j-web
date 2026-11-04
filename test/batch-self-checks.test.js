import test from 'node:test';
import {prepareWorkerPdfs} from '../public/plan-pdf.js';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {PNG} from 'pngjs';
import {Store} from '../store.js';
import {siteReportsForDay,reloadDailyBatchRows,dailyBatchReport,selectBatchItems} from '../public/batch-print.js';

const date='2024-02-29',password='virtual-password-123';
const png=new PNG({width:1,height:1});png.data[3]=255;
const bytes=PNG.sync.write(png),signature='data:image/png;base64,'+bytes.toString('base64');
const answers=[{answer:'O',note:'<가상 메모>'},{answer:'X',note:''},{answer:'O',note:''}];
const workerAnswers={equipment:true,sober:true,exercise:true,briefing:true};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fixture(store){
  const site=store.createSite({name:'<가상 현장>'}),other=store.createSite({name:'다른 현장'});
  const worker=store.createWorker({siteId:site.id,name:'<가상 근로자>',category:'직영',company:'가상 업체',occupation:'가상 직종'});
  const legacy=store.createWorker({siteId:site.id,name:'이전 기록',category:'기타 출입자',company:'가상 업체',occupation:'가상 직종'});
  store.createWorker({siteId:site.id,name:'미작성',category:'직영',company:'가상 업체',occupation:'가상 직종'});
  const staff=store.createReviewer({siteId:site.id,loginId:'print_staff',name:'가상 직원',password});
  const off=store.createReviewer({siteId:site.id,loginId:'print_off',name:'가상 휴무자',password});
  store.saveManagerCheck(site.id,date,answers,signature);
  store.saveManagerDayOff(other.id,date);
  store.saveReviewerManagerCheck(staff.id,date,{kind:'check',answers,signature});
  store.saveReviewerManagerCheck(off.id,date,{kind:'day_off'});
  store.createWorkerSelfCheck(worker.id,date,workerAnswers,signature);
  store.db.prepare("INSERT INTO worker_self_checks(worker_id,date,created_at,answers,signature) VALUES(?,?,'2024-02-29 01:00:00',NULL,NULL)").run(legacy.id,date);
  const addDay=store.db.prepare('INSERT INTO manager_days_off(site_id,date) VALUES(?,?)');
  for(let i=1;i<=31;i++)addDay.run(site.id,'2024-03-'+String(i).padStart(2,'0'));
  return {site,other,worker,legacy,staff};
}

test('일괄 출력용 점검은 날짜·현장·기록 종류를 구분하고 과거 답변을 보존한다',()=>{
  const store=new Store(':memory:');
  try{
    const {site,other,worker,legacy,staff}=fixture(store),rows=store.sitePrintSelfChecks(site.id,date);
    assert.ok(!store.managerChecks(site.id).some(row=>row.date===date));
    assert.deepEqual(rows.map(row=>row.role),['manager','reviewer','worker','worker']);
    assert.deepEqual(rows[0].answers,answers);assert.deepEqual(rows[1].answers,answers);
    assert.deepEqual(rows.find(row=>row.id===worker.id&&row.role==='worker').answers,workerAnswers);
    assert.equal(rows.find(row=>row.id===legacy.id&&row.role==='worker').answers,null);
    assert.equal(rows.find(row=>row.id===legacy.id&&row.role==='worker').has_signature,0);
    assert.equal(rows[1].id,staff.id);assert.deepEqual(store.sitePrintSelfChecks(other.id,date),[]);
    assert.deepEqual(Buffer.from(store.managerSelfCheckSignature(site.id,date)),bytes);
    assert.equal(store.managerSelfCheckSignature(other.id,date),null);
    assert.throws(()=>store.sitePrintSelfChecks(site.id,'2024-02-30'),/날짜/);
    assert.throws(()=>store.sitePrintSelfChecks(999,date),/현장/);
    let checks=0;assert.throws(()=>store.sitePrintSelfChecks(site.id,date,()=>{if(++checks===2)throw Error('세션 만료');}),/세션 만료/);
    assert.equal(store.sitePrintSelfChecks(site.id,date).length,4);
  }finally{store.close();}
});

test('일괄 점검 미리보기는 항목과 서명을 현장별로 표시하고 변경을 재조회한다',async()=>{
  const store=new Store(':memory:');
  try{
    const {site,other,worker,legacy,staff}=fixture(store),api=async path=>{
      const url=new URL(path,'http://localhost');
      if(url.pathname.endsWith('/print-self-checks'))return store.sitePrintSelfChecks(Number(url.pathname.split('/')[3]),url.searchParams.get('date'));
      if(url.pathname==='/api/ppe-issues')return {rows:[]};
      return [];
    };
    const reports=await siteReportsForDay([site,other],date,api),checks=reports.filter(row=>row.kind==='self-check');
    assert.equal(checks.length,4);assert.ok(checks.every(row=>row.site.id===site.id));
    const person=checks.find(row=>row.rows[0].role==='worker'&&row.rows[0].id===worker.id),prior=checks.find(row=>row.rows[0].id===legacy.id&&row.rows[0].role==='worker');
    const manager=checks.find(row=>row.rows[0].role==='manager'),reviewer=checks.find(row=>row.rows[0].role==='reviewer');
    assert.match(dailyBatchReport(person,esc),/&lt;가상 근로자&gt;/);assert.doesNotMatch(dailyBatchReport(person,esc),/<가상 근로자>/);
    assert.match(dailyBatchReport(person,esc),/안전장구 확인: 확인/);assert.match(dailyBatchReport(person,esc),new RegExp('/self-checks/'+worker.id+'/signature'));
    assert.match(dailyBatchReport(prior,esc),/답변 미기록/);assert.match(dailyBatchReport(prior,esc),/시험 서명 없음/);
    assert.match(dailyBatchReport(manager,esc),/관리자 계정 미기록/);assert.match(dailyBatchReport(manager,esc),/manager-checks\/signature/);
    assert.match(dailyBatchReport(reviewer,esc),new RegExp('/reviewer-manager-checks/'+staff.id+'/signature'));assert.match(dailyBatchReport(reviewer,esc),/&lt;가상 메모&gt;/);
    assert.deepEqual(await reloadDailyBatchRows(person,api),person.rows);
    store.db.prepare("UPDATE worker_self_checks SET answers=? WHERE worker_id=? AND date=?").run(JSON.stringify({...workerAnswers,exercise:false}),worker.id,date);
    const changed=await reloadDailyBatchRows(person,api);assert.notDeepEqual(changed,person.rows);assert.match(dailyBatchReport({...person,rows:changed},esc),/안전체조 확인: 미확인/);
    assert.throws(()=>selectBatchItems(Array.from({length:17},(_,i)=>({id:i+1})),reports,Array.from({length:17},(_,i)=>i+1),checks.map(item=>item.id)),/20개/);
  }finally{store.close();}
});

test('자가점검 미리보기의 변경과 서명 오류는 인쇄를 중단한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);
  const row={role:'worker',id:3,name:'가상 근로자',category:'직영',company:'가상',answers:workerAnswers,created_at:'2024-02-29 01:00:00',has_signature:1},report={id:4,kind:'self-check',title:'자가점검',site:{id:1,name:'가상 현장'},date,rows:[row]};
  const nodes={},groups=[],errors=[],state={page:'site-print',siteId:1,detail:null,admin:{id:1}};let latest=[row],prints=0,imageChanged=false;
  const context={prepareWorkerPdfs,freezeBatchImages:async()=>({dispose(){},check:async()=>{if(imageChanged)throw Error('서명 이미지가 변경되었습니다.');}}),detailEpoch:0,state,content:{children:[],style:{},append(){},querySelectorAll:()=>[]},document:{body:{inert:false},createDocumentFragment:()=>({querySelectorAll:()=>[],append:group=>groups.push(group)}),createElement:()=>({})},reloadDailyBatchRows,api:async path=>path==='/api/session'?{authenticated:true,admin:{scope:'global'},context:'virtual-session'}:latest,adminSession:Promise.resolve({context:'virtual-session'}),esc,dailyBatchReport,$:id=>nodes[id]??={},flash(){},showError:error=>errors.push(error.message),window:{print(){prints++;}},render:async()=>{}};
  assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end),context);
  await context.showBatchPreview([],[],1,false,null,false,[report]);assert.equal(groups.length,1);assert.match(groups[0].innerHTML,/self-checks\/3\/signature/);
  await nodes['#batch-print'].onclick();assert.equal(prints,1);
  latest=[{...row,answers:{...workerAnswers,sober:false}}];await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.match(errors.at(-1),/변경/);
  latest=[row];imageChanged=true;await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.match(errors.at(-1),/서명 이미지/);
});

test('자가점검 출력 API와 서명은 전역 관리자에만 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-print-checks-')),store=new Store(join(dir,'jweb.sqlite')),{site,other,worker,staff}=fixture(store);store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],path=`/api/sites/${site.id}/print-self-checks?date=${date}`;
    assert.equal((await call(path)).status,401);const response=await call(path,'GET',null,admin);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).length,4);
    assert.equal((await call(`/api/sites/${site.id}/print-self-checks?date=2024-02-30`,'GET',null,admin)).status,400);
    const signatures=[`/api/sites/${site.id}/manager-checks/signature?date=${date}`,`/api/sites/${site.id}/reviewer-manager-checks/${staff.id}/signature?date=${date}`,`/api/sites/${site.id}/self-checks/${worker.id}/signature?date=${date}&preview=1`];
    for(const url of signatures){const image=await call(url,'GET',null,admin);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);}
    assert.equal((await call(`/api/sites/${other.id}/manager-checks/signature?date=${date}`,'GET',null,admin)).status,404);
    assert.equal((await call(`/api/sites/${other.id}/self-checks/${worker.id}/signature?date=${date}&preview=1`,'GET',null,admin)).status,404);
    const created=await call('/api/admin-accounts','POST',{loginId:'limited_checks',name:'가상 제한 관리자',password,scope:'restricted',siteIds:[site.id]},admin);assert.equal(created.status,201);
    const limited=(await call('/api/login','POST',{loginId:'limited_checks',password})).headers.get('set-cookie').split(';')[0];
    assert.equal((await call(path,'GET',null,limited)).status,403);for(const url of signatures)assert.equal((await call(url,'GET',null,limited)).status,403);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
