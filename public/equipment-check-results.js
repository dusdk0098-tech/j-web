export function equipmentCheckResults(items,escape){
  if(!Array.isArray(items)||!items.length)return '<p>시험 점검 항목이 없습니다.</p>';
  const groups=new Map();
  for(const item of items){if(!item||typeof item!=='object')continue;const type=['일반','장비'].includes(item.checkType)?item.checkType:'유형 미기록';if(!groups.has(type))groups.set(type,[]);groups.get(type).push(item);}
  if(!groups.size)return '<p>시험 점검 항목이 없습니다.</p>';
  return [...groups].map(([type,rows])=>`<h4>${escape(type)} 점검</h4><div class="table-wrap"><table><thead><tr><th>구분</th><th>점검 항목</th><th>판정</th><th>조치</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escape(row.section||'')}</td><td>${escape(row.name||'')}</td><td>${escape(row.result||'')}</td><td>${escape(row.action||'')}</td></tr>`).join('')}</tbody></table></div>`).join('');
}
