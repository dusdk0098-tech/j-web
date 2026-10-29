import test from 'node:test';
import assert from 'node:assert/strict';
import { riskScaleOptions, riskScore, copyRiskItem, groupRiskItems } from '../public/risk-scale.js';
import { Store } from '../store.js';

test('이전 위험요인을 가져올 때 검토 의견을 복사하지 않는다',()=>{
  const original={task:'가상 작업',hazard:'가상 위험',contractorId:123,supervisorOpinion:'감독',safetyOpinion:'안전',healthOpinion:'보건',managerOpinion:'소장'},copy=copyRiskItem(original);
  assert.equal(copy.task,'가상 작업');assert.equal(copy.hazard,'가상 위험');assert.equal(copy.contractorId,123);for(const key of ['supervisorOpinion','safetyOpinion','healthOpinion','managerOpinion'])assert.equal(copy[key],'');assert.equal(original.safetyOpinion,'안전');
});

test('위험요인은 공정과 협력사 조합별로 묶고 기존 미기록도 보존한다',()=>{
  const items=[{processName:'가상 공정',contractor:'가상 A',task:'첫 작업'},{processName:'가상 공정',contractor:'가상 B',task:'둘째 작업'},{processName:'가상 공정',contractor:'가상 A',task:'셋째 작업'},{task:'이전 기록'}],groups=groupRiskItems(items);
  assert.equal(groups.length,3);assert.deepEqual(groups[0].items.map(item=>item.task),['첫 작업','셋째 작업']);assert.equal(groups[1].contractor,'가상 B');assert.equal(groups[2].process,'');assert.equal(groups[2].items[0].task,'이전 기록');assert.equal(copyRiskItem(items[0]).processName,'가상 공정');
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
