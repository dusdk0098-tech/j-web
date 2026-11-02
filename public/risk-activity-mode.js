export function mountRiskActivityMode(form){
  const {kind,entryMode,periodFrom,periodTo,place,host,participants,content,classification}=form.elements;
  const label=input=>{const node=input.closest('label');node.classList.add('risk-activity-mode-field');return node;};
  const periods=[periodFrom,periodTo].map(input=>label(input)),modeLabel=label(entryMode),classificationLabel=label(classification);
  const manual=[place,host,participants,content].map(label).concat([...form.querySelectorAll('fieldset')]);
  const update=()=>{
    const weekly=kind.value==='weekly',scan=weekly&&entryMode.value==='scan';
    for(const node of periods)node.hidden=!weekly&&!periodFrom.value&&!periodTo.value;
    entryMode.disabled=!weekly;modeLabel.hidden=!weekly;
    for(const node of manual)node.hidden=scan;
    classification.disabled=kind.value!=='other';classificationLabel.hidden=kind.value!=='other';
    form.querySelector('[data-risk-scan-notice]').hidden=!scan;
  };
  kind.addEventListener('change',update);entryMode.addEventListener('change',update);update();
}
