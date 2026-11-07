import { checklistKindLabels } from './checklist-copy.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function weeklyActivitySummaryMarkup(days){
  const kinds=[['notice','공지',day=>day.noticeReads,day=>day.noticePeople],['tbm','TBM',day=>day.trainingByType.tbm,day=>day.trainingPeopleByType?.tbm],['education','교육',day=>day.trainingByType.education,day=>day.trainingPeopleByType?.education],['inspection','안전 점검'],['patrol','순회 점검'],['safety_log','안전 업무 일지'],['incident','재해 보고서'],['risk','위험성평가'],['work_plan','작업계획서'],['instruction','작업지시서'],['checklist','체크리스트']];
  const daily=kinds.map(([type,label,checks,people])=>`<section><h4>${label}</h4><div class="table-wrap"><table><thead><tr><th>날짜</th><th>문서</th>${checks?'<th>시험 확인 건수</th>':''}${people?'<th>확인 근로자 수</th>':''}${type==='education'?'<th>직원 시험 확인 건수</th><th>확인 직원 수</th>':''}</tr></thead><tbody>${days.map(day=>`<tr><td>${esc(day.date)}</td><td>${esc(day.documents[type]||0)}</td>${checks?`<td>${esc(checks(day))}</td>`:''}${people?`<td>${esc(people(day)??'—')}</td>`:''}${type==='education'?`<td>${esc(day.educationStaffChecks??'—')}</td><td>${esc(day.educationStaffPeople??'—')}</td>`:''}</tr>`).join('')}</tbody></table></div></section>`).join('');
  return `<section><h3>주간 가상 활동 합계</h3><p>문서는 모든 상태의 건수이며 재해 보고서 수는 실제 사고 건수나 신고 여부가 아닙니다. 확인은 승인된 문서별 시험 기록입니다. 같은 사람이 여러 문서를 확인하면 여러 건으로 계산됩니다. 날짜별 확인 근로자 수는 같은 날 같은 종류의 승인 문서를 확인한 근로자를 중복 없이 세며 직원과 별도 당일 교육 확인은 포함하지 않습니다. 교육의 직원 확인 건수와 중복 없는 직원 수는 별도로 표시하며 문서 수정 전 확인은 제외합니다. 확인 집계를 제공하지 않는 항목은 —로 표시합니다.</p><div class="table-wrap"><table><thead><tr><th>구분</th><th>문서</th><th>시험 확인 건수</th></tr></thead><tbody>${kinds.map(([type,label,checks])=>`<tr><td>${label}</td><td>${days.reduce((sum,day)=>sum+(day.documents[type]||0),0)}</td><td>${checks?days.reduce((sum,day)=>sum+checks(day),0):'—'}</td></tr>`).join('')}</tbody></table></div><details><summary>활동별 날짜 내역 보기</summary>${daily}</details></section>`;
}

export function weeklyChecklistMarkup(days){
  return `<section><h3>날짜별 가상 체크리스트 종류</h3><p>문서는 모든 상태의 건수입니다. 자가점검은 별도 저장된 기록이며 실제 제출이나 완료를 뜻하지 않습니다.</p><div class="table-wrap"><table><thead><tr><th>날짜</th><th>종류별 기록 수</th></tr></thead><tbody>${days.map(day=>{const counts=new Map();for(const check of day.checklists||[]){const label=check.kind==='custom'?'사용자 정의 점검표':Object.hasOwn(checklistKindLabels,check.kind)?checklistKindLabels[check.kind]:check.kind?'알 수 없는 종류':'종류 미기록';counts.set(label,(counts.get(label)||0)+1);}if(day.workerChecks)counts.set('출입자 자가점검',day.workerChecks);if(day.managerChecks)counts.set('관리자·직원 자가점검',day.managerChecks);return `<tr><td>${esc(day.date)}</td><td>${counts.size?[...counts].map(([label,count])=>`${esc(label)} ${esc(count)}건`).join(' · '):'기록 없음'}</td></tr>`;}).join('')}</tbody></table></div></section>`;
}

export function weeklyPpeMarkup(days){
  const items=new Map();
  for(const day of days){
    for(const issue of day.ppeIssues){const item=items.get(issue.item)||{quantity:0,confirmed:0,total:0};item.quantity+=issue.quantity;items.set(issue.item,item);}
    for(const receipt of day.ppeReceiptsByItem){const item=items.get(receipt.item);if(item){item.confirmed+=receipt.confirmed;item.total+=receipt.total;}}
  }
  if(!items.size)return '<p>주간 가상 보호구 지급 기록이 없습니다.</p>';
  return `<section><h3>주간 가상 보호구 품목별 내역</h3><p>지급 수량과 시험 서명이 있는 지급 기록의 건수는 서로 다른 단위입니다.</p><div class="table-wrap"><table><thead><tr><th>품목</th><th>지급 수량</th><th>시험 수령 확인 / 지급 기록</th></tr></thead><tbody>${[...items].map(([name,item])=>`<tr><td>${esc(name)}</td><td>${item.quantity}</td><td>${item.confirmed} / ${item.total}건</td></tr>`).join('')}</tbody></table></div></section>`;
}
