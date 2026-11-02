export function planDetailMarkup(details,esc,fields){
  if(!details||typeof details!=='object'||Array.isArray(details))details={};
  const scalar=value=>typeof value==='string'||typeof value==='number'?String(value):'';
  const rows=Object.entries(fields).map(([key,label])=>[label,scalar(details[key])]).filter(([,value])=>value!=='');
  const kinds=Array.isArray(details.workKinds)?details.workKinds.filter(value=>typeof value==='string').join(', '):'';
  if(kinds)rows.push(['작업구분',kinds]);
  if(scalar(details.timeFrom)||scalar(details.timeTo))rows.push(['작업시간',`${scalar(details.timeFrom)||'미입력'} ~ ${scalar(details.timeTo)||'미입력'}`]);
  return rows.map(([label,value])=>`<p class="detail-body"><strong>${esc(label)}</strong> ${esc(value)}</p>`).join('')||'<p>저장된 기본정보가 없습니다.</p>';
}
