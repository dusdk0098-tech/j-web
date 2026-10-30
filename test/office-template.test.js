import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveExamples,officeTemplate } from '../public/office-template.js';

test('가상 업무 예시는 빈 내용에만 적용하고 기존 제목을 보존한다',()=>{
  const proposal=officeTemplate('품의서','','직접 입력한 제목','');assert.equal(proposal.title,'직접 입력한 제목');assert.match(proposal.body,/안건:/);assert.equal(officeTemplate('품의서','','','').title,'가상 품의');
  assert.deepEqual(Object.values(leaveExamples),['휴가','오전 반차','오후 반차','조퇴','예비군','민방위']);for(const [key,label] of Object.entries(leaveExamples)){const result=officeTemplate('휴가신청서',key,'직접 제목','');assert.equal(result.title,'직접 제목');assert.match(result.body,new RegExp(label));assert.match(result.body,/기간:/);assert.match(result.body,/사유:/);}
  assert.throws(()=>officeTemplate('휴가신청서','leave','기존 제목','작성 중인 내용'),/내용이 이미/);assert.throws(()=>officeTemplate('휴가신청서','wrong','',''),/예시/);assert.throws(()=>officeTemplate('기타','leave','',''),/예시/);
});
