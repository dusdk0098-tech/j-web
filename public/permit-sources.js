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
