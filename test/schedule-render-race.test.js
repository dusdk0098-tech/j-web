import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('    const siteId=state.siteId,month=state.scheduleMonth',source.indexOf("if(state.page==='schedules')"));
const end=source.indexOf('    const {firstWeekday:first,days}',start);
const load=runInNewContext(`(async function(state,renderEpoch,api,today,getEpoch){${source.slice(start,end).replaceAll('detailEpoch','getEpoch()')}return rows;})`,{URLSearchParams,Promise});

test('늦게 도착한 일정 응답은 나중 화면을 덮지 않는다',async()=>{
  const pending=[],state={siteId:7,page:'schedules',query:'',scheduleView:'calendar'};
  let epoch=1;
  const api=()=>new Promise(resolve=>pending.push(resolve));
  const old=load(state,1,api,()=> '2026-11-07',()=>epoch);
  state.scheduleView='list';epoch=2;
  const latest=load(state,2,api,()=> '2026-11-07',()=>epoch);
  pending[2](['최신']);pending[3]([]);
  assert.deepEqual(await latest,['최신']);
  pending[0](['오래된 결과']);pending[1]([]);
  assert.equal(await old,undefined);
});
