export function belongsToInstructionCompany(worker,company,companies){
  if(!worker||!company)return false;
  if(worker.company_id!=null)return worker.company_id===company.id;
  return worker.company===company.name&&companies.filter(item=>item.name===company.name).length===1;
}

export function instructionRecipientAudit(documents,workers,companies){
  const people=new Map(workers.map(worker=>[worker.id,worker])),registered=new Map(companies.map(company=>[company.id,company]));
  return documents.flatMap(document=>{
    let details;try{details=JSON.parse(document.details||'{}');}catch{details=null;}
    if(!details||typeof details!=='object'||Array.isArray(details))return [{id:document.id,title:document.title,date:document.date,status:document.status,reason:'기록 형식 확인 필요'}];
    if(details.recipientId==null||details.recipientId===0)return [];
    if(!Number.isSafeInteger(details.recipientId)||details.recipientId<1)return [{id:document.id,title:document.title,date:document.date,status:document.status,recipient:details.recipient||'',company:details.companyName||'',reason:'수신자 번호 확인 필요'}];
    const worker=people.get(details.recipientId),company=registered.get(details.companyId);
    const reason=!worker?'현재 담당자 정보 없음':!company?'현재 등록 업체 정보 없음':worker.company_id==null?'담당자의 등록 업체 미연결':worker.company_id!==company.id?'담당자의 현재 업체가 다름':'';
    return reason?[{id:document.id,title:document.title,date:document.date,status:document.status,recipient:details.recipient||'',company:details.companyName||'',reason}]:[];
  });
}
