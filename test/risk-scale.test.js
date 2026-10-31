import test from 'node:test';
import assert from 'node:assert/strict';
import { riskScaleOptions, riskScore, copyRiskItem, copyRiskImprovement, groupRiskItems } from '../public/risk-scale.js';
import { Store } from '../store.js';

test('이전 위험요인을 가져올 때 검토 의견을 복사하지 않는다',()=>{
  const original={task:'가상 작업',hazard:'가상 위험',contractorId:123,supervisorOpinion:'감독',safetyOpinion:'안전',healthOpinion:'보건',managerOpinion:'소장'},copy=copyRiskItem(original);
  assert.equal(copy.task,'가상 작업');assert.equal(copy.hazard,'가상 위험');assert.equal(copy.contractorId,123);for(const key of ['supervisorOpinion','safetyOpinion','healthOpinion','managerOpinion'])assert.equal(copy[key],'');assert.equal(original.safetyOpinion,'안전');
});

test('개선 정보 복사는 같은 공정과 협력사에 선택한 항목만 적용한다',()=>{
  const rows=[{processName:' 공정 A ',contractor:'업체 A',dueDate:'2026-11-01',responsible:'가상 담당'},{processName:'공정 A',contractor:'업체 A',dueDate:'',responsible:'기존 담당'},{processName:'공정 A',contractor:'업체 B',dueDate:''},{processName:'공정 B',contractor:'업체 A',dueDate:''},{processName:'',contractor:'',dueDate:''}];
  const result=copyRiskImprovement(rows,0,'dueDate');assert.equal(result[1].dueDate,'2026-11-01');assert.equal(result[1].responsible,'기존 담당');assert.equal(result[2].dueDate,'');assert.equal(result[3].dueDate,'');assert.equal(rows[1].dueDate,'');assert.equal(copyRiskImprovement(rows,4,'dueDate'),rows);assert.equal(copyRiskImprovement(rows,0,'hazard'),rows);
});

test('개선 정보 복사는 동명이업체와 직접 입력을 등록 업체와 구분한다',()=>{
  const rows=[{processName:'공정',contractorId:1,contractor:'동일 이름',responsible:'가상 담당'},{processName:'공정',contractorId:1,contractor:'예전 이름',responsible:''},{processName:'공정',contractorId:2,contractor:'동일 이름',responsible:''},{processName:'공정',contractorId:0,contractor:'동일 이름',responsible:''}];
  const result=copyRiskImprovement(rows,0,'responsible');assert.equal(result[1].responsible,'가상 담당');assert.equal(result[2].responsible,'');assert.equal(result[3].responsible,'');
  const direct=copyRiskImprovement([{processName:'공정',contractorId:0,contractor:'동일 이름',responsible:'담당'},{processName:'공정',contractorId:0,contractor:'동일 이름',responsible:''},{processName:'공정',contractorId:1,contractor:'동일 이름',responsible:''}],0,'responsible');assert.equal(direct[1].responsible,'담당');assert.equal(direct[2].responsible,'');
});

test('위험요인은 공정과 협력사 조합별로 묶고 기존 미기록도 보존한다',()=>{
  const items=[{processName:'가상 공정',contractor:'가상 A',task:'첫 작업'},{processName:'가상 공정',contractor:'가상 B',task:'둘째 작업'},{processName:'가상 공정',contractor:'가상 A',task:'셋째 작업'},{task:'이전 기록'}],groups=groupRiskItems(items);
  assert.equal(groups.length,3);assert.deepEqual(groups[0].items.map(item=>item.task),['첫 작업','셋째 작업']);assert.equal(groups[1].contractor,'가상 B');assert.equal(groups[2].process,'');assert.equal(groups[2].items[0].task,'이전 기록');assert.equal(copyRiskItem(items[0]).processName,'가상 공정');
});

test('위험요인 상세는 같은 이름의 서로 다른 업체와 직접 입력을 구분한다',()=>{
  const groups=groupRiskItems([{processName:'공정',contractorId:1,contractor:'동일 업체',task:'첫 항목'},{processName:'공정',contractorId:2,contractor:'동일 업체',task:'다른 업체'},{processName:'공정',contractor:'동일 업체',task:'직접 입력'},{processName:'공정',contractorId:1,contractor:'동일 업체',task:'같은 업체'}]);
  assert.equal(groups.length,3);assert.deepEqual(groups[0].items.map(row=>row.task),['첫 항목','같은 업체']);assert.equal(groups[1].contractorId,2);assert.equal(groups[2].contractorId,0);
});

