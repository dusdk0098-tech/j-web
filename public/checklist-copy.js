export const checklistCategories=Object.freeze({daily:'일일 점검',weather:'기상별 점검',general:'일반 점검',semiannual:'반기점검'});
const checklistKindCategories=Object.freeze({morning:'daily',afternoon:'daily',evening:'daily',rain:'weather',wind:'weather',thaw:'weather',heat:'weather',cold:'weather',wet_season:'weather',heavy_rain:'weather',electrical:'general',fire:'general',formwork:'general',falling:'general',confined:'general',excavation:'general',semiannual:'semiannual'});
export function checklistCategoryForKind(kind){return typeof kind==='string'&&Object.hasOwn(checklistKindCategories,kind)?checklistKindCategories[kind]:'';}

export function checklistSources(rows,siteId,kind,date,excludeId){
  if(!Array.isArray(rows))throw Error('이전 점검 목록을 확인해 주세요.');
  return rows.filter(row=>row.site_id===siteId&&row.type==='checklist'&&row.id!==excludeId&&row.date<=date).flatMap(row=>{
    try{const details=JSON.parse(row.details);return details.kind===kind&&Array.isArray(details.answers)?[{id:row.id,date:row.date,title:row.title,answers:details.answers,photoNote:details.photoNote||''}]:[];}catch{return [];}
  });
}
export function mergeChecklistAnswers(current,source){
  if(!Array.isArray(current)||!Array.isArray(source)||current.length!==source.length)throw Error('이전 점검의 항목이 현재 종류와 다릅니다.');
  return current.map((item,index)=>{
    const previous=source[index];if(!previous||typeof previous.answer!=='string'||typeof previous.note!=='string')throw Error('이전 점검의 항목을 확인해 주세요.');
    return {answer:item.answer!==null&&!item.answer.trim()?previous.answer:item.answer,note:!item.note.trim()?previous.note:item.note};
  });
}
