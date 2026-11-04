export function mountPlanWorkerOther(root) {
  const training = root.querySelector('[data-plan-training-choice][value="기타"]');
  const signal = root.querySelector('[data-plan-signal-choice][value="기타"]');
  const trainingOther = root.querySelector('[data-plan-training-other]');
  const signalOther = root.querySelector('[data-plan-signal-other]');
  const update = () => {
    trainingOther.hidden = !training.checked;
    signalOther.hidden = !signal.checked;
  };
  training.addEventListener('change', update);
  signal.addEventListener('change', update);
  update();
}
