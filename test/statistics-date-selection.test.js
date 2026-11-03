import test from 'node:test';
import assert from 'node:assert/strict';
import {mountStatisticsDates} from '../public/date-range.js';

test('월을 변경한 뒤 선택한 일을 조회하고 윤년의 일수를 적용한다',async()=>{
  const month={value:'2026-01'},day={value:'31',innerHTML:''},search={},state={},messages=[];let renders=0;
  mountStatisticsDates(month,day,search,state,async()=>{renders++;},message=>messages.push(message),error=>{throw error;});
  month.value='2024-02';month.onchange();assert.equal(day.value,'');assert.match(day.innerHTML,/value="29"/);assert.doesNotMatch(day.innerHTML,/value="30"/);
  day.value='29';search.onclick();assert.deepEqual(state,{statisticsMonth:'2024-02',statisticsDay:'29'});assert.equal(renders,1);
  month.value='2026-02';month.onchange();assert.doesNotMatch(day.innerHTML,/value="29"/);day.value='29';search.onclick();assert.equal(renders,1);assert.match(messages.pop(),/일/);
  day.value='';search.onclick();assert.deepEqual(state,{statisticsMonth:'2026-02',statisticsDay:''});assert.equal(renders,2);
  month.value='2026-13';month.onchange();search.onclick();assert.equal(renders,2);assert.match(messages.pop(),/월/);
});
