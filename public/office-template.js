export const leaveExamples={leave:'휴가',morning:'오전 반차',afternoon:'오후 반차',early:'조퇴',reserve:'예비군',civil:'민방위'};

export function officeTemplate(kind,example,title,body){
  if(typeof title!=='string'||typeof body!=='string')throw Error('문서 입력을 확인해 주세요.');
  if(body.trim())throw Error('내용이 이미 입력되어 있습니다. 예시를 적용하려면 내용을 비워 주세요.');
  if(kind==='품의서')return {title:title.trim()?title:'가상 품의',body:'안건: \n필요한 이유: \n진행 내용: '};
  const label=Object.hasOwn(leaveExamples,example)&&leaveExamples[example];
  if(kind!=='휴가신청서'||!label)throw Error('문서 구분과 예시를 선택해 주세요.');
  const rows=[['구분',label],['기간',''],['사유','']],rich=[{type:'table',children:[{type:'tbody',children:rows.map(row=>({type:'tr',children:row.map((value,index)=>({type:index?'td':'th',children:value?[{type:'text',value}]:[]}))}))}]}];
  return {title:title.trim()?title:'가상 휴가 신청',body:`구분: ${label}\n기간: \n사유: `,rich};
}
