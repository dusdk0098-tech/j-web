import test from 'node:test';
import assert from 'node:assert/strict';
import { restaurantPrice } from '../public/restaurant-price.js';

test('식비 입력은 부가세를 내림 계산하고 직접 입력한 부가세를 합산한다',()=>{
  assert.deepEqual(restaurantPrice('10009','0',true),{tax:1000,total:11009});
  assert.deepEqual(restaurantPrice('10009','1200'),{tax:1200,total:11209});
  assert.deepEqual(restaurantPrice('0','0',true),{tax:0,total:0});
  assert.deepEqual(restaurantPrice('999999999','999999999'),{tax:999999999,total:1999999998});
  for(const [price,tax] of [['','0'],['-1','0'],['10.5','0'],['1000000000','0'],['10','']])assert.equal(restaurantPrice(price,tax),null);
});
