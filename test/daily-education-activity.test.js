import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('당일 교육 확인에서 같은 현장 근로자의 안전활동을 열고 지난 화면은 무시한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function renderDailyTrainingStatistics('),end=source.indexOf('async function renderAllSiteStatistics(',start);assert.ok(start>=0&&end>start);
  const button={dataset:{dailyActivity:'0'}},section={isConnected:true,innerHTML:'',querySelector:()=>null,querySelectorAll:key=>key==='[data-daily-activity]'?[button]:[]},anchor={isConnected:true,after:()=>{}},rows=[{id:4,name:'<가상 근로자>',company:'가상 업체',category:'직영',kind:'tbm',count:1,signed_count:1,dates:['2026-10-10'],transferredRecords:[{date:'2026-10-10',transferOrigin:{name:'<전환 전 작성자>'}}]}],state={page:'statistics',siteId:7,statisticsMonth:'2026-10',statisticsDay:''};let opened;
  const context={state,detailEpoch:1,content:{querySelector:()=>anchor},api:async()=>rows,document:{createElement:()=>section},today:()=>'',esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),showWorkerActivities:async worker=>{opened=worker;},showError:error=>{throw error;},URLSearchParams};
  runInNewContext(source.slice(start,end)+'\nglobalThis.renderDaily=renderDailyTrainingStatistics;',context);await context.renderDaily(7,'2026-10-01','2026-10-31','2026-10','');assert.match(section.innerHTML,/안전활동 보기/);assert.match(section.innerHTML,/&lt;가상 근로자&gt;/);assert.match(section.innerHTML,/전환 전 기록자: &lt;전환 전 작성자&gt;/);assert.doesNotMatch(section.innerHTML,/<전환 전 작성자>/);button.onclick();assert.equal(opened.id,4);
  opened=null;state.siteId=8;button.onclick();assert.equal(opened,null);state.siteId=7;state.statisticsMonth='2026-11';button.onclick();assert.equal(opened,null);state.statisticsMonth='2026-10';section.isConnected=false;button.onclick();assert.equal(opened,null);
});
