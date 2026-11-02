import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {educationTimeField,educationMethodFields,readEducationMethod} from '../public/education-kinds.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('교육 시간 선택은 05~22시 5분 간격이며 기존 임의 분을 보존한다',()=>{
  const html=educationTimeField('timeFrom','시작','04:17',esc),values=[...html.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(values.length,217);assert.ok(values.includes('05:00'));assert.ok(values.includes('22:55'));assert.ok(!values.includes('23:00'));assert.match(html,/value="04:17" selected/);
  for(const value of values.filter(v=>v&&v!=='04:17'))assert.equal(Number(value.slice(3))%5,0);
  assert.doesNotMatch(educationTimeField('timeFrom','시작','"><script>',esc),/<script>/);
});

test('교육방법은 강의식 기본·복수·모두 해제·기존 자유 입력과 HTML 이스케이프를 유지한다',()=>{
  assert.match(educationMethodFields({},esc),/value="강의식" checked/);
  assert.equal((educationMethodFields({educationMethod:'시청각, 토의식'},esc).match(/ checked/g)||[]).length,2);
  assert.doesNotMatch(educationMethodFields({educationMethod:''},esc),/ checked/);
  assert.match(educationMethodFields({educationMethod:'가상 이전 방식'},esc),/value="가상 이전 방식" checked/);
  assert.doesNotMatch(educationMethodFields({educationMethod:'"><script>'},esc),/<script>/);
  assert.equal(readEducationMethod({querySelectorAll:selector=>{assert.equal(selector,'[data-education-method]:checked');return [{value:'강의식'},{value:'토의식'}];}}),'강의식, 토의식');
});

test('사용교재·복수 방법·첨부 종류는 이전 클라이언트 수정·결재 사본·근로자 열람까지 유지된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상',occupation:'가상'}),base={siteId:site.id,type:'education',title:'가상 교육',date:'2026-11-02'},details={kind:'regular',timeFrom:'04:17',timeTo:'23:01',educationPlace:'가상 장소',educationMethod:'강의식, 토의식',textbook:'가상 사용교재',instructor:'가상 강사'},doc=s.createDocument({...base,details});
    s.updateDocument(doc.id,{...base,details:{kind:'regular'}});assert.deepEqual(JSON.parse(s.document(doc.id).details),details);
    for(const textbook of [[],{},'가'.repeat(2001)])assert.throws(()=>s.updateDocument(doc.id,{...base,details:{textbook}}));
    const bytes=Buffer.from('가상 자료'),material=s.addAttachment(doc.id,'자료.txt',bytes,'education_material'),photo=s.addAttachment(doc.id,'사진.png',Buffer.from('89504e470d0a1a0a','hex'),'education_photo'),legacy=s.addAttachment(doc.id,'이전.txt',bytes);
    assert.deepEqual(s.attachments(doc.id).map(f=>f.category),['education_material','education_photo','general']);assert.deepEqual(Buffer.from(s.attachment(material).data),bytes);
    assert.throws(()=>s.addAttachment(doc.id,'위조.png',bytes,'education_photo'),/PNG/);
    assert.throws(()=>s.addAttachment(doc.id,'자료.txt',bytes,'education_material',()=>{throw Error('가상 권한 거절');}),/권한/);
    const other=s.createDocument({...base,type:'tbm'});assert.throws(()=>s.addAttachment(other.id,'자료.txt',bytes,'education_material'),/첨부 구분/);
    s.transition(doc.id,'submit');const cycle=s.approvalCycle(doc.id,s.document(doc.id).approval_cycle_id);assert.equal(JSON.parse(cycle.document.details).textbook,details.textbook);assert.deepEqual(cycle.attachments.map(f=>f.category),['education_material','education_photo','general']);
    assert.throws(()=>s.addAttachment(doc.id,'자료.txt',bytes,'education_material'),/임시저장/);
    s.transition(doc.id,'approve');const [training]=s.workerTraining(worker.id,base.date);assert.equal(training.details.textbook,details.textbook);assert.equal(training.details.educationMethod,details.educationMethod);assert.deepEqual(training.files.map(f=>[f.id,f.category]),[[material,'education_material'],[photo,'education_photo'],[legacy,undefined]]);
    assert.deepEqual(training.files.find(file=>file.id===legacy),{id:Number(legacy),name:'이전.txt',size:bytes.length});
    const draft=s.createDocument({...base,details});s.updateDocument(draft.id,{...base,details:{textbook:'',educationMethod:''}});assert.equal(JSON.parse(s.document(draft.id).details).textbook,'');assert.equal(JSON.parse(s.document(draft.id).details).educationMethod,'');
  }finally{s.close();}
});

