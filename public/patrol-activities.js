export function patrolActivityRow(row,esc){
  return `<fieldset data-patrol-activity><legend>점검 활동</legend>${[['inspector','점검자','text',200],['timeFrom','시작 시간','time',0],['timeTo','종료 시간','time',0],['content','점검 내용','text',2000],['action','조치 내용','text',2000]].map(([key,label,type,max])=>`<label>${label}<input data-patrol-activity-field="${key}" type="${type}" value="${esc(row[key]||'')}" ${max?`maxlength="${max}"`:''} ${['inspector','timeFrom','timeTo'].includes(key)?'required':''}></label>`).join('')}<button type="button" data-patrol-activity-remove>활동 삭제</button></fieldset>`;
}
export function readPatrolActivities(root){return [...root.querySelectorAll('[data-patrol-activity]')].map(row=>Object.fromEntries(['inspector','timeFrom','timeTo','content','action'].map(key=>[key,row.querySelector(`[data-patrol-activity-field="${key}"]`).value])));}
export function patrolActivitiesSummary(rows,esc){
  if(!Array.isArray(rows)||!rows.length)return '<p>점검 활동 없음</p>';
  return `<h3>점검 활동</h3>${rows.map(row=>`<p>${esc(row.inspector)} · ${esc(row.timeFrom)} ~ ${esc(row.timeTo)} · 점검: ${esc(row.content)} · 조치: ${esc(row.action||'미입력')}</p>`).join('')}`;
}
