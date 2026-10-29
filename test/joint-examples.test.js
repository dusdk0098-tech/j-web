import test from 'node:test';
import assert from 'node:assert/strict';
import { jointExamples } from '../public/joint-examples.js';
import { recordInput } from '../domain.js';

test('합동 점검 가상 예시는 종류별로 준비되고 기존 입력을 덮어쓰지 않는다',()=>{
  for(const [kind,count] of [['common',24],['building',62],['civil',64]]){
    const items=jointExamples(kind,0);
    assert.equal(items.length,count);assert.equal(new Set(items.map(item=>item.name)).size,count);
    assert.ok(items.every(item=>item.result==='N/A'));
    assert.equal(recordInput({siteId:1,type:'joint_inspection',title:'가상 점검',date:'2026-10-29',details:{items}}).details.items.length,count);
  }
  assert.throws(()=>jointExamples('common',1),/정리/);assert.throws(()=>jointExamples('invalid',0),/종류/);
});
