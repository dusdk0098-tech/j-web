import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyQuantities,displayTenths,quantityTenths } from '../public/daily-quantities.js';

test('일보 수량은 소수 첫째 자리까지 더하고 미입력을 구분한다',()=>{
  assert.deepEqual(dailyQuantities([{previous:'1.1',day:'0.2'},{previous:'0',day:'2.7'}]),{entries:[{previous:11,day:2,total:13},{previous:0,day:27,total:27}],totals:{previous:11,day:29,total:40}});
  assert.deepEqual(dailyQuantities([{previous:'',day:'0'}]),{entries:[null],totals:null});
  assert.deepEqual(dailyQuantities([]),{entries:[],totals:null});
  assert.equal(quantityTenths('2.55'),null);assert.equal(quantityTenths('-1'),null);assert.equal(displayTenths(13),'1.3');assert.equal(displayTenths(null),'미입력');
});
