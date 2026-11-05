const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function weeklyActivitySummaryMarkup(days){
  const kinds=[['notice','공지',day=>day.noticeReads],['tbm','TBM',day=>day.trainingByType.tbm],['education','교육',day=>day.trainingByType.education],['inspection','안전 점검'],['patrol','순회 점검'],['safety_log','안전 업무 일지'],['work_plan','작업계획서'],['checklist','체크리스트']];
  return `<section><h3>주간 가상 활동 합계</h3><p>문서는 모든 상태의 건수이며 확인은 승인된 문서별 시험 기록입니다. 같은 사람이 여러 문서를 확인하면 여러 건으로 계산됩니다. 확인 집계를 제공하지 않는 항목은 —로 표시합니다.</p><div class="table-wrap"><table><thead><tr><th>구분</th><th>문서</th><th>시험 확인 건수</th></tr></thead><tbody>${kinds.map(([type,label,checks])=>`<tr><td>${label}</td><td>${days.reduce((sum,day)=>sum+(day.documents[type]||0),0)}</td><td>${checks?days.reduce((sum,day)=>sum+checks(day),0):'—'}</td></tr>`).join('')}</tbody></table></div></section>`;
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
