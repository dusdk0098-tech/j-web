const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fields=[['employer','가상 사업체명'],['address','가상 사업체 주소'],['phone','가상 사업체 연락처'],['representative','가상 대표자'],['workplace','가상 근무장소']];

export function closeContractPreview(doc){doc.querySelector('dialog.contract-preview[open]')?.close();}

export async function mountContractProfile({target,siteId,api,active,sessionCheck}){
  const url=`/api/sites/${siteId}/contract-profile`,doc=target.ownerDocument;let current=await api(url);if(!active())return;
  target.innerHTML=`<h3>가상 근로계약 출력 정보</h3><p>현장별 가상 정보를 저장합니다. 시험용이며 실제 근로계약에 사용하지 마세요.</p><form data-profile>${fields.map(([key,label])=>`<label>${label}<input name="${key}" maxlength="300" value="${escape(current.profile[key])}"></label>`).join('')}<button type="submit">정보 저장</button></form><button type="button" data-preview>계약 서식 미리보기</button><p role="status" data-status></p>`;
  const form=target.querySelector('[data-profile]'),status=target.querySelector('[data-status]'),preview=target.querySelector('[data-preview]');let busy=false;
  form.onsubmit=async event=>{event.preventDefault();if(busy||!active())return;busy=true;try{await sessionCheck();const input=Object.fromEntries(fields.map(([key])=>[key,form.elements[key].value]));const result=await api(url,{method:'PUT',body:JSON.stringify({...input,version:current.profile.version})});if(!active())return;current=result;status.textContent='가상 출력 정보를 저장했습니다.';}catch(error){if(active())status.textContent=error.message;}finally{busy=false;}};
  preview.onclick=async()=>{if(busy||!active())return;busy=true;try{
    if(fields.some(([key])=>form.elements[key].value.trim()!==current.profile[key]))throw Error('변경한 출력 정보를 먼저 저장해 주세요.');
    await sessionCheck();const result=await api(url);if(!active())return;if(result.profile.version!==current.profile.version)throw Error('정보가 변경되었습니다. 화면을 다시 조회해 주세요.');
    const dialog=doc.createElement('dialog');dialog.className='contract-preview';dialog.innerHTML=`<article class="self-check-print"><h2>가상 건설 일용근로계약 기록</h2><p>J웹 시험용 빈 서식</p><p>현장: ${escape(result.site.name)}</p>${fields.map(([key,label])=>`<p>${label}: ${escape(result.profile[key])||'________________'}</p>`).join('')}<p>가상 근로자: ____________ · 가상 생년 정보: ____________</p><p>가상 근로자 주소: ____________________ · 연락처: ____________________</p><p>근로 시작일: ____________ · 종료일: ____________</p><p>업무 및 직종: ____________________</p><p>근로 시작: ____________ · 종료: ____________ · 휴게: ____________</p><p>근무일: ____________ · 주휴일: ____________</p><p>가상 일급 또는 월급: ____________ · 수당: ____________</p><p>임금 지급일: ____________ · 지급방법: ____________________</p><p>연차휴가: ____________________ · 사회보험: ____________________</p><p>작성일: ____________________</p><p>가상 사업주 시험 서명: ____________ · 가상 근로자 시험 서명: ____________</p></article><p role="status" data-print-status></p><button type="button" data-print>인쇄</button> <button type="button" data-close>닫기</button>`;
    doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    const button=dialog.querySelector('[data-print]');button.onclick=async()=>{if(button.disabled||!dialog.open||!active())return;button.disabled=true;try{await sessionCheck();const latest=await api(url);await sessionCheck();if(JSON.stringify(latest)!==JSON.stringify(result))throw Error('출력 정보가 변경되었습니다. 다시 조회해 주세요.');if(dialog.open&&active())doc.defaultView.print();}catch(error){if(dialog.open)dialog.querySelector('[data-print-status]').textContent=error.message;}finally{button.disabled=false;}};
    dialog.showModal();
  }catch(error){if(active())status.textContent=error.message;}finally{busy=false;}};
}
