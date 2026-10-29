export function attendanceMealChange(current,selected){
  if(selected==='')return current?{action:'delete',id:current.id}:null;
  if(!/^\d+$/.test(selected)||Number(selected)<1)throw new Error('식당을 확인해 주세요.');
  const restaurantId=Number(selected);
  return current?.restaurant_id===restaurantId?null:{action:'save',restaurantId};
}
