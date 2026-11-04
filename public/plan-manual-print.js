import { reservePlanPrint } from './plan-print-lock.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function manualPlanMarkup(plan,equipment,checks,fields) {
  if(plan.type!=='work_plan')throw Error('작업계획서를 다시 선택해 주세요.');
  const details=JSON.parse(plan.details||'{}');
  const selected=Array.isArray(details.equipmentSnapshot)?details.equipmentSnapshot:equipment.filter(item=>(details.equipmentIds||[]).includes(item.id));
  const table=names=>`<table><thead><tr><th>점검 항목</th><th>판정</th><th>조치</th><th>확인/서명</th></tr></thead><tbody>${(names.length?names:['','','','']).map(name=>`<tr><td>${escape(name)}</td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>`;
  return `<h2>작업계획서 수기 점검표 · 빈 시험 양식</h2><p>J웹 시험 서식이며 공식 서식이 아닙니다. 저장된 점검 결과·조치·서명은 포함하지 않습니다.</p><h3>${escape(plan.title)}</h3><p>계획서 작성일: ${escape(plan.date)}</p>${Object.entries(fields).filter(([key])=>details[key]).map(([key,label])=>`<p>${escape(label)}: ${escape(details[key])}</p>`).join('')}<p>점검일: ____________________　점검자: ____________________</p><p>계획서에 연결된 장비의 ${Array.isArray(details.equipmentSnapshot)?'저장 당시':'조회 당시'} 정보와 기존 점검의 사용자 작성 항목명만 표시합니다. 중복 항목명은 한 번만 표시합니다.</p>${selected.length?selected.map(item=>{const names=[...new Set(checks.filter(check=>check.equipment_id===item.id).flatMap(check=>JSON.parse(check.items).map(row=>row.name)).filter(Boolean))];return `<section><h3>${escape(item.kind)} · ${escape(item.model)} · ${escape(item.registration||'등록번호 미기록')}</h3><p>용량: ${escape(item.capacity||'미기록')}</p>${table(names)}</section>`;}).join(''):`<p>연결된 장비가 없습니다. 필요한 항목은 수기로 작성하세요.</p>${table([])}`}`;
}

export function mountManualPlanPrint({content,button,planId,api,active,fields,onError=()=>{}}) {
  button.onclick=async()=>{
    if(button.disabled||!active())return;
    const doc=content.ownerDocument,view=doc.defaultView,dialog=doc.createElement('dialog'),controller=new AbortController();
    const release=reservePlanPrint(view);if(!release){onError(Error('다른 작업계획서 인쇄가 진행 중입니다. 기존 인쇄를 닫은 뒤 다시 시도해 주세요.'));return;}
    dialog.className='plan-manual-preview';dialog.setAttribute('aria-label','수기 점검표 출력 미리보기');
    dialog.innerHTML='<div class="plan-manual-controls"><button type="button" data-close>취소·닫기</button> <button type="button" data-print disabled>빈 양식 인쇄</button><p role="status" data-status>빈 양식을 준비하고 있습니다…</p></div><div data-output></div>';
    const status=dialog.querySelector('[data-status]'),print=dialog.querySelector('[data-print]'),output=dialog.querySelector('[data-output]');
    let closed=false,timer,timeout;
    const live=()=>!closed&&active()&&button.isConnected;
    const close=()=>{if(closed)return;closed=true;release();controller.abort();clearInterval(timer);clearTimeout(timeout);view.removeEventListener('afterprint',close);dialog.close();dialog.remove();button.disabled=false;};
    dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);
    button.disabled=true;doc.body.append(dialog);
    const load=async()=>{
      const options={signal:controller.signal},plan=await api(`/api/documents/${planId}`,options);
      if(!live()||controller.signal.aborted)return null;
      const [equipment,checks]=await Promise.all([api(`/api/equipment?siteId=${plan.site_id}`,options),api(`/api/documents/${planId}/equipment-checks`,options)]);
      if(!live()||controller.signal.aborted)return null;
      return manualPlanMarkup(plan,equipment,checks,fields);
    };
    const fail=error=>{if(live()){status.textContent=`인쇄 준비를 중단했습니다. ${error.message}`;print.disabled=true;onError(error);close();}};
    const startTimeout=()=>{clearTimeout(timeout);timeout=setTimeout(()=>{if(live()){fail(Error('인쇄 준비 시간이 초과되었습니다. 다시 시도해 주세요.'));}},15000);};
    try{
      dialog.showModal();timer=setInterval(()=>{if(!live())close();},100);startTimeout();
      const markup=await load();clearTimeout(timeout);if(!live()||controller.signal.aborted)return;
      output.innerHTML=markup;status.textContent='빈 양식 준비 완료. 내용을 확인한 뒤 인쇄하세요.';print.disabled=false;
      print.onclick=async()=>{
        if(print.disabled||!live())return;print.disabled=true;status.textContent='최신 정보와 접근 권한을 확인하고 있습니다…';startTimeout();
        try{const latest=await load();if(!live()||controller.signal.aborted)return;if(latest!==markup)throw Error('계획·장비·점검 항목이 변경되었습니다. 닫고 다시 준비해 주세요.');if(!doc.querySelector('link[href="/plan-manual-print.css"]')?.sheet)throw Error('인쇄 서식을 불러오지 못했습니다. 화면을 새로 고쳐 주세요.');status.textContent='인쇄 창을 닫으면 미리보기도 닫힙니다.';view.addEventListener('afterprint',close,{once:true});view.print();}catch(error){fail(error);}finally{clearTimeout(timeout);}
      };
    }catch(error){clearTimeout(timeout);fail(error);if(!dialog.open)close();}
  };
}
