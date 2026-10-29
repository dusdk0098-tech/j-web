export function riskScaleOptions(scale, field) {
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

export function copyRiskItem(item){
  return {...item,supervisorOpinion:'',safetyOpinion:'',healthOpinion:'',managerOpinion:''};
}

export function groupRiskItems(items){
  const groups=new Map();
  for(const item of items){const process=item.processName||'',contractor=item.contractor||'',key=JSON.stringify([process,contractor]);if(!groups.has(key))groups.set(key,{process,contractor,items:[]});groups.get(key).items.push(item);}
  return [...groups.values()];
}
