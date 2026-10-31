const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;};

export function summarizeWorkerCounts(records,asOf){
  if(!Array.isArray(records)||!validDate(asOf))throw Error('출입자 집계 날짜를 확인해 주세요.');
  const ages=[{label:'20세 미만',count:0},{label:'20대',count:0},{label:'30대',count:0},{label:'40대',count:0},{label:'50대',count:0},{label:'60세 이상',count:0},{label:'미기록·확인 불가',count:0}],categories=new Map(),ageDecades=['10세 미만',...Array.from({length:9},(_,i)=>`${(i+1)*10}대`),'100세 이상','미기록·확인 불가'].map(label=>({label,count:0}));
  for(const record of records){const category=record.category||'미기록';categories.set(category,(categories.get(category)||0)+1);const birth=record.birthDate;let group=6,decade=11;if(validDate(birth)&&birth<=asOf){const age=Number(asOf.slice(0,4))-Number(birth.slice(0,4))-(asOf.slice(5)<birth.slice(5)?1:0);group=age<20?0:age<30?1:age<40?2:age<50?3:age<60?4:5;decade=Math.min(Math.floor(age/10),10);}ages[group].count++;ageDecades[decade].count++;}
  return {asOf,total:records.length,categories:[...categories].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([label,count])=>({label,count})),ages,ageDecades};
}

export function paginateWorkers(rows,page){if(!Array.isArray(rows))throw Error('출입자 목록을 확인해 주세요.');const pages=Math.max(1,Math.ceil(rows.length/20)),current=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pages-1);return {rows:rows.slice(current*20,(current+1)*20),page:current,pages};}

export function workerSummaryMarkup(summary){
  const colors=['#4167c9','#f08b37','#37a38b','#9b65ba','#d8596c','#a27b45','#4f8db8','#8ca64c','#cf77a0','#8274cf','#6e879c','#7a7a7a'],items=summary.ageDecades||summary.ages;
  if(!Number.isSafeInteger(summary.total)||summary.total<0||!Array.isArray(items)||items.some(item=>!Number.isSafeInteger(item.count)||item.count<0)||items.reduce((n,item)=>n+item.count,0)!==summary.total)throw Error('연령 집계를 다시 확인해 주세요.');
  const groups=items.map((item,i)=>({...item,color:colors[i%colors.length]})).filter(item=>item.count>0);let offset=0;
  const arcs=groups.map(item=>{const share=item.count*100/summary.total,start=offset;offset+=share;return `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${item.color}" stroke-width="5" stroke-dasharray="${share.toFixed(4)} ${(100-share).toFixed(4)}" stroke-dashoffset="${(-start).toFixed(4)}"></circle>`;}).join('');
  const chart=groups.length?`<div class="worker-age-visual"><svg viewBox="0 0 42 42" width="120" height="120" aria-hidden="true"><g transform="rotate(-90 21 21)"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="#e5ebf4" stroke-width="5"></circle>${arcs}</g></svg><ul>${groups.map(item=>`<li><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="${item.color}"></rect></svg> ${esc(item.label)} ${esc(item.count)}명 (${Math.round(item.count*100/summary.total)}%)</li>`).join('')}</ul></div>`:'<p>가상 연령: 없음</p>';
  return `<section class="worker-summary"><h3>검색 결과 요약</h3><p>가상 출입자 ${esc(summary.total)}명 · 기준일 ${esc(summary.asOf)}</p><p>구분: ${summary.categories.map(item=>`${esc(item.label)} ${esc(item.count)}명`).join(' · ')||'없음'}</p><h4>가상 연령</h4>${chart}<p>비율은 검색된 전체 인원을 기준으로 반올림하며 생년월일 미기록도 포함합니다. 연령은 기준일의 월일을 생일과 비교한 시험 값입니다.</p></section>`;
}
