import { educationKinds } from './education-kinds.js';

export const trainingFields={
  tbm:{weather:'날씨',instructor:'교육 실시자',work:'작업 내용',hazards:'위험요인 및 대책'},
  education:{otherTitle:'기타 교육명',audience:'출력용 교육대상',timeFrom:'교육 시작',timeTo:'교육 종료',instructor:'교육 강사',educationPlace:'교육 장소',educationMethod:'교육 방법',textbook:'사용교재'}
};

export function trainingDetailMarkup(doc,esc){
  const details=JSON.parse(doc.details||'{}');
  return (doc.type==='education'&&details.kind?`<p><strong>교육 종류</strong> ${esc(educationKinds[details.kind]||details.kind)}</p>`:'')+Object.entries(trainingFields[doc.type]||{}).filter(([key])=>details[key]).map(([key,label])=>`<p><strong>${esc(label)}</strong> ${esc(details[key])}</p>`).join('');
}
