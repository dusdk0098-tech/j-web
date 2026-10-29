export function trainingGroups(workers,kind){
  const key={occupation:'attendance_occupation',company:'attendance_company'}[kind];
  if(!key)throw Error('선택 기준을 확인해 주세요.');
  const groups=new Map();
  for(const worker of workers){
    if(!worker.present)continue;
    const label=worker[key]||null;
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(worker.id);
  }
  return [...groups].map(([label,ids])=>({label,ids})).sort((a,b)=>(a.label||'').localeCompare(b.label||'','ko'));
}

export function trainingRoster(targets){
  return targets.workers.filter(worker=>!targets.configured||worker.selected).map(worker=>({
    id:worker.id,name:worker.name,
    company:worker.present?worker.attendance_company:worker.company,
    occupation:worker.present?worker.attendance_occupation:null,
    confirmed:!!worker.daily_confirmed,hasSignature:!!worker.daily_has_signature
  }));
}

export function filterEducationReport(rows,categories){
  const selected=new Set(categories);
  return rows.filter(row=>selected.has(row.category));
}
