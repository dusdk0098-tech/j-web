export function attendanceMealChange(current,selected){
  if(selected==='')return current?{action:'delete',id:current.id}:null;
  if(!/^\d+$/.test(selected)||Number(selected)<1)throw new Error('식당을 확인해 주세요.');
  const restaurantId=Number(selected);
  return current?.restaurant_id===restaurantId?null:{action:'save',restaurantId};
}

export function monthlyDirectMealSummary(worker,checks){
  const categories=new Map(worker.units.map(row=>[row.date,row.category])),direct=checks.filter(row=>categories.get(row.date)==='직영'),unknown=checks.filter(row=>categories.has(row.date)&&!categories.get(row.date));
  const missingTax=direct.filter(row=>row.tax_snapshot===null||row.tax_snapshot===undefined).length;
  return {meals:direct.filter(row=>row.kind!=='snack').length,snacks:direct.filter(row=>row.kind==='snack').length,base:direct.reduce((sum,row)=>sum+row.price,0),total:missingTax?null:direct.reduce((sum,row)=>sum+row.price+row.tax_snapshot,0),missingTax,unknown:unknown.length};
}
