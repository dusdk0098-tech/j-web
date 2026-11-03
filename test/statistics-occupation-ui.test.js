import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {summarizeSiteAttendance} from '../public/site-statistics.js';

test('선택 현장의 직종별 출역을 표시하고 지난 화면의 응답은 무시한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function renderAllSiteStatistics('),end=source.indexOf('async function showRestrictedQr(',start);assert.ok(start>=0&&end>start);
  let attached=0,resolveOccupations,requests=[];
  const state={page:'statistics',siteId:7,statisticsMonth:'2026-10',statisticsDay:''},section={isConnected:true,innerHTML:'',insertAdjacentHTML(_where,html){this.innerHTML+=html;},querySelectorAll:()=>[]},anchor={isConnected:true,before:()=>attached++};
  const context={state,content:{querySelector:()=>anchor},document:{createElement:()=>section},today:()=>'',esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),summarizeSiteAttendance,URLSearchParams,api:path=>{requests.push(path);return path.includes('sites-report')?Promise.resolve([]):new Promise(resolve=>{resolveOccupations=resolve;});}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.renderStatistics=renderAllSiteStatistics;',context);
  let pending=context.renderStatistics(7,'2026-10-01','2026-10-31','2026-10','');assert.match(requests[1],/siteId=7.*group=occupation/);resolveOccupations([{label:'<가상 직종>',days:3}]);await pending;assert.equal(attached,1);assert.match(section.innerHTML,/&lt;가상 직종&gt;/);assert.match(section.innerHTML,/<td>3<\/td>/);
  pending=context.renderStatistics(7,'2026-10-01','2026-10-31','2026-10','');state.siteId=8;resolveOccupations([{label:'이전 현장',days:1}]);await pending;assert.equal(attached,1);assert.doesNotMatch(section.innerHTML,/이전 현장/);
  state.siteId=7;pending=context.renderStatistics(7,'2026-10-01','2026-10-31','2026-10','');state.statisticsDay='12';resolveOccupations([{label:'이전 기간',days:1}]);await pending;assert.equal(attached,1);assert.doesNotMatch(section.innerHTML,/이전 기간/);
  state.statisticsDay='';pending=context.renderStatistics(7,'2026-10-01','2026-10-31','2026-10','');resolveOccupations([]);await pending;assert.equal(attached,2);assert.match(section.innerHTML,/출역 기록이 없습니다/);
});
