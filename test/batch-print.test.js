import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { selectBatchDocuments, selectBatchItems, siteDocumentsForDay, siteReportsForDay } from '../public/batch-print.js';

test('문서 미리보기는 현재 목록의 중복 없는 선택만 허용한다',()=>{
  const documents=[{id:4},{id:7}];
  assert.deepEqual(selectBatchDocuments(documents,['7','4']),[7,4]);
  assert.throws(()=>selectBatchDocuments(documents,[]),/선택/);
  assert.throws(()=>selectBatchDocuments(documents,['4','4']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,['8']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,Array.from({length:21},()=>4)),/20개/);
});

test('문서와 신고는 종류별 목록을 검증하며 함께 20개까지 선택한다',()=>{
  const docs=[{id:4},{id:7}],reports=[{id:4},{id:8}];
  assert.deepEqual(selectBatchItems(docs,reports,['4'],['4','8']),{documents:[4],reports:[4,8]});
  assert.deepEqual(selectBatchItems(docs,reports,[],['8']),{documents:[],reports:[8]});
  assert.throws(()=>selectBatchItems(docs,reports,[],[]),/선택/);
  assert.throws(()=>selectBatchItems(docs,reports,['4'],['7']),/확인/);
  assert.throws(()=>selectBatchItems(docs,reports,['4'],['8','8']),/확인/);
  assert.throws(()=>selectBatchItems(docs,reports,Array(11).fill('4'),Array(10).fill('8')),/20개/);
});

test('현장별 일일 문서는 작성 현장과 날짜를 지키고 공유·업무 문서를 제외한다',async()=>{
  const sites=[{id:1,name:'가상 A'},{id:2,name:'가상 B'}],calls=[],api=async path=>{const query=new URL(path,'http://localhost').searchParams,id=Number(query.get('siteId'));calls.push([id,query.get('from'),query.get('to')]);return [{id:id*10,site_id:id,date:'2026-11-01',type:'tbm'},{id:70,site_id:7,date:'2026-11-01',type:'basic'},{id:80+id,site_id:id,date:'2026-11-01',type:'office'},{id:90+id,site_id:id,date:'2026-10-31',type:'tbm'}];};
  const docs=await siteDocumentsForDay(sites,'2026-11-01',api);assert.deepEqual(docs.map(row=>[row.id,row.site_name]),[[10,'가상 A'],[20,'가상 B']]);assert.deepEqual(calls,[[1,'2026-11-01','2026-11-01'],[2,'2026-11-01','2026-11-01']]);await assert.rejects(()=>siteDocumentsForDay([],'2026-11-01',api),/현장/);await assert.rejects(()=>siteDocumentsForDay(sites,'',api),/날짜/);await assert.rejects(()=>siteDocumentsForDay(sites,'2026-11-01',async()=>{throw Error('조회 실패');}),/조회 실패/);
});

test('여러 현장 미리보기는 문서별 현장으로 조회하고 성공과 실패 뒤 원래 현장을 복원한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function showBatchPreview('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);assert.ok(start>=0&&end>start);
  const make=fail=>{const seen=[],state={siteId:9,detail:null},nodes={},content={children:[],style:{},append(){},querySelectorAll:()=>[]},document={body:{inert:false},createDocumentFragment:()=>({append(){}}),createElement:()=>({append(){},prepend(){},querySelectorAll:()=>[]})},context={detailEpoch:0,state,content,document,$:id=>nodes[id]??={},flash(){},showError(){},window:{print(){}},render:async()=>{seen.push(['복구',state.siteId]);},renderDetail:async()=>{seen.push([state.detail,state.siteId]);if(fail===true&&state.detail===2)throw Error('시험 실패');return {id:state.detail,site_id:fail==='mismatch'?99:state.siteId};}};runInNewContext(source.slice(start,end),context);return {context,seen};},docs=[{id:1,site_id:3,site_name:'가상 A'},{id:2,site_id:4,site_name:'가상 B'}];
  const ok=make(false);await ok.context.showBatchPreview([1,2],[],9,false,docs);assert.deepEqual(ok.seen,[[1,3],[2,4]]);assert.equal(ok.context.state.siteId,9);assert.equal(ok.context.state.detail,null);assert.equal(ok.context.document.body.inert,false);
  const failed=make(true);await assert.rejects(()=>failed.context.showBatchPreview([1,2],[],9,false,docs),/시험 실패/);assert.deepEqual(failed.seen,[[1,3],[2,4],['복구',9]]);assert.equal(failed.context.state.siteId,9);assert.equal(failed.context.document.body.inert,false);
  const changed=make('mismatch');await assert.rejects(()=>changed.context.showBatchPreview([1],[],9,false,docs),/현장이 변경/);assert.equal(changed.context.state.siteId,9);assert.equal(changed.context.document.body.inert,false);
});

test('서버에서 가상 두 현장의 같은 날짜 서류만 모은다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-site-print-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,request=(path,method='GET',body,cookie)=>fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),login=await request('/api/login','POST',{password:'virtual-admin-password'}),cookie=login.headers.get('set-cookie').split(';')[0],sites=[];for(const name of ['가상 A','가상 B'])sites.push(await (await request('/api/sites','POST',{name},cookie)).json());
    for(const site of sites)for(const date of ['2026-11-01','2026-10-31'])assert.equal((await request('/api/documents','POST',{siteId:site.id,type:'tbm',title:'가상 서류',date,details:{weather:'맑음'}},cookie)).status,201);
    assert.equal((await request(`/api/documents?siteId=${sites[0].id}`)).status,401);const rows=await siteDocumentsForDay(sites,'2026-11-01',async path=>{const response=await request(path,'GET',null,cookie);assert.equal(response.status,200);return response.json();});assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.site_name),['가상 A','가상 B']);assert.ok(rows.every(row=>row.date==='2026-11-01'));
    for(const site of sites){
      const worker=await (await request('/api/workers','POST',{siteId:site.id,name:'가상 출역자',category:'직영',company:'가상 업체',occupation:'가상 직종'},cookie)).json();
      for(const day of ['2026-11-01','2026-11-02'])assert.equal((await request('/api/ppe-issues','POST',{siteId:site.id,workerId:worker.id,date:day,item:'안전모',quantity:2},cookie)).status,201);
      assert.equal((await request('/api/attendance','POST',{siteId:site.id,workerId:worker.id,date:'2026-11-01',present:true,expectedDayVersion:0},cookie)).status,200);
    }
    const reports=await siteReportsForDay(sites,'2026-11-01',async path=>{const response=await request(path,'GET',null,cookie);assert.equal(response.status,200);return response.json();});
    assert.equal(reports.length,6);assert.deepEqual(reports.filter(report=>report.kind==='ppe-summary').map(report=>report.rows),[[{item:'안전모',quantity:2}],[{item:'안전모',quantity:2}]]);assert.ok(reports.filter(report=>report.kind==='attendance').every(report=>report.rows.length===1&&report.rows[0].attendance_company==='가상 업체'));
    assert.equal((await request('/api/ppe-issues?siteId='+sites[0].id+'&month=2026-11')).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
