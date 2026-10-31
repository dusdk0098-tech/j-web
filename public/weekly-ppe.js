const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function weeklyPpeMarkup(days){
  const items=new Map();
  for(const day of days){
    for(const issue of day.ppeIssues){const item=items.get(issue.item)||{quantity:0,confirmed:0,total:0};item.quantity+=issue.quantity;items.set(issue.item,item);}
    for(const receipt of day.ppeReceiptsByItem){const item=items.get(receipt.item);if(item){item.confirmed+=receipt.confirmed;item.total+=receipt.total;}}
  }
  if(!items.size)return '<p>주간 가상 보호구 지급 기록이 없습니다.</p>';
  return `<section><h3>주간 가상 보호구 품목별 내역</h3><p>지급 수량과 시험 서명이 있는 지급 기록의 건수는 서로 다른 단위입니다.</p><div class="table-wrap"><table><thead><tr><th>품목</th><th>지급 수량</th><th>시험 수령 확인 / 지급 기록</th></tr></thead><tbody>${[...items].map(([name,item])=>`<tr><td>${esc(name)}</td><td>${item.quantity}</td><td>${item.confirmed} / ${item.total}건</td></tr>`).join('')}</tbody></table></div></section>`;
}
