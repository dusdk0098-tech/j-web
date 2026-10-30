export function quantityTenths(value){
  if(typeof value!=='string'||!/^\d{1,8}(?:\.\d)?$/.test(value))return null;
  const [whole,decimal='0']=value.split('.');return Number(whole)*10+Number(decimal);
}
export function dailyQuantities(rows){
  const entries=rows.map(row=>{const previous=quantityTenths(row.previous),day=quantityTenths(row.day);return previous===null||day===null?null:{previous,day,total:previous+day};});
  const totals=entries.length&&entries.every(Boolean)?entries.reduce((sum,row)=>({previous:sum.previous+row.previous,day:sum.day+row.day,total:sum.total+row.total}),{previous:0,day:0,total:0}):null;
  return {entries,totals};
}
export function displayTenths(value){return Number.isInteger(value)?String(value/10):'미입력';}
