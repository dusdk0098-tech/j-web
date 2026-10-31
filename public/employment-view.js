const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requestId=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');

export async function mountEmployment({target,api,active}){
  let epoch=0,pending=null;
  const load=async()=>{
    const current=++epoch,data=await api('/api/reviewer/employment');if(current!==epoch||!active())return;
    const profile=data.profile;
    target.innerHTML=`<h2>재직 증명서</h2><p>발급 가능 여부: <strong>${data.eligible?'발급 가능':'발급 불가 · 관리자에게 문의'}</strong></p><h3>점검 사항</h3><ul>${data.checks.map(check=>`<li>${esc(check.label)} · ${check.passed?'확인':'확인 필요'}</li>`).join('')}</ul><button type="button" data-refresh>상태 다시 확인</button>${data.eligible?`<p>${esc(profile.employer)} · ${esc(profile.position)} · ${esc(profile.startDate)} ~ ${esc(profile.endDate||'현재')}</p><form data-issue><label>발급 용도 <input name="purpose" maxlength="200" required></label> <label>제출처 <input name="recipient" maxlength="200"></label> <button type="submit">시험 증명서 발급</button></form>`:''}<h3>발급 기록</h3>${data.certificates.length?`<ul>${data.certificates.map(item=>`<li><a href="/employment-certificate?id=${item.id}" target="_blank" rel="noopener noreferrer">시험 증명서 ${item.id} 보기</a> · ${esc(item.created_at)} (UTC)</li>`).join('')}</ul>`:'<p>발급 기록이 없습니다.</p>'}<p data-status role="status"></p>`;
    const output=target.querySelector('[data-status]');target.querySelector('[data-refresh]').onclick=()=>load().catch(error=>{if(active())output.textContent=error.message;});
    const form=target.querySelector('[data-issue]');if(!form)return;
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]'),purpose=form.elements.purpose.value.trim(),recipient=form.elements.recipient.value.trim(),key=JSON.stringify({purpose,recipient,version:data.version});button.disabled=true;try{if(!pending||pending.key!==key)pending={key,requestId:requestId()};const result=await api('/api/reviewer/employment',{method:'POST',body:JSON.stringify({purpose,recipient,version:data.version,requestId:pending.requestId})});if(!active())return;await load();if(active()){pending=null;target.querySelector('[data-status]').textContent=`시험 증명서 ${result.id}을 발급했습니다. 발급 기록에서 확인하세요.`;}}catch(error){if(active()&&output.isConnected)output.textContent=error.message;}finally{button.disabled=false;}};
  };
  await load();
}
