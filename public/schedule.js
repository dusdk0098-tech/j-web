export const scheduleTypes=['당직','외근','업무','교육','행사','공정','회의','휴가','반차(오전)','반차(오후)','조퇴','예비군','민방위','기타'];
export const personalScheduleTypes=['당직','외근','업무','교육','휴가','반차(오전)','반차(오후)','조퇴','예비군','민방위'];

export function scheduleTargetRequired(kind,row=null){
  return personalScheduleTypes.includes(kind)&&!(row&&personalScheduleTypes.includes(row.kind)&&!row.target_id);
}

export function validScheduleTime(value){
  return typeof value==='string'&&(value===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(value)||value==='24:00');
}

export function scheduleTimeOptions(current=''){
  if(!validScheduleTime(current))throw new Error('일정 시간을 확인해 주세요.');
  const values=Array.from({length:145},(_,i)=>`${String(Math.floor(i/6)).padStart(2,'0')}:${String(i%6*10).padStart(2,'0')}`);
  if(current&&!values.includes(current))values.push(current);
  return ['',...values.sort()];
}

export function scheduleMonthDays(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1000)throw new Error('조회할 월을 확인해 주세요.');
  const year=Number(month.slice(0,4)),number=Number(month.slice(5,7)),firstWeekday=new Date(Date.UTC(year,number-1,1)).getUTCDay(),count=new Date(Date.UTC(year,number,0)).getUTCDate();
  return {firstWeekday,days:Array.from({length:count},(_,index)=>`${month}-${String(index+1).padStart(2,'0')}`)};
}
