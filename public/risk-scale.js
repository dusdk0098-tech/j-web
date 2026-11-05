export function riskScaleOptions(scale, field) {
  field = {improvedGrade:'grade',improvedLikelihood:'likelihood',improvedSeverity:'severity'}[field] || field;
  if (field === 'grade') return scale === 'three-level' ? ['상', '중', '하'] : [];
  if (!['3x3', '5x4'].includes(scale)) return [];
  if (field === 'likelihood') return scale === '3x3' ? ['1', '2', '3'] : ['1', '2', '3', '4', '5'];
  if (field === 'severity') return scale === '3x3' ? ['1', '2', '3'] : ['1', '2', '3', '4'];
  return [];
}

export function riskScore(scale, likelihood, severity) {
  if (!riskScaleOptions(scale, 'likelihood').includes(likelihood) || !riskScaleOptions(scale, 'severity').includes(severity)) return null;
  return Number(likelihood) * Number(severity);
}

export function selectedMusculoskeletalItems(items) {
  return Array.isArray(items) ? items.filter(item => item?.selected === true) : [];
}

export function copyRiskItem(item){
  return {...item,supervisorOpinion:'',safetyOpinion:'',healthOpinion:'',managerOpinion:''};
}

export function copyMusculoskeletalItems(items,existingCount,scale){
  if(!Array.isArray(items)||!Number.isSafeInteger(existingCount)||existingCount<0||existingCount+items.length>100)throw new Error('근골격계 항목은 100개까지 입력할 수 있습니다.');
  const fields=['processName','contractor','task','hazard','existingMeasures','additionalMeasures','grade','improvedGrade','likelihood','severity'];
  return items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.selected!=='boolean'||fields.some(key=>item[key]!==undefined&&(typeof item[key]!=='string'||item[key].length>2000))||['grade','improvedGrade','likelihood','severity'].some(key=>item[key]&&!riskScaleOptions(scale,key).includes(item[key]))||item.contractorId!==undefined&&(!Number.isSafeInteger(item.contractorId)||item.contractorId<1))throw new Error('이전 근골격계 항목을 확인해 주세요.');
    const copy=Object.fromEntries(fields.filter(key=>item[key]!==undefined).map(key=>[key,item[key]]));if(item.contractorId!==undefined)copy.contractorId=item.contractorId;copy.selected=item.selected;return copy;
  });
}

export function copyRiskImprovement(items, sourceIndex, field){
  const source=items[sourceIndex];
  if(!source?.processName?.trim()||!['dueDate','completionDate','responsible'].includes(field))return items;
  return items.map(item=>item.processName.trim()===source.processName.trim()&&(source.contractorId||item.contractorId?source.contractorId===item.contractorId:item.contractor.trim()===source.contractor.trim())?{...item,[field]:source[field]}:item);
}

export function groupRiskItems(items){
  const groups=new Map();
  for(const item of items){const process=item.processName||'',contractor=item.contractor||'',contractorId=item.contractorId||0,key=JSON.stringify([process,contractorId,contractorId?'':contractor]);if(!groups.has(key))groups.set(key,{process,contractor,contractorId,items:[]});groups.get(key).items.push(item);}
  return [...groups.values()];
}

export function planProcessRiskCopy(source,currentProcesses,currentRiskCount,currentMuscleCount,companies,scale){
  if(!source||!Array.isArray(source.processes)||!Array.isArray(currentProcesses)||!Array.isArray(companies)||![currentRiskCount,currentMuscleCount].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error('이전 평가의 공정과 항목을 확인해 주세요.');
  const keys=new Set(currentProcesses.map(row=>JSON.stringify([row.name.trim(),row.contractorId]))),processes=[];
  for(const row of source.processes){if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>200||!Number.isSafeInteger(row.contractorId)||row.contractorId<0||row.contractorId&&!companies.some(company=>company.id===row.contractorId))throw Error('이전 공정의 같은 현장 협력사를 확인해 주세요.');const item={name:row.name.trim(),contractorId:row.contractorId},key=JSON.stringify([item.name,item.contractorId]);if(!keys.has(key)){keys.add(key);processes.push(item);}}
  if(currentProcesses.length+processes.length>100)throw Error('공정은 100개까지 등록할 수 있습니다.');
  const matches=row=>row&&typeof row.processName==='string'&&processes.some(process=>row.processName.trim()===process.name&&(row.contractorId||0)===process.contractorId&&(process.contractorId||row.contractor==='직영'));
  if(source.items!==undefined&&!Array.isArray(source.items)||source.musculoskeletalItems!==undefined&&!Array.isArray(source.musculoskeletalItems))throw Error('이전 평가 항목을 확인해 주세요.');
  const items=(source.items||[]).filter(matches).map(copyRiskItem),musculoskeletalItems=copyMusculoskeletalItems((source.musculoskeletalItems||[]).filter(matches),currentMuscleCount,scale);
  if(currentRiskCount+items.length>100)throw Error('위험요인은 100개까지 등록할 수 있습니다.');
  return {processes,items,musculoskeletalItems};
}
