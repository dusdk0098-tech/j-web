import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveExamples,officeTemplate,officeSuggestionCurrent,officeValuesForScope } from '../public/office-template.js';
import { documentRichLimits,normalizeRichText,richTextToPlain } from '../public/rich-text.js';

test('가상 업무 예시는 빈 내용에만 적용하고 기존 제목을 보존한다',()=>{
  const proposal=officeTemplate('품의서','','직접 입력한 제목','');assert.equal(proposal.title,'직접 입력한 제목');assert.match(proposal.body,/안건:/);assert.equal(officeTemplate('품의서','','','').title,'가상 품의');
  assert.deepEqual(Object.values(leaveExamples),['휴가','오전 반차','오후 반차','조퇴','예비군','민방위']);for(const [key,label] of Object.entries(leaveExamples)){const result=officeTemplate('휴가신청서',key,'직접 제목','');assert.equal(result.title,'직접 제목');assert.match(result.body,new RegExp(label));assert.match(result.body,/기간:/);assert.match(result.body,/사유:/);assert.equal(normalizeRichText(result.rich,documentRichLimits)[0].type,'table');assert.match(richTextToPlain(result.rich,documentRichLimits),new RegExp(label));}
  assert.throws(()=>officeTemplate('휴가신청서','leave','기존 제목','작성 중인 내용'),/내용이 이미/);assert.throws(()=>officeTemplate('휴가신청서','wrong','',''),/예시/);assert.throws(()=>officeTemplate('기타','leave','',''),/예시/);
});

test('늦게 도착한 결재선 제안은 다른 현장·구분이나 직접 선택을 덮어쓰지 않는다',()=>{
  const expected={epoch:4,siteId:1,kind:'품의서',otherKind:'',manual:2,values:['10','20','']},current={...expected,values:[...expected.values],connected:true,open:true,enabled:true};assert.equal(officeSuggestionCurrent(expected,current),true);
  for(const change of [{epoch:5},{siteId:2},{kind:'휴가신청서'},{otherKind:'변경'},{manual:3},{values:['10','30','']},{connected:false},{open:false},{enabled:false}])assert.equal(officeSuggestionCurrent(expected,{...current,...change}),false);
  assert.deepEqual(officeValuesForScope(['10','20'],['10','20'],'품의서','휴가신청서'),['','']);assert.deepEqual(officeValuesForScope(['10','30'],['10','20'],'품의서','휴가신청서'),['10','30']);assert.deepEqual(officeValuesForScope(['10','20'],['10','20'],'품의서','품의서'),['10','20']);
});
