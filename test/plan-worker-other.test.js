import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanWorkerOther } from '../public/plan-worker-other.js';

test('기타 선택에 따라 설명란을 표시하고 입력값을 보존한다', () => {
  const training = { checked: false, addEventListener(_type, fn) { this.change = fn; } };
  const signal = { checked: true, addEventListener(_type, fn) { this.change = fn; } };
  const trainingOther = { value: '교육 내용' };
  const signalOther = { value: '신호 내용' };
  const controls = {
    '[data-plan-training-choice][value="기타"]': training,
    '[data-plan-signal-choice][value="기타"]': signal,
    '[data-plan-training-other]': trainingOther,
    '[data-plan-signal-other]': signalOther
  };
  mountPlanWorkerOther({ querySelector: selector => controls[selector] });
  assert.equal(trainingOther.hidden, true);
  assert.equal(signalOther.hidden, false);
  training.checked = true;
  signal.checked = false;
  training.change();
  assert.equal(trainingOther.hidden, false);
  assert.equal(signalOther.hidden, true);
  training.checked = false;
  training.change();
  assert.equal(trainingOther.hidden, true);
  assert.equal(trainingOther.value, '교육 내용');
  assert.equal(signalOther.value, '신호 내용');
});
