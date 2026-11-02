import test from 'node:test';
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
import {freezeBatchImages} from '../public/batch-images.js';
import {siteReportsForDay,reloadDailyBatchRows,dailyBatchReport,hazardReportBody,selectBatchDocuments,selectBatchItems} from '../public/batch-print.js';

const date='2026-11-01',password='virtual-password-123';
const png=new PNG({width:1,height:1});png.data[3]=255;
const bytes=PNG.sync.write(png),photo='data:image/png;base64,'+bytes.toString('base64');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fixture(store){
  const a=store.createSite({name:'<가상 현장 A>'}),b=store.createSite({name:'가상 현장 B'});
  const add=(site,title,day,image)=>{const id=store.createHazardReport(site.id,{title,body:'<가상 위험 내용>',reporter:'가상 신고자',...(image?{photo}:{})});store.db.prepare("UPDATE hazard_reports SET created_at=datetime(?,'utc') WHERE id=?").run(day+' 12:00:00',id);return Number(id);};
  const first=add(a,'<가상 신고 A>',date,true),second=add(a,'가상 신고 B',date,false),old=add(a,'다른 날짜','2026-10-30',false),foreign=add(b,'다른 현장',date,true);
  store.updateHazardReport(a.id,first,{status:'resolved',response:'<가상 조치>'});store.addHazardReply(a.id,first,{body:'<가상 답변>'});
  return {a,b,first,second,old,foreign};
}

test('현장별 일괄 출력은 날짜와 현장을 분리하고 신고 본문·답변·사진을 포함한다',async()=>{
  const store=new Store(':memory:');
  try{
    const {a,b,first,second,old,foreign}=fixture(store),paths=[],api=async path=>{
      paths.push(path);const url=new URL(path,'http://localhost');
      if(url.pathname.endsWith('/hazard-reports'))return store.hazardReports(Number(url.pathname.split('/')[3]),'',url.searchParams.get('from'),url.searchParams.get('to'));
      if(url.pathname==='/api/ppe-issues')return {rows:[]};return [];
    };
    const all=await siteReportsForDay([a,b],date,api),reports=all.filter(row=>row.kind==='hazard-report');
    assert.deepEqual(reports.map(row=>[row.site.id,row.rows[0].id]),[[a.id,second],[a.id,first],[b.id,foreign]]);
    assert.ok(!reports.some(row=>row.rows[0].id===old));assert.ok(paths.includes(`/api/sites/${a.id}/hazard-reports?from=${date}&to=${date}`));
    const report=reports.find(row=>row.rows[0].id===first),html=dailyBatchReport(report,esc);
    for(const text of ['&lt;가상 신고 A&gt;','&lt;가상 위험 내용&gt;','&lt;가상 조치&gt;','&lt;가상 답변&gt;','조치 완료'])assert.ok(html.includes(text),text);
    assert.doesNotMatch(html,/<가상/);assert.match(html,new RegExp(`/api/sites/${a.id}/hazard-reports/${first}/photo\\?preview=1`));
    assert.doesNotMatch(dailyBatchReport(reports.find(row=>row.rows[0].id===second),esc),/<img/);
    assert.deepEqual(await reloadDailyBatchRows(report,api),report.rows);
    store.addHazardReply(a.id,first,{body:'새 가상 답변'});assert.notDeepEqual(await reloadDailyBatchRows(report,api),report.rows);
    assert.throws(()=>selectBatchItems(Array.from({length:18},(_,i)=>({id:i+1})),all,Array.from({length:18},(_,i)=>i+1),reports.map(row=>row.id)),/20개/);
    assert.throws(()=>hazardReportBody({...report.rows[0],id:'1/../../x'},a.id,esc),/다시 확인/);
  }finally{store.close();}
});

test('여러 신고는 현장별로 한 번 재조회하고 내용·사진 변경 시 인쇄하지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);
  const site={id:1,name:'가상 현장'},row=id=>({id,title:'가상 신고 '+id,date,body:'가상 내용',reporter:'가상 신고자',created_at:'2026-11-01 01:00:00',status:'received',response:'',replies:[],has_photo:id===1?1:0}),original=[row(1),row(2)];
  const reports=original.map((item,i)=>({id:i+1,kind:'hazard-report',title:'가상 신고 '+item.id,site,date,rows:[structuredClone(item)]}));
  const nodes={},groups=[],images=[],errors=[],state={page:'site-print',siteId:1,detail:null,admin:{id:1}};let latest=structuredClone(original),picture='first',reads=0,prints=0;
  const fragment={append(group){groups.push(group);for(const match of group.innerHTML.matchAll(/<img[^>]+src="([^"]+)"/g))images.push({getAttribute:()=>match[1].replaceAll('&amp;','&'),decode:async()=>{},complete:true,naturalWidth:1});},querySelectorAll:()=>images};
  const context={freezeBatchImages:(items,active)=>freezeBatchImages(items,active,{fetchImage:async()=>new Response(new Blob([picture],{type:'image/png'})),urls:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}}}),detailEpoch:0,state,content:{children:[],style:{},append(){},querySelectorAll:()=>images},document:{body:{inert:false},createDocumentFragment:()=>fragment,createElement:()=>({})},reloadDailyBatchRows,api:async path=>{if(path==='/api/session')return {authenticated:true,admin:{scope:'global'},context:'virtual-session'};reads++;return structuredClone(latest);},adminSession:Promise.resolve({context:'virtual-session'}),esc,dailyBatchReport,hazardReportBody,$:id=>nodes[id]??={},flash(){},showError:error=>errors.push(error.message),window:{print(){prints++;}},render:async()=>{}};
  assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end),context);await context.showBatchPreview([],[],1,false,null,false,reports);
  assert.equal(groups.length,2);assert.equal(images.length,1);assert.equal(reads,2);
  await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.equal(reads,3);
  latest[1].replies.push({id:1,body:'새 답변'});await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.match(errors.at(-1),/변경/);assert.equal(reads,4);
  latest=structuredClone(original);picture='changed';await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.match(errors.at(-1),/이미지가 변경/);
  picture='first';latest=latest.filter(item=>item.id!==2);await nodes['#batch-print'].onclick();assert.equal(prints,1);assert.match(errors.at(-1),/변경/);
});

