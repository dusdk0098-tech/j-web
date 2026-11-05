export function patrolActivityRow(row,esc){
  return `<fieldset data-patrol-activity><legend>점검 활동</legend>${[['inspector','점검자','text',200],['timeFrom','시작 시간','time',0],['timeTo','종료 시간','time',0],['content','점검 내용','text',2000],['action','조치 내용','text',2000]].map(([key,label,type,max])=>`<label>${label}<input data-patrol-activity-field="${key}" type="${type}" value="${esc(row[key]||'')}" ${max?`maxlength="${max}"`:''} ${['inspector','timeFrom','timeTo'].includes(key)?'required':''}></label>`).join('')}<button type="button" data-patrol-activity-remove>활동 삭제</button></fieldset>`;
}
export function readPatrolActivities(root){return [...root.querySelectorAll('[data-patrol-activity]')].map(row=>Object.fromEntries(['inspector','timeFrom','timeTo','content','action'].map(key=>[key,row.querySelector(`[data-patrol-activity-field="${key}"]`).value])));}
export function patrolActivitiesSummary(rows,esc){
  if(!Array.isArray(rows)||!rows.length)return '<p>점검 활동 없음</p>';
  return `<h3>점검 활동</h3>${rows.map(row=>`<p>${esc(row.inspector)} · ${esc(row.timeFrom)} ~ ${esc(row.timeTo)} · 점검: ${esc(row.content)} · 조치: ${esc(row.action||'미입력')}</p>`).join('')}`;
}
export function patrolItemRow(item,esc){
  return `<div data-patrol-item data-name="${esc(item.name)}"><label>${esc(item.name)}<select aria-label="${esc(item.name)} 판정">${['O','X','해당없음'].map(v=>`<option ${v===item.result?'selected':''}>${v}</option>`).join('')}</select></label><label>점검 구분<input data-patrol-group value="${esc(item.patrolGroup||'')}" maxlength="2000"></label><label>세부 점검사항<input data-patrol-guidance value="${esc(item.patrolGuidance||'')}" maxlength="2000"></label><label>개선대책 지시 / 비고<input data-patrol-note value="${esc(item.note||'')}" maxlength="2000"></label></div>`;
}
export function readPatrolItems(root){return [...root.querySelectorAll('[data-patrol-item]')].map(row=>({name:row.dataset.name,result:row.querySelector('select').value,note:row.querySelector('[data-patrol-note]').value,patrolGroup:row.querySelector('[data-patrol-group]').value,patrolGuidance:row.querySelector('[data-patrol-guidance]').value}));}
