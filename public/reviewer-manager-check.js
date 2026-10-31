export const managerCheckQuestions=['안전장구를 착용하였습니까?','음주행위를 하지 않았습니까?','안전체조를 하였습니까?'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function mountReviewerManagerCheck({target,api,pad,active}){
  let epoch=0;
  const load=async()=>{
    const generation=++epoch,data=await api('/api/reviewer/manager-checks');if(generation!==epoch||!active())return;
    const current=data.records.find(row=>row.date===data.today),previous=data.records.filter(row=>row.kind==='check'&&row.date<data.today);
    target.innerHTML=`<h2>직원 시험 자가점검</h2><p>${esc(data.today)} · 개인 시험 기록입니다.</p>${current?current.kind==='day_off'?'<p>오늘 시험 휴무를 기록했습니다.</p>':`<p>오늘의 시험 점검을 기록했습니다.</p><ul>${managerCheckQuestions.map((question,i)=>`<li>${esc(question)} ${esc(current.answers?.[i]?.answer||'미기록')}${current.answers?.[i]?.note?' · '+esc(current.answers[i].note):''}</li>`).join('')}</ul><a href="/api/reviewer/manager-checks/signature?date=${encodeURIComponent(data.today)}">시험 서명 보기</a>`:`<label>이전 시험 내용 불러오기 <select data-previous><option value="">선택</option>${previous.map((row,i)=>`<option value="${i}">${esc(row.date)}</option>`).join('')}</select></label><form data-check>${managerCheckQuestions.map((question,i)=>`<fieldset><legend>${esc(question)}</legend><label><input type="radio" name="answer${i}" value="O" required> O</label><label><input type="radio" name="answer${i}" value="X"> X</label><label>비고 <input name="note${i}" maxlength="500"></label></fieldset>`).join('')}<p>시험 서명</p><canvas data-signature class="signature-pad" width="320" height="120" aria-label="시험 서명 입력"></canvas><button type="button" data-clear>서명 지우기</button><button type="submit">시험 점검 저장</button></form><button type="button" data-dayoff>시험 휴무 기록</button>`} <button type="button" data-reload>다시 조회</button><p data-status role="status"></p>`;
    const status=target.querySelector('[data-status]'),reload=target.querySelector('[data-reload]');let dirty=false,busy=false;
    reload.onclick=()=>{if(dirty&&!confirm('저장하지 않은 답변을 버리고 다시 조회할까요?'))return;load().catch(error=>{if(active()&&status.isConnected)status.textContent=error.message;});};
    if(current)return;
    const form=target.querySelector('[data-check]'),submit=form.querySelector('[type=submit]'),dayoff=target.querySelector('[data-dayoff]'),clear=target.querySelector('[data-clear]'),canvas=target.querySelector('[data-signature]'),readSignature=pad(canvas,clear);
    form.addEventListener('input',()=>{dirty=true;});form.addEventListener('change',()=>{dirty=true;});canvas.addEventListener('pointerdown',()=>{dirty=true;});clear.addEventListener('click',()=>{dirty=true;});
    target.querySelector('[data-previous]').onchange=event=>{if(event.target.value==='')return;const row=previous[Number(event.target.value)];if(!row)return;row.answers.forEach((answer,i)=>{form.elements[`answer${i}`].value=answer.answer;form.elements[`note${i}`].value=answer.note;});dirty=true;};
    const save=async input=>{if(busy)return;busy=true;submit.disabled=dayoff.disabled=true;try{await api('/api/reviewer/manager-checks',{method:'POST',body:JSON.stringify({...input,expectedDate:data.today})});if(active())await load();}catch(error){if(active()&&status.isConnected)status.textContent=error.message;}finally{busy=false;submit.disabled=dayoff.disabled=false;}};
    form.onsubmit=event=>{event.preventDefault();try{const answers=managerCheckQuestions.map((_,i)=>({answer:form.elements[`answer${i}`].value,note:form.elements[`note${i}`].value}));return save({kind:'check',answers,signature:readSignature()});}catch(error){status.textContent=error.message;}};
    dayoff.onclick=()=>save({kind:'day_off'});
  };
  await load();
}

