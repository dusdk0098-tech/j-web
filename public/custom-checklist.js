const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error(label+'을 확인해 주세요.');return value.trim();};
export function customQuestions(value){
  if(!Array.isArray(value)||!value.length||value.length>100)throw Error('문항은 1~100개를 입력해 주세요.');
  return value.map(row=>{if(!object(row)||!['choice','text','file'].includes(row.type)||typeof row.required!=='boolean')throw Error('문항 형식과 필수 여부를 확인해 주세요.');const result={label:text(row.label,'문항',500),type:row.type,required:row.required};if(row.type==='choice'){if(!Array.isArray(row.options)||row.options.length<2||row.options.length>20)throw Error('선택지는 2~20개를 입력해 주세요.');result.options=row.options.map(v=>text(v,'선택지',100));if(new Set(result.options).size!==result.options.length)throw Error('중복 선택지를 확인해 주세요.');}return result;});
}
export function customChecklistDetails(value){
  const template=value?.template;if(!object(template)||!Number.isSafeInteger(template.id)||template.id<1||!Number.isSafeInteger(template.version)||template.version<1)throw Error('점검 양식을 다시 선택해 주세요.');
  const snapshot={id:template.id,version:template.version,title:text(template.title,'양식 제목',200),category:text(template.category,'양식 분류',200),questions:customQuestions(template.questions)};
  if(!Array.isArray(value.answers)||value.answers.length!==snapshot.questions.length)throw Error('양식의 답변 수를 확인해 주세요.');
  const answers=value.answers.map((row,index)=>{if(!object(row)||typeof row.answer!=='string'||row.answer.length>4000||typeof row.note!=='string'||row.note.length>1000)throw Error('문항 답변을 확인해 주세요.');const question=snapshot.questions[index],answer=row.answer.trim(),files=row.files??[];if(!Array.isArray(files)||files.length>20||files.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(files).size!==files.length)throw Error('문항 첨부를 확인해 주세요.');if(question.type==='choice'&&answer&&!question.options.includes(answer)||question.type==='file'&&answer||question.type!=='file'&&files.length)throw Error('문항에 맞는 답변을 입력해 주세요.');return {answer,note:row.note.trim(),files};});
  return {kind:'custom',template:snapshot,answers};
}
export function requireCustomChecklist(details,files){
  const value=customChecklistDetails(details),ids=new Set(files.map(file=>file.id));value.template.questions.forEach((question,index)=>{const answer=value.answers[index];if(answer.files.some(id=>!ids.has(id)))throw Error('문항에 연결된 첨부파일을 다시 확인해 주세요.');if(question.required&&(question.type==='file'?!answer.files.length:!answer.answer))throw Error('필수 문항을 모두 작성하고 파일을 연결해 주세요.');});return value;
}
export function customChecklistMarkup(details,esc,files=[]){
  const value=customChecklistDetails(details);return `<section><h3>${esc(value.template.title)}</h3><p>사용자 정의 양식 · ${esc(value.template.category)} · 버전 ${value.template.version}</p><ol>${value.template.questions.map((question,index)=>{const answer=value.answers[index];return `<li><strong>${esc(question.label)}</strong>${question.required?' (필수)':''}<p class="detail-body">${question.type==='file'?(answer.files.length?answer.files.map(id=>esc(files.find(file=>file.id===id)?.name||'연결된 첨부파일')).join(', '):'파일 미연결'):esc(answer.answer||'미입력')}</p>${answer.note?`<p>비고: ${esc(answer.note)}</p>`:''}</li>`;}).join('')}</ol></section>`;
}
