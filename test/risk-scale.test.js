import test from 'node:test';
import assert from 'node:assert/strict';
import { riskScaleOptions } from '../public/risk-scale.js';
import { Store } from '../store.js';

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
