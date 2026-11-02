import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceNoticesMarkup} from '../public/attendance-matrix.js';

test('월별 출역 안내는 다음 달 5일에 두 문단을 표시하고 6일부터 숨긴다',()=>{
  for(const date of ['2026-11-01','2026-12-04','2026-12-05']){
    const html=attendanceNoticesMarkup('2026-11',date);
    assert.equal((html.match(/<p /g)||[]).length,2);
    assert.match(html,/2026-12-05/);
    assert.match(html,/기한 이후에도 시험 변경을 허용/);
    assert.match(html,/교육·TBM 명부에 표시되는 소속·직종 정보에 반영/);
    assert.match(html,/교육 대상자는 자동으로 변경되지 않습니다/);
  }
  assert.equal(attendanceNoticesMarkup('2026-11','2026-12-06'),'');
  assert.equal(attendanceNoticesMarkup('2026-11','2027-01-01'),'');
});

test('월별 출역 안내의 기한은 연말과 윤년에도 같은 달력 기준을 따른다',()=>{
  assert.match(attendanceNoticesMarkup('2026-12','2027-01-05'),/2027-01-05/);
  assert.equal(attendanceNoticesMarkup('2026-12','2027-01-06'),'');
  assert.match(attendanceNoticesMarkup('2024-02','2024-02-29'),/2024-03-05/);
  assert.match(attendanceNoticesMarkup('2024-02','2024-03-05'),/2024-03-05/);
  assert.equal(attendanceNoticesMarkup('2024-02','2024-03-06'),'');
  assert.equal(attendanceNoticesMarkup('9999-12','9999-12-31'),'');
});

test('월별 출역 안내는 명시적이고 유효한 조회 월과 기준 날짜를 요구한다',()=>{
  for(const month of [undefined,null,'','2026-1','2026-13','0999-01','2026-11<script>'])assert.throws(()=>attendanceNoticesMarkup(month,'2026-12-05'),/조회할 월/);
  for(const date of [undefined,null,new Date(),'','2026-12-5','2026-13-01','2026-02-29','2024-02-30','2026-04-31','0999-01-01','2026-12-05T00:00:00Z','2026-12-05<script>'])assert.throws(()=>attendanceNoticesMarkup('2026-11',date),/기준 날짜/);
});
