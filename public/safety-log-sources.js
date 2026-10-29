export function mergeSafetyLogSources(current,selected){
  const allowed={daily:['daily_report'],notice:['notice'],training:['tbm','education'],inspection:['inspection','patrol']};
  for(const [key,types] of Object.entries(allowed))if(selected[key]&&!types.includes(selected[key].type))throw Error('선택한 가상 자료를 확인해 주세요.');
  const parse=doc=>doc?JSON.parse(doc.details||'{}'):{},daily=parse(selected.daily),inspection=parse(selected.inspection);
  const fields={weather:daily.weather,todayWork:daily.todayWork,tomorrowWork:daily.tomorrowWork,notices:selected.notice?.body,training:selected.training?.body,inspection:inspection.instruction,notes:selected.inspection?.type==='patrol'?inspection.notes:undefined};
  const values={...current},copied=[];
  for(const [key,value] of Object.entries(fields))if(!String(values[key]||'').trim()&&typeof value==='string'&&value.trim()){
    if(value.length>4000)throw Error('가져올 내용이 입력 길이를 초과합니다.');
    values[key]=value;copied.push(key);
  }
  return {values,copied};
}
