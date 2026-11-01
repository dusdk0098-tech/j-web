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
