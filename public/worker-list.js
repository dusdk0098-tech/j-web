const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;};

export function summarizeWorkerCounts(records,asOf){
  if(!Array.isArray(records)||!validDate(asOf))throw Error('출입자 집계 날짜를 확인해 주세요.');
  const ages=[{label:'20세 미만',count:0},{label:'20대',count:0},{label:'30대',count:0},{label:'40대',count:0},{label:'50대',count:0},{label:'60세 이상',count:0},{label:'미기록·확인 불가',count:0}],categories=new Map();
  for(const record of records){const category=record.category||'미기록';categories.set(category,(categories.get(category)||0)+1);const birth=record.birthDate;let group=6;if(validDate(birth)&&birth<=asOf){const age=Number(asOf.slice(0,4))-Number(birth.slice(0,4))-(asOf.slice(5)<birth.slice(5)?1:0);group=age<20?0:age<30?1:age<40?2:age<50?3:age<60?4:5;}ages[group].count++;}
  return {asOf,total:records.length,categories:[...categories].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([label,count])=>({label,count})),ages};
}

export function paginateWorkers(rows,page){if(!Array.isArray(rows))throw Error('출입자 목록을 확인해 주세요.');const pages=Math.max(1,Math.ceil(rows.length/25)),current=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pages-1);return {rows:rows.slice(current*25,(current+1)*25),page:current,pages};}

export function workerSummaryMarkup(summary){return `<section class="worker-summary"><h3>검색 결과 요약</h3><p>가상 출입자 ${esc(summary.total)}명 · 기준일 ${esc(summary.asOf)}</p><p>구분: ${summary.categories.map(item=>`${esc(item.label)} ${esc(item.count)}명`).join(' · ')||'없음'}</p><p>가상 연령: ${summary.ages.map(item=>`${esc(item.label)} ${esc(item.count)}명`).join(' · ')}</p><p>연령은 기준일의 월일을 생일과 비교한 시험 값입니다. 생년월일이 없거나 미래이면 확인 불가로 표시합니다.</p></section>`;}
