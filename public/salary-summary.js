export function salarySummary(records){
  if(!records.length)return {total:null,reason:'출역 기록 없음'};
  const groups=new Map();
  for(const row of records){
    if(!row.category)return {total:null,reason:'근로 구분 미기록'};
    const group=row.category==='직영'?'직영':'그 외',kind=row.salary_kind||'daily',amount=row.salary_kind?row.salary_amount:row.daily_rate;
    if(amount===null||amount===undefined||kind==='daily'&&(row.units_hundredths===null||row.units_hundredths===undefined))return {total:null,reason:'급여 또는 공수 미기록'};
    if(!groups.has(group))groups.set(group,{kind:null,amount:null,total:0});
    const entry=groups.get(group),calculated=kind==='daily'?Math.floor((amount*row.units_hundredths+50)/100):amount;
    entry.total+=calculated;
    if(amount>0){
      if(kind==='other')return {total:null,reason:'기타 급여 포함'};
      if(entry.kind&&entry.kind!==kind)return {total:null,reason:'급여 종류 혼합'};
      if((kind==='monthly'||kind==='yearly')&&entry.amount!==null&&entry.amount!==amount)return {total:null,reason:'월급 또는 연봉 금액 불일치'};
      entry.kind=kind;entry.amount=amount;
      if(kind==='monthly'||kind==='yearly')entry.total=calculated;
    }
  }
  return {total:[...groups.values()].reduce((sum,item)=>sum+item.total,0),reason:null};
}
