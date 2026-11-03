export function belongsToInstructionCompany(worker,company,companies){
  if(!worker||!company)return false;
  if(worker.company_id!=null)return worker.company_id===company.id;
  return worker.company===company.name&&companies.filter(item=>item.name===company.name).length===1;
}
