export function dateRangePreset(date,preset){
  const day=new Date(`${date}T00:00:00Z`);
  if(preset==='yesterday')day.setUTCDate(day.getUTCDate()-1);
  if(preset==='month')return {from:`${date.slice(0,7)}-01`,to:new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0)).toISOString().slice(0,10)};
  const value=day.toISOString().slice(0,10);return {from:value,to:value};
}

export function mountStatisticsDates(month,day,search,state,render,flash,showError){
  const days=value=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return 0;const [year,number]=value.split('-').map(Number);return [31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][number-1];};
  search.onclick=()=>{const count=days(month.value);if(!count){flash('조회할 월을 확인해 주세요.',true);return;}if(day.value&&(!/^\d{2}$/.test(day.value)||Number(day.value)<1||Number(day.value)>count)){flash('조회할 일을 확인해 주세요.',true);return;}state.statisticsMonth=month.value;state.statisticsDay=day.value;render().catch(showError);};
  month.onchange=()=>{const selected=day.value,count=days(month.value);day.innerHTML='<option value="">월 전체</option>'+Array.from({length:count},(_,i)=>{const value=String(i+1).padStart(2,'0');return `<option value="${value}">${value}일</option>`;}).join('');day.value=Number(selected)<=count?selected:'';search.onclick();};
  day.onchange=search.onclick;
}
