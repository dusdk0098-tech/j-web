import { educationKinds } from './education-kinds.js';

export function educationReference(kind,compact=false) {
  if(!Object.hasOwn(educationKinds,kind))return '';
  const lines=[`${educationKinds[kind]} · 가상 작성 안내`,'실제 교육에 맞게 내용을 검토하고 수정하세요.','작업 중 확인할 위험요인과 예방 행동을 적으세요.','참여자가 질문한 내용과 확인 결과를 기록하세요.'];
  return lines.join(compact?' ':'\n');
}

export function mountEducationReference(root,{kind,body,active=()=>true}) {
  root.innerHTML='<fieldset><legend>가상 참고자료</legend><p>독자적으로 작성한 시험용 안내입니다. 미리보기 후 본문에 추가할 수 있으며 기존 내용은 유지됩니다.</p><button type="button" data-reference-normal>일반 보기</button> <button type="button" data-reference-compact>줄바꿈 최소화 보기</button><pre data-reference-preview aria-label="가상 참고자료 미리보기" style="white-space:pre-wrap"></pre><button type="button" data-reference-apply disabled>본문에 추가</button><p data-reference-status role="status"></p></fieldset>';
  const normal=root.querySelector('[data-reference-normal]'),compact=root.querySelector('[data-reference-compact]'),preview=root.querySelector('[data-reference-preview]'),apply=root.querySelector('[data-reference-apply]'),status=root.querySelector('[data-reference-status]');
  let snapshot=null,disposed=false;
  const available=()=>!disposed&&root.isConnected&&active()&&!body.disabled&&!body.readOnly&&Object.hasOwn(educationKinds,kind.value);
  const invalidate=()=>{snapshot=null;preview.textContent='';apply.disabled=true;normal.disabled=compact.disabled=!available();status.textContent='';};
  const show=condensed=>{
    invalidate();if(!available())return;
    snapshot={kind:kind.value,body:body.value,text:educationReference(kind.value,condensed)};
    preview.textContent=snapshot.text;apply.disabled=false;status.textContent='미리보기입니다. 본문은 아직 바뀌지 않았습니다.';
  };
  normal.onclick=()=>show(false);compact.onclick=()=>show(true);
  apply.onclick=()=>{
    if(!available()||!snapshot||snapshot.kind!==kind.value||snapshot.body!==body.value){invalidate();status.textContent='입력 상태가 바뀌었습니다. 참고자료를 다시 열어 주세요.';return;}
    const next=body.value+(body.value?'\n\n':'')+snapshot.text;
    if(body.maxLength>=0&&next.length>body.maxLength){status.textContent='본문 최대 길이를 초과합니다. 내용을 정리한 뒤 다시 시도해 주세요.';return;}
    body.value=next;body.dispatchEvent(new Event('input',{bubbles:true}));invalidate();status.textContent='기존 본문 뒤에 참고자료를 추가했습니다. 내용을 검토한 뒤 저장해 주세요.';
  };
  for(const event of ['input','change'])kind.addEventListener(event,invalidate);
  body.addEventListener('input',invalidate);invalidate();
  return {refresh:invalidate,destroy(){disposed=true;for(const event of ['input','change'])kind.removeEventListener(event,invalidate);body.removeEventListener('input',invalidate);invalidate();normal.onclick=compact.onclick=apply.onclick=null;}};
}