test('평가 척도별 선택 범위는 서버 저장 규칙과 일치한다', () => {
  const expected = {
    '': { grade: [], likelihood: [], severity: [] },
    'three-level': { grade: ['상', '중', '하'], likelihood: [], severity: [] },
    '3x3': { grade: [], likelihood: ['1', '2', '3'], severity: ['1', '2', '3'] },
    '5x4': { grade: [], likelihood: ['1', '2', '3', '4', '5'], severity: ['1', '2', '3', '4'] }
  };
  const store = new Store(':memory:');
  try {
    const site = store.createSite({ name: '가상 현장' });
    const base = { siteId: site.id, type: 'risk', title: '가상 평가', date: '2041-01-01' };
    for (const [scale, fields] of Object.entries(expected)) {
      for (const [field, allowed] of Object.entries(fields)) {
        assert.deepEqual(riskScaleOptions(scale, field), allowed);
        for (const value of ['상', '중', '하', '1', '2', '3', '4', '5']) {
          const input = { ...base, details: { scale, items: [{ [field]: value }] } };
          if (allowed.includes(value)) assert.equal(JSON.parse(store.createDocument(input).details).items[0][field], value);
          else assert.throws(() => store.createDocument(input), /척도/);
        }
      }
    }
  } finally { store.close(); }
});

test('시험 점수는 유효한 두 입력의 곱이며 서버에서 다시 계산한다', () => {
  assert.equal(riskScore('3x3','2','3'),6);assert.equal(riskScore('5x4','5','4'),20);
  for(const [scale,likelihood,severity] of [['3x3','4','2'],['3x3','2',''],['5x4','5','5'],['three-level','2','3'],['','1','1']])assert.equal(riskScore(scale,likelihood,severity),null);
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'risk',title:'가상 평가',date:'2041-01-01',details:{scale:'3x3',items:[{likelihood:'2',severity:'3',score:999}]}},doc=store.createDocument(input);
    assert.equal(JSON.parse(doc.details).items[0].score,6);
    const changed=store.updateDocument(doc.id,{...input,details:{scale:'5x4',items:[{likelihood:'5',severity:'4',score:1}]}});assert.equal(JSON.parse(changed.details).items[0].score,20);
    const incomplete=store.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[{likelihood:'2',severity:''}]}});assert.equal(Object.hasOwn(JSON.parse(incomplete.details).items[0],'score'),false);
  }finally{store.close();}
});

test('개선 후 시험 위험성은 척도에 맞게 검증하고 서버에서 계산한다',()=>{
  for(const scale of ['','three-level','3x3','5x4'])for(const [improved,current] of [['improvedGrade','grade'],['improvedLikelihood','likelihood'],['improvedSeverity','severity']])assert.deepEqual(riskScaleOptions(scale,improved),riskScaleOptions(scale,current));
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),base={siteId:site.id,type:'risk',title:'가상 평가',date:'2041-01-01'},row={task:'가상 작업',improvedGrade:'',improvedLikelihood:'2',improvedSeverity:'3',improvedScore:999},input={...base,details:{scale:'3x3',items:[row]}},doc=store.createDocument(input);assert.equal(JSON.parse(doc.details).items[0].improvedScore,6);
    assert.throws(()=>store.updateDocument(doc.id,{...base,details:{scale:'3x3',items:[{task:'이전 화면'}]}}),/새로고침/);assert.equal(JSON.parse(store.document(doc.id).details).items[0].improvedScore,6);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[{...row,improvedLikelihood:'4'}]}}),/척도/);assert.equal(JSON.parse(store.document(doc.id).details).items[0].improvedLikelihood,'2');
    const cleared=store.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[{...row,improvedGrade:'중',improvedLikelihood:'',improvedSeverity:''}]}}),saved=JSON.parse(cleared.details).items[0];assert.equal(saved.improvedGrade,'중');assert.equal(Object.hasOwn(saved,'improvedScore'),false);
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[{...row,improvedGrade:'하',improvedLikelihood:'',improvedSeverity:''}]}});assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).items[0].improvedGrade,'중');
  }finally{store.close();}
});

test('근로자 위험성평가도 개선 후 항목을 보존하고 이전 화면의 저장을 거부한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id),worker=store.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'risk_writer',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});store.setWorkerPermissions(site.id,worker.id,['risk']);
    const row={task:'가상 작업',improvedGrade:'',improvedLikelihood:'5',improvedSeverity:'4'},input={type:'risk',title:'가상 평가',date:'2041-01-01',details:{scale:'5x4',items:[row]}},doc=store.createWorkerDocument(site.id,worker.id,input);assert.equal(JSON.parse(doc.details).items[0].improvedScore,20);
    assert.throws(()=>store.updateWorkerDocument(site.id,worker.id,doc.id,{...input,details:{scale:'5x4',items:[{task:'이전 화면'}]}}),/새로고침/);assert.equal(JSON.parse(store.workerDocument(site.id,worker.id,doc.id).details).items[0].improvedScore,20);
    store.updateWorkerDocument(site.id,worker.id,doc.id,{...input,details:{scale:'5x4',items:[{...row,improvedLikelihood:'',improvedSeverity:''}]}});assert.equal(Object.hasOwn(JSON.parse(store.workerDocument(site.id,worker.id,doc.id).details).items[0],'improvedScore'),false);
  }finally{store.close();}
});
