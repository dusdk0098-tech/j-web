import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSiteAttendance } from '../public/site-statistics.js';

test('현장별 출역의 구분을 임의로 합치지 않고 전체 합계를 계산한다',()=>{
  const rows=[{id:1,name:'가상 A',categories:[{label:'직영',days:2},{label:'협력업체 근로자',days:3}]},{id:2,name:'가상 B',categories:[{label:'외주',days:4},{label:'협력업체 근로자',days:1}]},{id:3,name:'빈 현장',categories:[]}];
  const result=summarizeSiteAttendance(rows);
  assert.deepEqual(result.sites.map(({direct,external,other,total})=>({direct,external,other,total})),[{direct:2,external:0,other:[{label:'협력업체 근로자',days:3}],total:5},{direct:0,external:4,other:[{label:'협력업체 근로자',days:1}],total:5},{direct:0,external:0,other:[],total:0}]);
  assert.deepEqual(result.totals,{direct:2,external:4,other:[{label:'협력업체 근로자',days:4}],total:10});
  assert.deepEqual(summarizeSiteAttendance([]),{sites:[],totals:{direct:0,external:0,other:[],total:0}});
});
