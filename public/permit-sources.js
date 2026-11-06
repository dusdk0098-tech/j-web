export function permitSources(rows,siteId,date,excludeId){
  if(!Array.isArray(rows))throw Error('이전 허가서 목록을 확인해 주세요.');
  return rows.filter(row=>row.site_id===siteId&&row.type==='permit'&&row.status==='approved'&&row.id!==excludeId&&row.date<=date).flatMap(row=>{
    try{const details=JSON.parse(row.details),items=details.safetyMeasures;if(!Array.isArray(items)||!items.length||items.length>100||items.some(item=>!item||['accidentType','hazard','measure'].some(key=>typeof item[key]!=='string'||item[key].length>2000)||!['accidentType','hazard','measure'].some(key=>item[key].trim())))return [];return [{id:row.id,date:row.date,title:row.title,items:items.map(({accidentType,hazard,measure})=>({accidentType,hazard,measure}))}];}catch{return [];}
  });
}
export function permitSourceItems(source,currentCount){
  if(!source||!Array.isArray(source.items)||!Number.isSafeInteger(currentCount)||currentCount<0||currentCount+source.items.length>100)throw Error('안전대책은 최대 100개까지 추가할 수 있습니다.');
  return source.items.map(item=>({...item}));
}

export function mountWorkerPermitSources({host,form,siteId,documentId,request,active,count,add}){
  host.innerHTML='<fieldset><legend>이전 허가서 안전대책</legend><p>같은 현장에서 직접 작성한 승인 허가서의 안전대책만 가져옵니다.</p><button type="button" data-load>이전 허가서 조회</button><p data-status role="status"></p><div data-results></div></fieldset>';
  const button=host.querySelector('[data-load]'),status=host.querySelector('[data-status]'),results=host.querySelector('[data-results]'),date=form.elements.date;let generation=0;
  const clear=()=>{generation++;results.replaceChildren();status.textContent='작성일이 변경되었습니다. 다시 조회해 주세요.';};
  date.addEventListener('change',clear);date.addEventListener('input',clear);
  button.onclick=async()=>{
    if(!active()||button.disabled)return;const day=date.value,id=++generation,current=()=>active()&&host.isConnected&&generation===id&&date.value===day;
    results.replaceChildren();if(!day){status.textContent='작성일을 먼저 입력해 주세요.';return;}button.disabled=true;status.textContent='불러오는 중입니다.';
    try{
      const rows=await request('/api/worker/documents',{},'json',current);if(!current())return;
      const sources=permitSources(rows,siteId,day,documentId);status.textContent=sources.length?'':'조건에 맞는 본인 작성 허가서가 없습니다.';
      for(const source of sources){const row=document.createElement('p'),copy=document.createElement('button');row.append(document.createTextNode(`${source.date} · ${source.title} `));copy.type='button';copy.textContent='안전대책 추가';copy.onclick=async()=>{
        if(copy.disabled||!current())return;copy.disabled=true;try{
          const latest=await request('/api/worker/documents',{},'json',current);if(!current())return;
          const fresh=permitSources(latest,siteId,day,documentId).find(item=>item.id===source.id);
          if(!fresh||JSON.stringify(fresh)!==JSON.stringify(source))throw Error('이전 허가서가 변경되었습니다. 다시 조회해 주세요.');
          permitSourceItems(fresh,count()).forEach(add);status.textContent='안전대책을 추가했습니다. 내용을 확인한 뒤 저장해 주세요.';
        }catch(error){if(current())status.textContent=error.message;}finally{copy.disabled=false;}
      };row.append(copy);results.append(row);}
    }catch(error){if(current())status.textContent=error.message;}finally{button.disabled=false;}
  };
}

export function permitCheckSources(rows,siteId,date,excludeId,kinds){
  if(!Array.isArray(rows)||!Array.isArray(kinds))throw Error('이전 허가서 목록을 확인해 주세요.');
  return rows.filter(row=>row.site_id===siteId&&row.type==='permit'&&row.status==='approved'&&row.id!==excludeId&&row.date<=date).filter(row=>{try{const previous=JSON.parse(row.details).kinds;return Array.isArray(previous)&&previous.some(kind=>kinds.includes(kind));}catch{return false;}}).map(row=>({id:row.id,date:row.date,title:row.title}));
}

export function permitCheckSourceNames(checks,date,currentCount){
  if(!Array.isArray(checks)||!Number.isSafeInteger(currentCount)||currentCount<0)throw Error('이전 점검을 확인해 주세요.');
  const check=checks.filter(item=>item&&typeof item.date==='string'&&item.date<=date&&Array.isArray(item.items)&&item.items.length).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
  if(!check)throw Error('선택한 허가서에 해당 날짜 이전 점검이 없습니다.');
  if(check.items.length+currentCount>20)throw Error('점검 항목은 최대 20개까지 추가할 수 있습니다.');
  return check.items.map(item=>{if(typeof item?.name!=='string'||!item.name.trim()||item.name.length>500)throw Error('이전 점검 항목을 확인해 주세요.');return {name:item.name};});
}
