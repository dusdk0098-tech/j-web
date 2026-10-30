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

export function wageEstimateCurrent(expected,current){
  return !!expected&&!!current&&current.connected&&current.open&&expected.siteId===current.siteId&&expected.month===current.month&&expected.workerId===current.workerId&&expected.gross===current.gross&&expected.mode===current.mode;
}

export function salaryDay(day){
  if(!day)return {kind:'미출역',amount:'미출역'};
  if(day.salary_kind){const labels={monthly:'월급',yearly:'연봉',other:'기타'};return {kind:labels[day.salary_kind]||'미기록',amount:day.salary_amount??'미기록'};}
  return day.daily_rate===null||day.daily_rate===undefined?{kind:'미기록',amount:'미기록'}:{kind:'일당',amount:day.daily_rate};
}

export function groupWageRecords(records){
  const groups=new Map();
  for(const row of records){
    let group=groups.get(row.occupation);
    if(!group){group={occupation:row.occupation,rows:[],units_hundredths:null,units_missing:0,gross:0};groups.set(row.occupation,group);}
    group.rows.push(row);group.gross+=row.gross;group.units_missing+=row.units_missing;
    if(row.units_hundredths!==null)group.units_hundredths=(group.units_hundredths??0)+row.units_hundredths;
  }
  return [...groups.values()].sort((a,b)=>a.occupation.localeCompare(b.occupation,'ko'));
}
