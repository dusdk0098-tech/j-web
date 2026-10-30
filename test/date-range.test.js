import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRangePreset } from '../public/date-range.js';

test('문서 날짜 선택은 월말과 연말, 윤년을 정확히 계산한다',()=>{
  assert.deepEqual(dateRangePreset('2026-01-01','yesterday'),{from:'2025-12-31',to:'2025-12-31'});
  assert.deepEqual(dateRangePreset('2026-10-30','today'),{from:'2026-10-30',to:'2026-10-30'});
  assert.deepEqual(dateRangePreset('2024-02-03','month'),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(dateRangePreset('2026-02-03','month'),{from:'2026-02-01',to:'2026-02-28'});
  assert.deepEqual(dateRangePreset('2026-12-03','month'),{from:'2026-12-01',to:'2026-12-31'});
});
