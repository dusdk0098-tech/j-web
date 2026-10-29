import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceMealChange } from '../public/attendance-meals.js';

test('출역 화면 식당 선택은 기존 단가를 유지하고 명시적 변경만 수행한다',()=>{
  const current={id:5,restaurant_id:7,price:5000};
  assert.equal(attendanceMealChange(current,'7'),null);
  assert.equal(attendanceMealChange(null,''),null);
  assert.deepEqual(attendanceMealChange(current,''),{action:'delete',id:5});
  assert.deepEqual(attendanceMealChange(current,'8'),{action:'save',restaurantId:8});
  assert.deepEqual(attendanceMealChange(null,'8'),{action:'save',restaurantId:8});
  assert.throws(()=>attendanceMealChange(current,'0'),/식당/);
  assert.throws(()=>attendanceMealChange(current,'oops'),/식당/);
});
