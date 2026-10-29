import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSafetyLogSources } from '../public/safety-log-sources.js';

test('안전 업무 일지는 선택한 가상 자료로 빈 항목만 채운다',()=>{
  const current={weather:'기존 날씨',todayWork:'',notices:'',training:'',inspection:'',notes:''},selected={daily:{type:'daily_report',details:JSON.stringify({weather:'다른 날씨',todayWork:'가상 작업'})},notice:{type:'notice',body:'가상 공지'},training:{type:'education',body:'가상 교육'},inspection:{type:'patrol',details:JSON.stringify({instruction:'가상 지시',notes:'가상 특기'})}};
  const result=mergeSafetyLogSources(current,selected);assert.equal(result.values.weather,'기존 날씨');assert.equal(result.values.todayWork,'가상 작업');assert.equal(result.values.notices,'가상 공지');assert.equal(result.values.training,'가상 교육');assert.equal(result.values.inspection,'가상 지시');assert.equal(result.values.notes,'가상 특기');assert.equal(current.todayWork,'');
  assert.deepEqual(mergeSafetyLogSources(current,{}).copied,[]);assert.throws(()=>mergeSafetyLogSources(current,{notice:{type:'tbm'}}),/자료/);assert.throws(()=>mergeSafetyLogSources(current,{notice:{type:'notice',body:'가'.repeat(4001)}}),/길이/);assert.equal(current.notices,'');
});
