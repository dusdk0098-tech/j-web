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
    confirmed:!!worker.daily_confirmed,hasSignature:!!worker.daily_has_signature,...(worker.transferOrigin?{transferOrigin:worker.transferOrigin}:{})
  }));
}

export async function managerTrainingRoster(doc,targets,api,current){
  const people=(targets.managers||[]).filter(person=>person.selected).map(person=>({...person,signature:null}));
  if(doc.status!=='approved'||!people.length)return people;
  const query=new URLSearchParams({siteId:String(doc.site_id),from:doc.date,to:doc.date}),assignments=await api(`/api/education/manager-assignments?${query}`,{},current);if(!current())return null;
  const confirmed=new Set(assignments.filter(row=>row.document_id===doc.id&&row.confirmed_at).map(row=>row.id));
  for(let start=0;start<people.length;start+=10){
    await Promise.all(people.slice(start,start+10).filter(person=>confirmed.has(person.id)).map(async person=>{const params=new URLSearchParams({siteId:String(doc.site_id),reviewerId:String(person.id),documentId:String(doc.id)}),data=await api(`/api/education/manager-signature?${params}`,{},current);if(typeof data.signature!=='string'||data.signature.length>7*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.signature))throw Error('직원 시험 서명을 읽을 수 없습니다.');person.signature=data.signature;}));
    if(!current())return null;
  }
  return people;
}

export function filterEducationReport(rows,categories){
  const selected=new Set(categories);
  return rows.filter(row=>selected.has(row.category));
}

export function changedTrainingWorkers(targets,selected){
  const before=new Set(targets.workers.filter(worker=>!targets.configured||worker.selected).map(worker=>worker.id));
  return selected.length===before.size&&selected.every(id=>before.has(id))?undefined:selected;
}
