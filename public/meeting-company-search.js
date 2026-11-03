export function meetingHasCompany(document,query,companyId=''){
  const needle=query.trim().toLocaleLowerCase();if(!needle&&!companyId)return true;
  const details=JSON.parse(document.details||'{}')||{};
  return ['workerSnapshot','managerSnapshot'].some(key=>Array.isArray(details[key])&&details[key].some(person=>(!companyId||String(person?.companyId)===String(companyId))&&(!needle||typeof person?.company==='string'&&person.company.toLocaleLowerCase().includes(needle))));
}
