const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function attendanceEditDeadline(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1000)throw Error('조회할 월을 확인해 주세요.');
  const [year,number]=month.split('-').map(Number),nextYear=number===12?year+1:year,nextMonth=number===12?1:number+1;return nextYear>9999?null:`${nextYear}-${String(nextMonth).padStart(2,'0')}-05`;
}

export function attendanceMatrix(workers,dates,field){
  if(!['company','occupation'].includes(field))throw Error('출역 집계 기준을 확인해 주세요.');
  const index=new Map(dates.map((date,i)=>[date,i])),groups=new Map();
  for(const worker of workers)for(const record of worker.units){const day=index.get(record.date);if(day===undefined)continue;const label=record[field]||'기록 없음';if(!groups.has(label))groups.set(label,{label,days:dates.map(()=>0),total:0});const row=groups.get(label);row.days[day]++;row.total++;}
  return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,'ko'));
}

export function attendanceMatrixMarkup(workers,dates){
  return [['occupation','직종'],['company','소속']].map(([field,title])=>{const rows=attendanceMatrix(workers,dates,field);return `<section class="panel"><h2>월별 ${title} 출역</h2><p>출역일에 저장된 ${title}별 시험 인원입니다. 합계는 일자별 인원을 더한 인일이며 실제 출입을 증명하지 않습니다.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>${title}</th>${dates.map(date=>`<th>${Number(date.slice(-2))}일</th>`).join('')}<th>합계 (인일)</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${esc(row.label)}</th>${row.days.map(count=>`<td>${count||'-'}</td>`).join('')}<td>${row.total}</td></tr>`).join('')}</tbody></table></div>`:'<p>해당 월의 시험 출역 기록이 없습니다.</p>'}</section>`;}).join('');
}
