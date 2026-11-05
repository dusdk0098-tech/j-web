export const riskReviewRoles=[['supervisor','관리감독자'],['safety','안전관리자'],['health','보건관리자'],['manager','현장소장'],['chief','대표자']];

export function riskReviewInputs(details,esc){
  const roles=details.riskReviewRoles||{};
  return `<fieldset><legend>평가 담당자 시험 기록</legend><p>직접 입력한 이름과 날짜이며 계정 확인이나 실제 검토·결재를 뜻하지 않습니다.</p>${riskReviewRoles.map(([key,label])=>`<fieldset><legend>${esc(label)}</legend><label>이름<input name="riskRole_${key}_name" maxlength="200" value="${esc(roles[key]?.name||'')}"></label><label>기록일<input type="date" name="riskRole_${key}_date" value="${esc(roles[key]?.date||'')}"></label></fieldset>`).join('')}</fieldset>`;
}
export function readRiskReviewRoles(get){return Object.fromEntries(riskReviewRoles.map(([key])=>[key,{name:get(`riskRole_${key}_name`)||'',date:get(`riskRole_${key}_date`)||''}]));}
export function riskReviewSummary(details,esc){
  const roles=details?.riskReviewRoles;if(!roles||typeof roles!=='object')return '';
  return `<section><h3>평가 담당자 시험 기록</h3><p>직접 입력한 기록이며 계정 확인이나 실제 검토·결재를 뜻하지 않습니다.</p>${riskReviewRoles.map(([key,label])=>`<p>${esc(label)}: ${esc(roles[key]?.name||'미기록')} · ${esc(roles[key]?.date||'미기록')}</p>`).join('')}</section>`;
}
