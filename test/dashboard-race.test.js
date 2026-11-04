import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';

function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function screen(initialPage='dashboard'){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  const docsRequest=detailEpoch,docsSite=state.siteId,docsPage=state.page');
  const end=source.indexOf("  if(state.page==='statistics'){",start);
  assert.ok(start>=0&&end>start);
  const documents=deferred(),attendance=deferred(),requests=[],tables=[],content={innerHTML:'현재 화면'};
  const context={state:{page:initialPage,siteId:1,admin:{id:1}},detailEpoch:1,content,
    loadDocuments:current=>{context.documentsCurrent=current;return documents.promise;},api:(path,options,current)=>{requests.push(path);context.attendanceCurrent=current;return attendance.promise;},
    today:()=> '2026-11-04',documentTable:rows=>{tables.push(rows);return '';},editDocument:()=>{},wireDocLinks:()=>{},esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),
    $:()=>({}),Number};
  const render=runInNewContext('(async()=>{'+source.slice(start,end)+'})',context);
  return {context,documents,attendance,requests,tables,content,render};
}
test('이전 현장의 문서나 출역 응답은 다른 화면을 덮지 않는다',async()=>{
  for(const stage of ['documents','attendance']){
    for(const change of ['site','page','revisit','admin']){
      const ui=screen(),run=ui.render();
      if(stage==='attendance'){ui.documents.resolve([]);await new Promise(setImmediate);assert.equal(ui.requests.length,1);}
      if(change==='site')ui.context.state.siteId=2;
      if(change==='page')ui.context.state.page='workers';
      if(change==='revisit')ui.context.detailEpoch++;
      if(change==='admin')ui.context.state.admin={id:2};
      assert.equal(ui.context.documentsCurrent(),false);
      if(stage==='attendance')assert.equal(ui.context.attendanceCurrent(),false);
      ui.documents.resolve([]);ui.attendance.resolve([{present:true}]);await run;
      assert.equal(ui.content.innerHTML,'현재 화면',stage+' '+change);
      if(stage==='documents')assert.equal(ui.requests.length,0);
    }
  }
});
test('다른 화면의 문서 조회는 대시보드로 이동한 뒤 표시되지 않는다',async()=>{
  const ui=screen('office-documents'),run=ui.render();ui.context.state.page='dashboard';ui.context.detailEpoch++;
  ui.documents.resolve([]);await run;assert.equal(ui.requests.length,0);assert.equal(ui.content.innerHTML,'현재 화면');
});
test('지난 조회의 오류는 무시하고 현재 조회의 오류는 전달한다',async()=>{
  for(const stage of ['documents','attendance'])for(const stale of [false,true]){
    const ui=screen(),run=ui.render(),error=new Error('조회 실패');
    if(stage==='attendance'){ui.documents.resolve([]);await new Promise(setImmediate);}
    if(stale)ui.context.state.siteId=2;
    ui[stage].reject(error);
    if(stale)await run;else await assert.rejects(run,/조회 실패/);
  }
});
test('현재 현장의 대시보드는 출역 결과를 표시한다',async()=>{
  const ui=screen(),run=ui.render();ui.documents.resolve([]);await new Promise(setImmediate);
  ui.attendance.resolve([{present:true,attendance_category:'직영',attendance_occupation:'가상 <배관>'},{present:true,attendance_category:'직영',attendance_occupation:'가상 <배관>'},{present:false,attendance_category:'미출역',attendance_occupation:'미출역'}]);await run;
  assert.match(ui.content.innerHTML,/오늘 출역/);assert.match(ui.content.innerHTML,/>2명</);
  assert.match(ui.content.innerHTML,/직영: 2명/);assert.match(ui.content.innerHTML,/가상 &lt;배관&gt;: 2명/);assert.doesNotMatch(ui.content.innerHTML,/미출역/);
});
test('출역 당시 구분이 없는 기록을 현재 정보로 추정하지 않는다',async()=>{
  const ui=screen(),run=ui.render();ui.documents.resolve([]);await new Promise(setImmediate);
  ui.attendance.resolve([{present:true,category:'현재 구분',occupation:'현재 직종',attendance_category:null,attendance_occupation:null}]);await run;
  assert.match(ui.content.innerHTML,/기록 없음: 1명/);assert.doesNotMatch(ui.content.innerHTML,/현재 구분|현재 직종/);
});
test('오늘 안전 활동은 선택 현장의 당일 안전 문서와 각 상태를 표시한다',async()=>{
  const ui=screen(),run=ui.render();
  ui.documents.resolve([{id:1,site_id:1,type:'tbm',date:'2026-11-04',status:'pending'},{id:2,site_id:1,type:'notice',date:'2026-11-04',status:'approved'},{id:3,site_id:1,type:'tbm',date:'2026-11-03',status:'draft'},{id:4,site_id:2,type:'tbm',date:'2026-11-04',status:'approved'},{id:5,site_id:1,type:'office',date:'2026-11-04',status:'approved'}]);
  await new Promise(setImmediate);ui.attendance.resolve([]);await run;
  assert.match(ui.content.innerHTML,/오늘 안전 활동/);assert.deepEqual(Array.from(ui.tables[0],d=>[d.id,d.status]),[[1,'pending'],[2,'approved']]);
});
test('실제 서버의 문서 목록과 출역 응답으로 당일 활동을 그린다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-dashboard-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',body,cookie)=>fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=await call('/api/login','POST',{password:'virtual-admin-password'}),cookie=login.headers.get('set-cookie').split(';')[0];
    const site=await (await call('/api/sites','POST',{name:'가상 현장'},cookie)).json();
    const doc=await (await call('/api/documents','POST',{siteId:site.id,type:'notice',title:'가상 공지',date:'2026-11-04'},cookie)).json();
    await call('/api/documents','POST',{siteId:site.id,type:'notice',title:'이전 가상 공지',date:'2026-11-03'},cookie);
    const docs=await (await call(`/api/documents?siteId=${site.id}`,'GET',undefined,cookie)).json(),rows=await (await call(`/api/attendance?siteId=${site.id}&date=2026-11-04`,'GET',undefined,cookie)).json();
    const ui=screen(),run=ui.render();ui.documents.resolve(docs);await new Promise(setImmediate);ui.attendance.resolve(rows);await run;
    assert.deepEqual(Array.from(ui.tables[0],d=>[d.id,d.status]),[[doc.id,'draft']]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
test('저장 후 출입자 정보가 바뀌어도 대시보드는 출역 당시 분류를 표시한다',async()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 배관'});
    store.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-11-04',present:true});
    store.db.prepare('UPDATE workers SET category=?,occupation=? WHERE id=?').run('변경된 구분','변경된 직종',worker.id);
    const ui=screen(),run=ui.render();ui.documents.resolve([]);await new Promise(setImmediate);ui.attendance.resolve(store.attendance(site.id,'2026-11-04'));await run;
    assert.match(ui.content.innerHTML,/직영: 1명/);assert.match(ui.content.innerHTML,/가상 배관: 1명/);assert.doesNotMatch(ui.content.innerHTML,/변경된 구분|변경된 직종/);
  }finally{store.close();}
});
