import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveExamples,officeTemplate,officeSuggestionCurrent,officeValuesForScope,officeSourceContent,officeSourceCurrent,officeDraftSignature } from '../public/office-template.js';
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

test('불러올 업무 문서는 현장과 내용을 확인하고 늦은 응답은 입력을 덮어쓰지 않는다',()=>{
  const rich=[{type:'strong',children:[{type:'text',value:'가상 내용'}]}],source={id:7,site_id:1,type:'office',title:'가상 제목',body:'가상 내용',details:JSON.stringify({kind:'품의서',bodyRich:rich})};
  assert.deepEqual(officeSourceContent(source,1),{title:'가상 제목',body:'가상 내용',rich});
  assert.deepEqual(officeSourceContent({...source,details:'{}'},1),{title:'가상 제목',body:'가상 내용',rich:null});
  for(const changed of [{site_id:2},{type:'risk'},{details:'잘못된 값'},{details:'[]'},{details:'{"bodyRich":"잘못된 값"}'}])assert.throws(()=>officeSourceContent({...source,...changed},1));
  const expected={siteId:1,selected:'7',signatureRevision:4,draft:{title:'기존 제목',rich:[]}},current={...expected,draft:{...expected.draft},connected:true,open:true};
  assert.equal(officeSourceCurrent(expected,current),true);
  for(const changed of [{siteId:2},{selected:'8'},{signatureRevision:5},{draft:{title:'바뀐 제목',rich:[]}},{draft:{title:'기존 제목',rich:[{type:'text',value:'추가'}]}},{connected:false},{open:false}])assert.equal(officeSourceCurrent(expected,{...current,...changed}),false);
});

test('업무 문서 내용이나 결재 선택이 바뀌면 이전 시험 서명을 사용할 수 없다',()=>{
  const signature=officeDraftSignature(),draft={title:'가상 제목',date:'2026-10-30',kind:'품의서',rich:[],reviewers:['1'],references:['2']};
  assert.equal(signature.matches(draft),false);signature.mark(draft);assert.equal(signature.matches({...draft}),true);
  for(const changed of [{title:'다른 제목'},{date:'2026-10-31'},{kind:'기타'},{rich:[{type:'text',value:'변경'}]},{reviewers:['2']},{references:[]}])assert.equal(signature.matches({...draft,...changed}),false);
  signature.clear();assert.equal(signature.matches(draft),false);signature.mark({...draft,title:'새 제목'});assert.equal(signature.matches({...draft,title:'새 제목'}),true);
});