test('선택 신고와 문서·신고 함께 인쇄는 선택 자료와 인쇄 요청을 전달한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('    const preview=(ids,autoPrint=false)=>'),end=source.indexOf('\n  }\n}\ntry {const session=',start);assert.ok(start>=0&&end>start);
  const reports=[{id:2,title:'가상 신고'}],filtered=[{id:7,title:'가상 문서'}],calls=[],errors=[],mixed=[],selected={reports:[{dataset:{hazardDocument:'2'}}],documents:[{dataset:{batchDocument:'7'}}]};let reportPrint;
  const controls={append:button=>mixed.push(button)},nodes={'#hazard-select-all':{},'#hazard-preview':{after:button=>{reportPrint=button;}}},section={querySelector:()=>controls,querySelectorAll:selector=>selector==='[data-hazard-document]:checked'?selected.reports:[]},content={querySelectorAll:()=>selected.documents};
  runInNewContext(source.slice(start,end),{reports,filtered,siteId:1,section,content,document:{createElement:()=>({})},$:id=>nodes[id],selectBatchDocuments,selectBatchItems,showBatchPreview:async(...args)=>{calls.push(args);},showError:error=>errors.push(error.message)});
  assert.equal(reportPrint.textContent,'선택 신고 인쇄');assert.deepEqual(mixed.map(button=>button.textContent),['선택 문서와 신고 함께 미리보기','선택 문서와 신고 함께 인쇄']);
  await reportPrint.onclick();assert.deepEqual(Array.from(calls[0][0]),[]);assert.deepEqual(Array.from(calls[0][1],report=>report.id),[2]);assert.equal(calls[0][5],true);
  await mixed[0].onclick();await mixed[1].onclick();assert.deepEqual(Array.from(calls[2][0]),[7]);assert.deepEqual(Array.from(calls[2][1],report=>report.id),[2]);assert.equal(calls[1][5],false);assert.equal(calls[2][5],true);
  selected.reports=[];selected.documents=[];await mixed[1].onclick();assert.equal(calls.length,3);assert.match(errors.at(-1),/선택/);
  selected.reports=[{dataset:{hazardDocument:'999'}}];await reportPrint.onclick();assert.equal(calls.length,3);assert.match(errors.at(-1),/다시 확인/);
});

test('실제 임시 서버에서 신고 출력은 현장·날짜·권한과 사진을 구분한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-print-')),store=new Store(join(dir,'jweb.sqlite')),{a,b,first,second,foreign}=fixture(store);store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],path=`/api/sites/${a.id}/hazard-reports?from=${date}&to=${date}`;
    assert.equal((await call(path)).status,401);
    const api=async url=>{const response=await call(url,'GET',null,admin);if(!response.ok)throw Error('HTTP '+response.status);return response.json();};
    const reports=(await siteReportsForDay([a,b],date,api)).filter(row=>row.kind==='hazard-report');
    assert.deepEqual(reports.map(row=>[row.site.id,row.rows[0].id]),[[a.id,second],[a.id,first],[b.id,foreign]]);
    const selected=reports.find(row=>row.rows[0].id===first),image=await call(`/api/sites/${a.id}/hazard-reports/${first}/photo?preview=1`,'GET',null,admin);
    assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
    assert.equal((await call(`/api/sites/${b.id}/hazard-reports/${first}/photo?preview=1`,'GET',null,admin)).status,404);
    assert.equal((await call(`/api/sites/${a.id}/hazard-reports/${first}/replies`,'POST',{body:'새 시험 답변'},admin)).status,201);
    assert.notDeepEqual(await reloadDailyBatchRows(selected,api),selected.rows);
    assert.equal((await call('/api/admin-accounts','POST',{loginId:'limited_hazard',name:'가상 제한 관리자',password,scope:'restricted',siteIds:[a.id]},admin)).status,201);
    const limited=(await call('/api/login','POST',{loginId:'limited_hazard',password})).headers.get('set-cookie').split(';')[0];
    assert.equal((await call(path,'GET',null,limited)).status,403);assert.equal((await call(`/api/sites/${a.id}/hazard-reports/${first}/photo?preview=1`,'GET',null,limited)).status,403);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
