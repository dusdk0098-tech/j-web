export const educationKinds=Object.freeze({
  new:'신규채용자 안전교육',regular:'근로자 정기교육',risk:'위험성평가 전파교육',special:'특별안전보건교육',changed:'작업내용 변경 시 교육',
  supervisor_new:'관리감독자 신규 채용 시 교육',supervisor_regular:'관리감독자 정기·위험성평가 전파교육',supervisor_special:'관리감독자 특별교육',supervisor_changed:'관리감독자 작업내용 변경 시 교육',
  supervisor:'관리감독자 교육 (세부 구분 미기록)',msds:'물질안전보건교육(MSDS)',other:'기타교육'
});

export function requireEducationSubmission(details={}) {
  const missing=[...(!String(details.timeFrom??'').trim()||!String(details.timeTo??'').trim()?['교육시간']:[]),...Object.entries({educationPlace:'교육장소',educationMethod:'교육방법',instructor:'교육강사'}).filter(([key])=>!String(details[key]??'').trim()).map(([,label])=>label)];
  if(missing.length)throw Error('시험 결재 요청 전에 '+missing.join(', ')+' 항목을 입력하고 저장해 주세요.');
}

export function educationTimeField(name,label,value='',esc=String) {
  const times=Array.from({length:18*12},(_,i)=>`${String(5+Math.floor(i/12)).padStart(2,'0')}:${String(i%12*5).padStart(2,'0')}`);
  if(value&&!times.includes(value))times.unshift(value);
  return `<label>${esc(label)}<select name="${esc(name)}"><option value="">선택 안 함</option>${times.map(time=>`<option value="${esc(time)}" ${time===value?'selected':''}>${esc(time)}</option>`).join('')}</select></label>`;
}

export function educationMethodFields(details={},esc=String) {
  const choices=['강의식','시청각','토의식'],value=details.educationMethod??'강의식',selected=value.split(', ');
  for(const item of selected)if(item&&!choices.includes(item))choices.push(item);
  return `<fieldset><legend>교육 방법 (복수 선택)</legend>${choices.map(item=>`<label><input type="checkbox" data-education-method value="${esc(item)}" ${selected.includes(item)?'checked':''}> ${esc(item)}</label>`).join('')}</fieldset>`;
}

export function readEducationMethod(root) {
  return [...root.querySelectorAll('[data-education-method]:checked')].map(input=>input.value).join(', ');
}

export const educationAttachmentLabels=Object.freeze({general:'일반 첨부',education_photo:'교육 사진',education_material:'교육자료'});
