export const riskReviewRoles=[['supervisor','관리감독자'],['safety','안전관리자'],['health','보건관리자'],['manager','현장소장'],['chief','대표자']];

export function riskReviewInputs(details,esc){
  const roles=details.riskReviewRoles||{};
  return `<fieldset><legend>평가 담당자 시험 기록</legend><p>직접 입력한 이름과 날짜이며 계정 확인이나 실제 검토·결재를 뜻하지 않습니다.</p>${riskReviewRoles.map(([key,label])=>`<fieldset><legend>${esc(label)}</legend><label>이름<input name="riskRole_${key}_name" maxlength="200" value="${esc(roles[key]?.name||'')}"></label><label>기록일<input type="date" name="riskRole_${key}_date" value="${esc(roles[key]?.date||'')}"></label></fieldset>`).join('')}</fieldset>`;
}
export function readRiskReviewRoles(get){return Object.fromEntries(riskReviewRoles.map(([key])=>[key,{name:get(`riskRole_${key}_name`)||'',date:get(`riskRole_${key}_date`)||''}]));}
export function riskReviewSummary(details,esc){
  const roles=details?.riskReviewRoles;if(!roles||typeof roles!=='object')return '';
  return `<section><h3>평가 담당자 시험 기록</h3><p>직접 입력한 기록이며 계정 확인이나 실제 검토·결재를 뜻하지 않습니다.</p>${riskReviewRoles.map(([key,label])=>`<p>${esc(label)}: ${esc(roles[key]?.name||'미기록')} · ${esc(roles[key]?.date||'미기록')}</p>`).join('')}</section>`;
}

export function mountRiskProcesses(host,rows,companies,esc){
  host.innerHTML='<fieldset><legend>시험 공정 목록</legend><p>공정은 최대 100개까지 먼저 등록할 수 있습니다. 위험요인에서 등록 공정을 선택해 공정명과 협력사를 입력할 수 있습니다. 선택 후 목록을 수정해도 입력한 위험요인은 바뀌지 않습니다. 담당자 지정과 공정별 결재는 아직 제공하지 않습니다.</p><div data-process-list></div><button type="button" data-process-add>공정 추가</button></fieldset>';
  const list=host.querySelector('[data-process-list]');
  const add=row=>{const field=document.createElement('fieldset');field.innerHTML=`<legend>시험 공정</legend><label>공정명<input data-process-name maxlength="200" required value="${esc(row.name||'')}"></label><label>협력사<select data-process-company><option value="0">직영</option>${row.contractorId&&!companies.some(c=>c.id===row.contractorId)?`<option value="${esc(row.contractorId)}" selected>이전 업체 (다시 선택 필요)</option>`:''}${companies.map(c=>`<option value="${c.id}" ${c.id===row.contractorId?'selected':''}>${esc(c.name)} · ${esc(c.trade||'')}</option>`).join('')}</select></label><button type="button" data-process-remove>공정 삭제</button>`;field.querySelector('[data-process-remove]').onclick=()=>field.remove();list.append(field);};
  host.querySelector('[data-process-add]').onclick=()=>{if(list.children.length<100)add({});};
  rows.forEach(add);return {read:()=>[...list.children].map(row=>({name:row.querySelector('[data-process-name]').value,contractorId:Number(row.querySelector('[data-process-company]').value)}))};
}
export function riskProcessSummary(details,esc){return details?.processes?.length?`<section><h3>시험 공정 목록</h3><p>담당자 지정과 공정별 결재는 제공하지 않습니다.</p><ul>${details.processes.map(row=>`<li>${esc(row.name)} · ${esc(row.contractorId?row.contractor:'직영')}</li>`).join('')}</ul></section>`:'';}

export function mountRiskProcessPicker(container,editor,companies,selectors,esc){
  const available=()=>editor.read().filter(row=>row.name.trim()&&(!row.contractorId||companies.some(company=>company.id===row.contractorId)));
  container.addEventListener('focusin',event=>{const select=event.target;if(!select.matches('[data-risk-process]'))return;select.innerHTML='<option value="">직접 입력 또는 공정 선택</option>'+available().map(row=>`<option value="${esc(JSON.stringify([row.name.trim(),row.contractorId]))}">${esc(row.name.trim())} · ${esc(row.contractorId?companies.find(company=>company.id===row.contractorId).name:'직영')}</option>`).join('');});
  container.addEventListener('change',event=>{const select=event.target;if(!select.matches('[data-risk-process]')||!select.value)return;let choice;try{choice=JSON.parse(select.value);}catch{return;}if(!Array.isArray(choice)||choice.length!==2||!available().some(row=>row.name.trim()===choice[0]&&row.contractorId===choice[1]))return;const row=select.closest('fieldset');if(!row||row.parentElement!==container)return;const company=companies.find(item=>item.id===choice[1]);row.querySelector(selectors.process).value=choice[0];row.querySelector(selectors.companySelect).value=choice[1]?String(choice[1]):'';row.querySelector(selectors.companyName).value=company?company.name:'직영';select.value='';});
}
