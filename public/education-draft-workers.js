export function mountEducationDraftWorkers(host,{dateInput,siteId,api,active,esc}){
  host.innerHTML='<fieldset><legend>교육 근로자 대상</legend><label><input type="checkbox" data-enable> 출역 근로자 직접 지정</label><p>선택하지 않으면 현장의 모든 근로자에게 표시됩니다.</p><div data-panel hidden><button type="button" data-load>출역 목록 다시 확인</button><p data-status role="status"></p><div data-list></div></div></fieldset>';
  const enable=host.querySelector('[data-enable]'),panel=host.querySelector('[data-panel]'),loadButton=host.querySelector('[data-load]'),status=host.querySelector('[data-status]'),list=host.querySelector('[data-list]');
  let request=0,loaded='';
  const current=()=>host.isConnected&&active();
  const selected=()=>new Set([...list.querySelectorAll('[data-worker]:checked')].map(item=>Number(item.value)));
  let previous=[];
  const load=async()=>{
    if(!current()||!enable.checked)return;const date=dateInput.value,generation=++request;loaded='';status.textContent='출역 목록을 불러오는 중입니다.';
    try{
      const rows=await api(`/api/attendance?siteId=${siteId}&date=${encodeURIComponent(date)}`,{},()=>current()&&generation===request&&dateInput.value===date);
      if(!current()||generation!==request||dateInput.value!==date||!enable.checked)return;
      const chosen=selected(),present=rows.filter(row=>row.present),visible=[...present,...previous.filter(row=>chosen.has(row.id)&&!present.some(item=>item.id===row.id)).map(row=>({...row,present:false}))];previous=visible;
      list.innerHTML=visible.map(row=>`<label><input type="checkbox" data-worker value="${row.id}" ${chosen.has(row.id)?'checked':''}> ${esc(row.name)} · ${esc(row.company)}${row.present?'':' · 이전 날짜 선택'}</label>`).join('')||'<p>해당 날짜의 출역 근로자가 없습니다.</p>';
      loaded=date;status.textContent='선택한 근로자만 교육 대상으로 저장합니다.';
    }catch(error){if(current()&&generation===request)status.textContent=error.message;}
  };
  enable.onchange=()=>{panel.hidden=!enable.checked;if(enable.checked)load();else{request++;loaded='';}};
  loadButton.onclick=load;
  dateInput.addEventListener('change',()=>{if(current()&&enable.checked)load();});
  return ()=>{if(!enable.checked)return undefined;if(!current()||!loaded||loaded!==dateInput.value)throw Error('교육일의 출역 목록을 확인한 뒤 저장해 주세요.');return [...selected()];};
}
