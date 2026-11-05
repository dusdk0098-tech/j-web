export function mountPermitMeasures({host,api,siteId,current,addSafety,count,onSources,esc,contextTargets=[],documentLabel='허가서'}){
  host.insertAdjacentHTML('beforeend',`<fieldset data-measure-panel><legend>장비별 기본 안전대책 관리</legend><p>현장 관리자가 직접 작성하는 독립 목록입니다. 제공된 기본 대책이나 외부 서비스의 규칙은 사용하지 않습니다. 적용하면 ${documentLabel}에 사본이 추가되며 저장 전 변경 여부를 확인합니다.</p><label>현장 장비<select data-measure-equipment><option value="">장비 선택</option></select></label><button type="button" data-measure-load>목록 새로고침</button><div data-measure-list></div><label>재해 유형<textarea data-measure-field="accidentType" maxlength="2000"></textarea></label><label>위험요인<textarea data-measure-field="hazard" maxlength="2000"></textarea></label><label>안전대책<textarea data-measure-field="measure" maxlength="2000"></textarea></label><button type="button" data-measure-save>목록 등록</button><button type="button" data-measure-cancel>목록 편집 초기화</button><button type="button" data-measure-detach>적용 내용 유지하고 목록 연결 해제</button><p data-measure-status role="status"></p></fieldset>`);
  const panel=host.querySelector('[data-measure-panel]'),find=selector=>panel.querySelector(selector),select=find('[data-measure-equipment]'),list=find('[data-measure-list]'),status=find('[data-measure-status]'),save=find('[data-measure-save]'),fields=['accidentType','hazard','measure'].map(key=>[key,find(`[data-measure-field="${key}"]`)]);
  let equipmentId='',rows=[],editing=null,busy=false,sources=[];
  onSources([]);
  let invalidated=false;
  const invalidate=()=>{invalidated=true;for(const [target,event] of contextTargets)target.removeEventListener(event,invalidate);};
  for(const [target,event] of contextTargets)target.addEventListener(event,invalidate);
  const valid=()=>!invalidated&&panel.isConnected&&current();
  const path=id=>`/api/equipment/${equipmentId}/permit-measures${id?'/'+id:''}?siteId=${siteId}`;
  const reset=()=>{editing=null;for(const [,node] of fields)node.value='';save.textContent='목록 등록';};
  const render=()=>{list.innerHTML=rows.length?rows.map(row=>`<article><p>${esc(row.accidentType)} · ${esc(row.hazard)}</p><p>${esc(row.measure)}</p>${[['apply',`${documentLabel}에 추가`],['edit','수정'],['delete','삭제']].map(([action,label])=>`<button type="button" data-measure-action="${action}" data-id="${row.id}">${label}</button>`).join('')}</article>`).join(''):'<p>등록한 안전대책이 없습니다.</p>';};
  const run=async action=>{if(busy||!valid())return;busy=true;for(const node of panel.querySelectorAll('button,select,textarea'))node.disabled=true;try{await action();}catch(error){if(valid())status.textContent=error.message;}finally{busy=false;for(const node of panel.querySelectorAll('button,select,textarea'))node.disabled=false;}};
  const load=async()=>{if(!equipmentId)throw Error('장비를 선택해 주세요.');const result=await api(path(),{},valid);if(!valid())return;rows=result;render();status.textContent='목록을 조회했습니다. 편집 중인 내용은 유지됩니다.';};
  select.onchange=()=>{if(busy||fields.some(([,node])=>node.value)||editing){select.value=equipmentId;status.textContent='편집 내용을 저장하거나 초기화한 뒤 장비를 변경해 주세요.';return;}equipmentId=select.value;rows=[];list.textContent='';if(equipmentId)run(load);};
  find('[data-measure-load]').onclick=()=>run(load);
  find('[data-measure-cancel]').onclick=()=>{if(!busy)reset();};
  find('[data-measure-detach]').onclick=()=>{if(!busy){sources=[];onSources([]);status.textContent='추가한 내용은 직접 입력 자료로 유지됩니다. 목록 변경 검사는 해제했습니다.';}};
  save.onclick=()=>run(async()=>{if(!equipmentId)throw Error('장비를 선택해 주세요.');const input=Object.fromEntries(fields.map(([key,node])=>[key,node.value]));if(editing)input.expectedVersion=editing.version;await api(path(editing?.id),{method:editing?'PUT':'POST',body:JSON.stringify(input)},valid);if(!valid())return;reset();await load();});
  list.onclick=event=>run(async()=>{
    const button=event.target.closest('[data-measure-action]');if(!button)return;const row=rows.find(row=>row.id===Number(button.dataset.id));if(!row)return;
    if(button.dataset.measureAction==='edit'){if(fields.some(([,node])=>node.value)||editing)throw Error('편집 내용을 저장하거나 초기화한 뒤 다른 항목을 수정해 주세요.');editing=row;for(const [key,node] of fields)node.value=row[key];save.textContent='목록 수정 저장';return;}
    if(button.dataset.measureAction==='delete'){await api(path(row.id),{method:'DELETE',body:JSON.stringify({expectedVersion:row.version})},valid);if(valid())await load();return;}
    const fresh=await api(path(),{},valid);if(!valid())return;
    if(!fresh.some(item=>item.id===row.id&&item.version===row.version))throw Error('목록이 변경되었습니다. 다시 조회해 주세요.');
    if(count()>=100)throw Error('안전대책은 최대 100개까지 추가할 수 있습니다.');
    addSafety(row);if(!sources.some(item=>item.id===row.id))sources.push({id:row.id,equipmentId:Number(equipmentId),version:row.version});onSources([...sources]);status.textContent=`${documentLabel}에 추가했습니다. 내용을 확인한 뒤 저장해 주세요.`;
  });
  return run(async()=>{const equipment=await api(`/api/equipment?siteId=${siteId}`,{},valid);if(valid())select.innerHTML='<option value="">장비 선택</option>'+equipment.map(row=>`<option value="${row.id}">${esc([row.kind,row.model,row.registration].filter(Boolean).join(' · '))}</option>`).join('');});
}
