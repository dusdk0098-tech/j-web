import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTbmSources, mergeTbmSource } from '../public/tbm-sources.js';

test('TBM 자료 목록은 현장과 날짜, 유형을 지키고 현재 문서를 제외한다',()=>{
  const items=[{id:1,site_id:1,type:'tbm',date:'2026-10-28'},{id:2,site_id:2,type:'tbm',date:'2026-10-28'},{id:3,site_id:1,type:'tbm',date:'2026-10-30'},{id:4,site_id:1,type:'notice',date:'2026-10-28'},{id:5,site_id:1,type:'tbm',date:'2026-10-29'}];
  assert.deepEqual(selectTbmSources(items,'tbm',1,'2026-10-29',5).map(item=>item.id),[1]);
  assert.throws(()=>selectTbmSources(items,'invalid',1,'2026-10-29'),/자료 종류/);
});

test('가상 자료는 빈 항목만 복사하고 입력 한도를 넘으면 적용하지 않는다',()=>{
  const current={work:'직접 입력',hazards:'',body:'기존 교육'},source={type:'risk',details:JSON.stringify({items:[{task:'가상 작업',hazard:'위험 A',existingMeasures:'조치 A',additionalMeasures:'추가 B'}]})};
  const result=mergeTbmSource(current,source);
  assert.equal(result.values.work,'직접 입력');assert.equal(result.values.body,'기존 교육');
  assert.match(result.values.hazards,/위험 A/);assert.match(result.values.hazards,/추가 B/);assert.deepEqual(result.copied,['hazards']);
  assert.equal(mergeTbmSource({body:''},{type:'notice',body:'가상 공지'}).values.body,'가상 공지');
  const prior=mergeTbmSource({work:'',body:''},{type:'tbm',body:'가상 교육',details:JSON.stringify({work:'가상 작업'})});
  assert.equal(prior.values.work,'가상 작업');assert.equal(prior.values.body,'가상 교육');
  const empty={hazards:''};assert.throws(()=>mergeTbmSource(empty,{type:'risk',details:JSON.stringify({items:[{hazard:'x'.repeat(4001)}]})}),/초과/);assert.equal(empty.hazards,'');
});
