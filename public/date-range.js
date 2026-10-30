export function dateRangePreset(date,preset){
  const day=new Date(`${date}T00:00:00Z`);
  if(preset==='yesterday')day.setUTCDate(day.getUTCDate()-1);
  if(preset==='month')return {from:`${date.slice(0,7)}-01`,to:new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0)).toISOString().slice(0,10)};
  const value=day.toISOString().slice(0,10);return {from:value,to:value};
}
