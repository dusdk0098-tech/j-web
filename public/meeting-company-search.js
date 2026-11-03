export function meetingHasCompany(document,query){
  const needle=query.trim().toLocaleLowerCase();if(!needle)return true;
  const details=JSON.parse(document.details||'{}')||{};
  return ['workerSnapshot','managerSnapshot'].some(key=>Array.isArray(details[key])&&details[key].some(person=>typeof person?.company==='string'&&person.company.toLocaleLowerCase().includes(needle)));
}
