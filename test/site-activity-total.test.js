import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const from=source.indexOf("  if(state.page==='site-activity')"),to=source.indexOf("  if(state.page==='hazards')",from);
assert.ok(from>=0&&to>from);

async function screen(result){
  const state={page:'site-activity',siteActivityMonth:result.month},content={},buttons=[],calls=[];
  const target={set innerHTML(value){this.html=value;buttons.push(...[...value.matchAll(/data-site-week="(\d+)" data-week-index="(\d+)"/g)].map(match=>({dataset:{siteWeek:match[1],weekIndex:match[2]}})));},querySelectorAll:()=>buttons};
  const controls={'#site-activity-result':target,'#site-activity-search':{},'#site-activity-month':{value:result.month},'#weekly-start':{value:'',scrollIntoView:()=>calls.push('scroll')},'#weekly-load':{click:()=>calls.push('load')}};
  const context={state,detailEpoch:1,content,$:selector=>controls[selector],URLSearchParams,today:()=> '2026-11-02',api:async path=>{calls.push(path);return result;},render:async()=>calls.push('render'),showError:error=>{throw error;}};
  await runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async()=>{${source.slice(from,to)}})()`,context);
  return {state,content,target,buttons,controls,calls};
}

function addActivity(store,siteId,dates){
  const worker=store.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
  for(const date of dates){store.setAttendance({siteId,workerId:worker.id,date,present:true});store.createDocument({siteId,type:'tbm',title:'가상 활동',date});}
}
function totalRow(html,name,attendance,documents){
  assert.ok(html.includes(`<tr><th>${name}</th><td>출역 ${attendance} 인일 · 문서 ${documents} 건</td>`),`현장 ${name} 합계 ${attendance}/${documents}`);
}

test('윤년 월 경계의 전체 표시 기간과 복수 현장 합계는 월 밖 기록을 포함하고 범위 밖 기록을 제외한다',async()=>{
  const store=new Store(':memory:');try{
    const a=store.createSite({name:'가상 <A>'}),b=store.createSite({name:'가상 B'});
    addActivity(store,a.id,['2024-01-27','2024-01-28','2024-02-03','2024-02-04','2024-02-29','2024-03-02','2024-03-03']);
    addActivity(store,b.id,['2024-02-29']);
    const pending=store.createDocument({siteId:b.id,type:'risk',title:'가상 제출',date:'2024-03-02'});store.transition(pending.id,'submit');
    store.createDocument({siteId:a.id,type:'office',title:'집계 제외',date:'2024-02-29',details:{kind:'기타',otherKind:'가상'}});
    const result=store.monthlySiteActivity('2024-02'),view=await screen(result);
    assert.match(view.target.html,/전체 표시 기간: 2024-01-28 ~ 2024-03-02/);
    assert.match(view.target.html,/<th>전체 표시 기간 합계<\/th>/);
    assert.match(view.target.html,/선택한 월 밖 날짜도 포함/);
    assert.match(view.target.html,/선택 월만의 합계나 원본의 등급·비교점수가 아닙니다/);
    assert.match(view.content.innerHTML,/문서는 모든 상태를 집계/);
    totalRow(view.target.html,'가상 &lt;A&gt;',5,5);totalRow(view.target.html,'가상 B',1,2);
    assert.doesNotMatch(view.target.html,/<A>/);
    assert.equal(view.buttons.length,10);
    assert.deepEqual(view.calls,['/api/monthly-site-activity?month=2024-02']);
    const button=view.buttons.find(item=>Number(item.dataset.siteWeek)===b.id&&item.dataset.weekIndex==='4');await button.onclick();
    assert.equal(view.state.siteId,b.id);assert.equal(view.state.page,'statistics');assert.equal(view.state.statisticsMonth,'2024-02');assert.equal(view.state.statisticsDay,'');assert.equal(view.state.detail,null);
    assert.equal(view.controls['#weekly-start'].value,'2024-02-25');assert.deepEqual(view.calls.slice(1),['render','load','scroll']);
  }finally{store.close();}
});

test('연말과 연초의 표시 기간 합계 및 첫 주 상세 연결은 연도를 정확히 넘긴다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 연말'});
    addActivity(store,site.id,['2024-11-30','2024-12-01','2024-12-28','2024-12-29','2024-12-31','2025-01-01','2025-01-04','2025-01-05','2025-02-01','2025-02-02']);
    const december=await screen(store.monthlySiteActivity('2024-12'));
    assert.match(december.target.html,/전체 표시 기간: 2024-12-01 ~ 2025-01-04/);totalRow(december.target.html,'가상 연말',6,6);
    const january=await screen(store.monthlySiteActivity('2025-01'));
    assert.match(january.target.html,/전체 표시 기간: 2024-12-29 ~ 2025-02-01/);totalRow(january.target.html,'가상 연말',6,6);
    await january.buttons[0].onclick();assert.equal(january.state.statisticsMonth,'2024-12');assert.equal(january.controls['#weekly-start'].value,'2024-12-29');
  }finally{store.close();}
});

test('활동 없는 복수 현장은 6주 모두 연결과 0 합계를 유지한다',async()=>{
  const store=new Store(':memory:');try{
    store.createSite({name:'가상 무활동 A'});store.createSite({name:'가상 무활동 B'});
    const view=await screen(store.monthlySiteActivity('2025-03'));
    assert.match(view.target.html,/전체 표시 기간: 2025-02-23 ~ 2025-04-05/);totalRow(view.target.html,'가상 무활동 A',0,0);totalRow(view.target.html,'가상 무활동 B',0,0);
    assert.equal(view.buttons.length,12);assert.doesNotMatch(view.target.html,/NaN|undefined/);
    view.controls['#site-activity-month'].value='2025-04';view.controls['#site-activity-search'].onclick();assert.equal(view.state.siteActivityMonth,'2025-04');assert.equal(view.calls.at(-1),'render');
  }finally{store.close();}
});

test('현장 없는 경우에도 표시 기간과 기존 빈 상태를 제공한다',async()=>{
  const store=new Store(':memory:');try{
    const view=await screen(store.monthlySiteActivity('2024-02'));
    assert.match(view.target.html,/전체 표시 기간: 2024-01-28 ~ 2024-03-02/);assert.match(view.target.html,/<p>현장이 없습니다\.<\/p>/);assert.doesNotMatch(view.target.html,/<table>/);assert.equal(view.buttons.length,0);
  }finally{store.close();}
});

test('같은 월의 중복 조회가 역순으로 응답해도 최신 합계를 유지한다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 최신 현장'}),previous=store.monthlySiteActivity('2024-02');
    addActivity(store,site.id,['2024-02-29']);const latest=store.monthlySiteActivity('2024-02');
    const pending=[],calls=[],state={page:'site-activity',siteActivityMonth:'2024-02'},target={innerHTML:'',querySelectorAll:()=>[]},controls={'#site-activity-result':target,'#site-activity-search':{},'#site-activity-month':{value:'2024-02'}};
    const run=runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async()=>{${source.slice(from,to)}})`,{state,detailEpoch:1,content:{},$:selector=>controls[selector],URLSearchParams,today:()=> '2026-11-02',api:path=>{calls.push(path);return new Promise(resolve=>pending.push(resolve));},render:async()=>{},showError:error=>{throw error;}});
    const first=run(),second=run();assert.equal(pending.length,2);assert.deepEqual(calls,['/api/monthly-site-activity?month=2024-02','/api/monthly-site-activity?month=2024-02']);
    pending[1](latest);await second;totalRow(target.innerHTML,'가상 최신 현장',1,1);const newestMarkup=target.innerHTML;
    pending[0](previous);await first;assert.equal(target.innerHTML,newestMarkup);totalRow(target.innerHTML,'가상 최신 현장',1,1);
  }finally{store.close();}
});

test('지난 화면의 조회 응답과 주간 버튼은 같은 화면으로 돌아와도 무효다',async()=>{
  const state={page:'site-activity',siteActivityMonth:'2024-02',admin:{id:1}},target={innerHTML:'',querySelectorAll:()=>[button]},button={dataset:{siteWeek:'1',weekIndex:'0'}},controls={'#site-activity-result':target,'#site-activity-search':{}},context={state,detailEpoch:1,content:{},$:key=>controls[key],URLSearchParams,today:()=>'',api:async(_path,_options,current)=>{context.current=current;return {weeks:[{start:'2024-02-04',end:'2024-02-10'}],sites:[{id:1,name:'가상',weeks:[{attendance:0,documents:0}]}]};},render:async()=>{throw Error('이전 버튼에서 이동하면 안 됩니다.');},showError:error=>{throw error;}};
  await runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async()=>{${source.slice(from,to)}})()`,context);assert.equal(context.current(),true);
  context.detailEpoch++;assert.equal(context.current(),false);await button.onclick();assert.equal(state.page,'site-activity');assert.equal(state.siteId,undefined);
});
