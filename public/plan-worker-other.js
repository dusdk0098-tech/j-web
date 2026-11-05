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

export function mountPlanWorkerSearch(row,select){
  const search=row.querySelector('[data-plan-worker-search]'),status=row.querySelector('[data-plan-worker-search-status]');
  const update=()=>{const term=search.value.trim().toLocaleLowerCase('ko');let matches=0;for(const option of select.options){if(!option.value){option.hidden=false;continue;}const match=option.textContent.toLocaleLowerCase('ko').includes(term);if(match)matches++;option.hidden=!match&&option.value!==select.value;}status.textContent=`검색 결과 ${matches}명 · 선택한 작업자는 유지됩니다.`;};
  search.addEventListener('input',event=>{if(!event.isComposing)update();});search.addEventListener('compositionend',update);search.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing)event.preventDefault();});select.addEventListener('change',update);update();
}
