import { riskScaleOptions, riskScore, copyMusculoskeletalItems } from './risk-scale.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={processName:'가상 공정명',contractor:'가상 협력사',task:'작업 내용',hazard:'부담 요인',existingMeasures:'현재 조치',additionalMeasures:'추가 조치'};
const choices={grade:['상','중','하'],likelihood:['1','2','3','4','5'],severity:['1','2','3','4']};
const choiceLabels={grade:'현재 위험 등급',likelihood:'가능성',severity:'중대성'};

export function mountMusculoskeletal(container,{rows,companies,scale}){
  container.innerHTML='<fieldset><legend>근골격계 가상 위험요인</legend><p>직접 입력한 시험 자료입니다. 자동 참고자료와 실제 위험 판정은 제공하지 않습니다.</p><div data-mus-list></div><button type="button" data-mus-direct>직접 입력 3개 추가</button> <button type="button" data-mus-add>항목 추가</button> <button type="button" data-mus-delete>선택 항목 삭제</button><p data-mus-status role="status"></p></fieldset>';
  const list=container.querySelector('[data-mus-list]'),status=container.querySelector('[data-mus-status]');
  function add(row={}){
    if(list.children.length>=100){status.textContent='근골격계 항목은 100개까지 입력할 수 있습니다.';return;}
    const item=document.createElement('fieldset');
    item.innerHTML=`<legend>근골격계 항목</legend><label><input type="checkbox" data-mus-selected ${row.selected===false?'':'checked'}> 평가에 선택</label><label>현장 협력사 선택<select data-mus-company><option value="0">직접 입력</option>${row.contractorId&&!companies.some(c=>c.id===row.contractorId)?`<option selected value="${esc(row.contractorId)}">이전 업체를 찾을 수 없음</option>`:''}${companies.map(c=>`<option value="${c.id}" ${c.id===row.contractorId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>${Object.entries(fields).map(([key,label])=>`<label>${esc(label)}<input data-mus-field="${key}" maxlength="2000" value="${esc(row[key]||'')}"></label>`).join('')}${Object.entries(choices).map(([key,values])=>`<label>${esc(choiceLabels[key])}<select data-mus-field="${key}"><option value="">미입력</option>${values.map(value=>`<option value="${value}" ${row[key]===value?'selected':''}>${value}</option>`).join('')}</select></label>`).join('')}<p data-mus-score aria-live="polite"></p><button type="button" data-mus-remove>삭제</button> <button type="button" data-mus-up>위로 이동</button> <button type="button" data-mus-down>아래로 이동</button>`;
    list.append(item);refresh();
  }
  function conflicts(value){return [...list.querySelectorAll('select[data-mus-field]')].some(input=>input.value&&!riskScaleOptions(value,input.dataset.musField).includes(input.value));}
  function refresh(){
    for(const input of list.querySelectorAll('select[data-mus-field]')){const options=riskScaleOptions(scale(),input.dataset.musField);input.disabled=!options.length&&!input.value;for(const option of input.options)option.disabled=!!option.value&&!options.includes(option.value);}
    for(const row of list.children){const score=riskScore(scale(),row.querySelector('[data-mus-field=likelihood]').value,row.querySelector('[data-mus-field=severity]').value);row.querySelector('[data-mus-score]').textContent=score===null?'시험 점수: 미입력':`시험 점수: ${score}`;}
  }
  function append(items){const copied=copyMusculoskeletalItems(items,list.children.length,scale());copied.forEach(add);return copied.length;}
  const direct=container.querySelector('[data-mus-direct]');
  direct.onclick=()=>{
    if(direct.matches(':disabled')||container.closest('form')?.querySelector('button[type=submit]')?.disabled)return;
    try{append(Array.from({length:3},()=>({selected:true})));status.textContent='빈 항목 3개를 추가했습니다. 내용을 입력한 뒤 저장하세요.';container.dispatchEvent(new Event('input',{bubbles:true}));}
    catch(error){status.textContent=error.message;}
  };
  container.querySelector('[data-mus-add]').onclick=()=>add();
  container.querySelector('[data-mus-delete]').onclick=()=>{for(const row of [...list.children])if(row.querySelector('[data-mus-selected]').checked)row.remove();};
  list.addEventListener('change',event=>{if(event.target.matches('[data-mus-company]')){const company=companies.find(c=>c.id===Number(event.target.value));if(company)event.target.closest('fieldset').querySelector('[data-mus-field=contractor]').value=company.name;}refresh();});
  list.addEventListener('click',event=>{const row=event.target.closest('fieldset');if(!row||row.parentElement!==list)return;if(event.target.matches('[data-mus-remove]'))row.remove();if(event.target.matches('[data-mus-up]')&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);if(event.target.matches('[data-mus-down]')&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);if(event.target.matches('[data-mus-up],[data-mus-down]'))event.target.focus();});
  rows.forEach(add);
  return {refresh,conflicts,append,read(){return [...list.children].map(row=>{const result=Object.fromEntries([...row.querySelectorAll('[data-mus-field]')].map(input=>[input.dataset.musField,input.value])),id=Number(row.querySelector('[data-mus-company]').value);if(id)result.contractorId=id;result.selected=row.querySelector('[data-mus-selected]').checked;return result;});}};
}
