import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function renderManagerEducationAssignments('),end=source.indexOf('async function renderDailyTrainingStatistics(',start);
assert.ok(start>=0&&end>start);

test('직원 지정 현황은 이수와 구분하고 현장 변경 후에는 화면이나 문서 이동을 갱신하지 않는다',async()=>{
  let resolve,section;const state={page:'statistics',siteId:1,statisticsMonth:'2026-11',statisticsDay:''},button={dataset:{assignmentDocument:'7'}},signatureButton={dataset:{assignmentSignature:'1',document:'7'},isConnected:true,after(image){this.image=image;},remove(){this.isConnected=false;}},anchor={isConnected:true,after(node){section=node;}},context={state,detailEpoch:1,content:{querySelector:()=>anchor},today:()=>'',URLSearchParams,educationKinds:{supervisor:'관리감독자'},esc:s=>String(s),api:()=>new Promise(done=>resolve=done),document:{createElement:()=>({isConnected:true,innerHTML:'',querySelectorAll:selector=>selector==='[data-assignment-document]'?[button]:[signatureButton]})},render:async()=>{},showError:error=>{throw error;}};
  runInNewContext(source.slice(start,end)+';globalThis.showAssignments=renderManagerEducationAssignments;',context);
  let pending=context.showAssignments(1,'2026-11-01','2026-11-30','2026-11','');
  state.siteId=2;resolve([{id:1,name:'가상 직원',document_id:7,title:'가상 교육',date:'2026-11-01',kind:'supervisor',active:1}]);await pending;assert.equal(section,undefined);
  state.siteId=1;pending=context.showAssignments(1,'2026-11-01','2026-11-30','2026-11','');resolve([{id:1,name:'가상 직원',document_id:7,title:'가상 교육',date:'2026-11-01',kind:'supervisor',active:1,confirmed_at:'2026-11-01'},{id:1,name:'가상 직원',document_id:8,title:'미확인 교육',date:'2026-11-02',kind:'supervisor',active:1,confirmed_at:null}]);await pending;
  assert.match(section.innerHTML,/시험 확인은 실제 교육 이수를 증명하지 않습니다/);assert.match(section.innerHTML,/가상 교육/);assert.match(section.innerHTML,/1건/);assert.match(section.innerHTML,/확인 완료/);assert.match(section.innerHTML,/미확인/);
  let view=signatureButton.onclick();state.siteId=2;resolve({signature:'YWJj'});await view;assert.equal(signatureButton.image,undefined);
  state.siteId=1;view=signatureButton.onclick();resolve({signature:'YWJj'});await view;assert.equal(signatureButton.image.src,'data:image/png;base64,YWJj');
  state.siteId=2;button.onclick();assert.equal(state.detail,undefined);state.siteId=1;button.onclick();assert.equal(state.detail,7);
});
