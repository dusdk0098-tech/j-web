export function selectTbmSources(items,type,siteId,date,excludeId){
  if(!['tbm','risk','notice'].includes(type))throw Error('자료 종류를 확인해 주세요.');
  return items.filter(item=>item.type===type&&item.site_id===siteId&&item.date<=date&&item.id!==excludeId).slice(0,20);
}

export function mergeTbmSource(current,source){
  let fields;
  if(source.type==='notice')fields={body:source.body||''};
  else if(source.type==='tbm')fields={...JSON.parse(source.details||'{}'),body:source.body||''};
  else if(source.type==='risk'){
    const details=JSON.parse(source.details||'{}'),items=Array.isArray(details.items)?details.items:[details];
    fields={hazards:items.map(item=>[['작업',item.task],['위험요인',item.hazard],['기존 조치',item.existingMeasures],['추가 조치',item.additionalMeasures]].filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`).join('\n')).filter(Boolean).join('\n\n')};
  }else throw Error('자료 종류를 확인해 주세요.');
  const next={...current},copied=[];
  for(const key of ['weather','instructor','work','hazards','body']){
    const value=fields[key];
    if(!String(next[key]||'').trim()&&typeof value==='string'&&value.trim()){
      if(value.length>(key==='body'?20000:4000))throw Error('가져올 내용이 입력 길이를 초과합니다.');
      next[key]=value;copied.push(key);
    }
  }
  return {values:next,copied};
}
