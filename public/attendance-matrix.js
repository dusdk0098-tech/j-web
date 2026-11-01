import { salarySummary } from './salary-summary.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function matchesAttendanceQuery(worker,query){
  const value=String(query??'').trim().toLocaleLowerCase(),digits=value.replace(/\D/g,'');if(!value)return true;
  return String(worker.name??'').toLocaleLowerCase().includes(value)||(/^[0-9()+\-\s]+$/.test(value)&&!!digits&&[worker.birth_date,worker.phone].some(field=>String(field??'').replace(/\D/g,'').includes(digits)));
}

export function matchesMonthlyAttendance(worker,filters){
  if(!matchesAttendanceQuery(worker,filters.query))return false;
  const fields=['category','occupation','company'];if(!filters.date&&!fields.some(field=>filters[field]))return true;
  return worker.units.some(record=>(!filters.date||record.date===filters.date)&&fields.every(field=>!filters[field]||(record[field]||'기록 없음')===filters[field]));
}

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

export function directAttendanceMarkup(workers){
  const rows=workers.filter(worker=>worker.units.length).map(worker=>{
    const direct=worker.units.filter(record=>record.category==='직영'),units=direct.filter(record=>record.units_hundredths!=null),pay=direct.filter(record=>record.estimated_pay!=null);
    const unitSum=units.length?(units.reduce((sum,record)=>sum+record.units_hundredths,0)/100).toFixed(2):direct.length?'미기록':'해당 없음';
    const paySum=pay.length?`${pay.reduce((sum,record)=>sum+record.estimated_pay,0)}원`:direct.length?'미기록':'해당 없음';
    const salary=salarySummary(direct),salaryText=!direct.length?'해당 없음':salary.total===null?`계산 불가: ${salary.reason}`:`${salary.total}원`;
    return `<tr><th>${esc(worker.name)}</th><td>${unitSum} (미기록 ${direct.length-units.length}일)</td><td>${paySum} (제외 ${direct.length-pay.length}일)</td><td>${esc(salaryText)}</td><td>${worker.units.filter(record=>!record.category).length}일</td></tr>`;
  });
  return `<section class="panel"><h2>월별 직영 시험 집계</h2><p>월별 전체 기록에서 출역 당시 구분이 직영인 날만 합산합니다. 일당 시험 계산액은 일당과 공수가 있는 날만 더합니다. 급여 유형 반영 시험 합계는 같은 월급·연봉을 한 번 계산하며 급여 종류 혼합과 금액 불일치 등은 계산 불가로 표시합니다. 구분 미기록은 직영 여부를 알 수 없어 별도 표시합니다. 월별 표 검색과 관계없이 전체 기록을 표시하며 실제 노무비가 아닙니다.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>이름</th><th>직영 시험 공수</th><th>직영 일당 시험 계산액</th><th>급여 유형 반영 시험 합계</th><th>구분 미기록</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`:'<p>해당 월의 시험 출역 기록이 없습니다.</p>'}</section>`;
}
