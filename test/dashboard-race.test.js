import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function screen(initialPage='dashboard'){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  const docsRequest=detailEpoch,docsSite=state.siteId,docsPage=state.page');
  const end=source.indexOf("  if(state.page==='statistics'){",start);
  assert.ok(start>=0&&end>start);
  const documents=deferred(),attendance=deferred(),requests=[],content={innerHTML:'현재 화면'};
  const context={state:{page:initialPage,siteId:1,admin:{id:1}},detailEpoch:1,content,
    loadDocuments:current=>{context.documentsCurrent=current;return documents.promise;},api:(path,options,current)=>{requests.push(path);context.attendanceCurrent=current;return attendance.promise;},
    today:()=> '2026-11-04',documentTable:()=>'',editDocument:()=>{},wireDocLinks:()=>{},
    $:()=>({}),Number};
  const render=runInNewContext('(async()=>{'+source.slice(start,end)+'})',context);
  return {context,documents,attendance,requests,content,render};
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
  ui.attendance.resolve([{present:true},{present:false}]);await run;
  assert.match(ui.content.innerHTML,/오늘 출역/);assert.match(ui.content.innerHTML,/>1명</);
});
