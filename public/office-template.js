export const leaveExamples={leave:'휴가',morning:'오전 반차',afternoon:'오후 반차',early:'조퇴',reserve:'예비군',civil:'민방위'};

export function officeSuggestionCurrent(expected,current){
  return !!expected&&!!current&&current.connected&&current.open&&current.enabled&&expected.epoch===current.epoch&&expected.siteId===current.siteId&&expected.kind===current.kind&&expected.otherKind===current.otherKind&&expected.manual===current.manual&&Array.isArray(expected.values)&&Array.isArray(current.values)&&expected.values.length===current.values.length&&expected.values.every((value,index)=>value===current.values[index]);
}

export function officeValuesForScope(values,lastAutomatic,lastScope,nextScope){
  const same=Array.isArray(lastAutomatic)&&values.length===lastAutomatic.length&&values.every((value,index)=>value===lastAutomatic[index]);return lastScope&&lastScope!==nextScope&&same?values.map(()=>''):[...values];
}

export function officeSourceContent(source,siteId){
  if(!source||source.type!=='office'||source.site_id!==Number(siteId)||!Number.isSafeInteger(source.id)||typeof source.title!=='string'||typeof source.body!=='string')throw Error('같은 현장의 업무 문서를 확인해 주세요.');
  let details;try{details=JSON.parse(source.details);}catch{throw Error('업무 문서 내용을 확인해 주세요.');}
  if(!details||typeof details!=='object'||Array.isArray(details)||(details.bodyRich!=null&&!Array.isArray(details.bodyRich)))throw Error('업무 문서 내용을 확인해 주세요.');
  return {title:source.title,body:source.body,rich:details.bodyRich??null};
}

export function officeSourceCurrent(expected,current){
  return !!expected&&!!current&&current.connected&&current.open&&expected.siteId===current.siteId&&expected.selected===current.selected&&expected.signatureRevision===current.signatureRevision&&JSON.stringify(expected.draft)===JSON.stringify(current.draft);
}

export function officeDraftSignature(){
  let snapshot=null;
  return {mark(value){snapshot=JSON.stringify(value);},matches(value){return snapshot!==null&&snapshot===JSON.stringify(value);},clear(){snapshot=null;}};
}

export function officeTemplate(kind,example,title,body){
  if(typeof title!=='string'||typeof body!=='string')throw Error('문서 입력을 확인해 주세요.');
  if(body.trim())throw Error('내용이 이미 입력되어 있습니다. 예시를 적용하려면 내용을 비워 주세요.');
  if(kind==='품의서')return {title:title.trim()?title:'가상 품의',body:'안건: \n필요한 이유: \n진행 내용: '};
  const label=Object.hasOwn(leaveExamples,example)&&leaveExamples[example];
  if(kind!=='휴가신청서'||!label)throw Error('문서 구분과 예시를 선택해 주세요.');
  const rows=[['구분',label],['기간',''],['사유','']],rich=[{type:'table',children:[{type:'tbody',children:rows.map(row=>({type:'tr',children:row.map((value,index)=>({type:index?'td':'th',children:value?[{type:'text',value}]:[]}))}))}]}];
  return {title:title.trim()?title:'가상 휴가 신청',body:`구분: ${label}\n기간: \n사유: `,rich};
}
