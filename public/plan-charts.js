const chartFields = [['routeDescription','운행경로'],['workSequence','작업순서 및 방법'],['managementPoints','중점관리사항']];

export function unassignedPlanImages(files, details) {
  const linked=new Set([...(details.additionalCharts||[]).flatMap(chart=>chart.imageIds||[]),...(details.heavyLoads||[]).flatMap(load=>load.safetyImageIds||[])]);
  return files.filter(file=>file.category==='plan_diagram'&&!linked.has(file.id));
}

export function imageChoiceMarkup(images, selected, esc, attribute) {
  const files=images.filter(file=>file.category==='plan_diagram'),ids=new Set(files.map(file=>file.id));
  const choices=files.map(file=>'<label><input type="checkbox" '+attribute+' value="'+file.id+'" '+(selected.includes(file.id)?'checked':'')+'> '+esc(file.name)+'</label>');
  for(const id of selected)if(!ids.has(id))choices.push('<label><input type="checkbox" '+attribute+' value="'+id+'" checked> 삭제된 사진 (선택 해제 필요)</label>');
  return choices.join('')||'<p>계획도·중량물 사진을 첨부해 주세요.</p>';
}

export function refreshPlanImageChoices(fields, images, esc) {
  for(const [listSelector,inputSelector,attribute] of [['[data-chart-image-list]','[data-chart-image]','data-chart-image'],['[data-heavy-image-list]','[data-heavy-image]','data-heavy-image']]){
    fields.querySelectorAll(listSelector).forEach(list=>{const selected=[...list.querySelectorAll(inputSelector+':checked')].map(input=>Number(input.value));list.innerHTML=imageChoiceMarkup(images,selected,esc,attribute);});
  }
}

export function mountPlanCharts(container, button, places, charts, esc, images=[]) {
  const add = chart => {
    const row = document.createElement('fieldset');
    const options=places.map(place=>'<option value="'+place.id+'" '+(chart.workPlaceId===place.id?'selected':'')+'>'+esc(place.name)+'</option>').join('');
    const fields=chartFields.map(([key,label])=>'<label>'+label+'<textarea data-chart-field="'+key+'" maxlength="4000">'+esc(chart[key]||'')+'</textarea></label>').join('');
    const choices=imageChoiceMarkup(images,chart.imageIds||[],esc,'data-chart-image');
    row.innerHTML='<label>작업장소<select data-chart-place required><option value="">선택</option>'+options+'</select></label>'+fields+'<fieldset><legend>계획도 이미지 (최대 5개)</legend>'+'<div data-chart-image-list>'+choices+'</div></fieldset><button type="button" data-remove-chart>삭제</button>';
    row.querySelector('[data-remove-chart]').onclick=()=>row.remove();
    container.append(row);
  };
  charts.forEach(add);
  button.onclick=()=>add({});
}

export function readPlanCharts(container) {
  return [...container.children].map(row=>({workPlaceId:Number(row.querySelector('[data-chart-place]').value),imageIds:[...row.querySelectorAll('[data-chart-image]:checked')].map(input=>Number(input.value)),...Object.fromEntries(chartFields.map(([key])=>[key,row.querySelector('[data-chart-field="'+key+'"]').value]))}));
}

export function planChartsMarkup(charts, esc, images=[], documentId=0, imageUrl=file=>"/api/documents/"+documentId+"/plan-diagrams/"+file.id) {
  return '<section><h3>추가 작업계획도</h3>'+charts.map(chart=>'<article><h4>'+esc(chart.placeName||'작업장소')+'</h4>'+chartFields.map(([key,label])=>'<p><strong>'+label+'</strong></p><p class="detail-body">'+esc(chart[key]||'미입력')+'</p>').join('')+(chart.imageIds||[]).map(id=>images.find(file=>file.id===id)).filter(Boolean).map(file=>'<figure><img class="plan-diagram" src="'+esc(imageUrl(file))+'" alt="'+esc(file.name)+'"><figcaption>'+esc(file.name)+'</figcaption></figure>').join('')+'</article>').join('')+'</section>';
}

export function mountPlanComponentCopy({button,doc,current,dialog,api,showDialog,esc,flash,showError}){
  button.onclick=async()=>{
    if(button.disabled||!button.isConnected||!current()||dialog.open)return;button.disabled=true;
    try{
      const documents=await api(`/api/documents?${new URLSearchParams({siteId:String(doc.site_id),type:'work_plan'})}`,{},current);if(!current()||!button.isConnected||dialog.open)return;
      const candidates=documents.flatMap(source=>{const details=JSON.parse(source.details||'{}');return [['chart',details.additionalCharts||[]],['heavy',details.heavyLoads||[]]].flatMap(([kind,rows])=>rows.map((row,index)=>({source,kind,index,label:kind==='chart'?row.placeName||'작업장소':row.kind||'중량물'})));});
      if(!candidates.length){flash('복사할 계획도나 중량물이 없습니다.',true);return;}
      const options=candidates.map((item,index)=>`<option value="${index}">${esc(item.source.date)} · ${esc(item.source.title)} · ${item.kind==='chart'?'계획도':'중량물'} · ${esc(item.label)}</option>`).join('');
      showDialog('계획 항목 복사',`<p>같은 현장의 계획도 또는 중량물 한 항목과 연결된 사진을 복사합니다. 장구를 사용하는 중량물은 대상 계획서에도 해당 장구가 선택되어야 합니다. 저장된 작성자 시험 서명은 지워집니다.</p><label>복사할 항목<select name="component" required><option value="">선택</option>${options}</select></label>`,async data=>{
        if(!current())throw Error('화면이 변경되었습니다. 다시 조회해 주세요.');if(!/^\d+$/.test(data.component))throw Error('복사할 항목을 선택해 주세요.');const item=candidates[Number(data.component)];if(!item)throw Error('복사할 항목을 선택해 주세요.');
        return api(`/api/documents/${doc.id}/copy-plan-component`,{method:'POST',body:JSON.stringify({siteId:doc.site_id,sourceId:item.source.id,sourceVersion:item.source.edit_version,targetVersion:doc.edit_version,kind:item.kind,index:item.index})},current);
      },current);
    }catch(error){if(current())showError(error);}finally{button.disabled=false;}
  };
}

export function mountWorkerPlanCopy({row,doc,documents,editor,send,active,updateList,status,reportContext}){
  const candidates=documents.filter(item=>item.type==='work_plan').flatMap(source=>{const details=JSON.parse(source.details||'{}');return [['chart',details.additionalCharts||[]],['heavy',details.heavyLoads||[]]].flatMap(([kind,rows])=>rows.map((item,index)=>({source,kind,index,label:kind==='chart'?item.placeName||'작업장소':item.kind||'중량물'})));});
  if(!candidates.length)return;
  const button=document.createElement('button');button.type='button';button.textContent='계획도·중량물 가져오기';row.append(' ',button);let panel,busy=false;
  const current=()=>active()&&row.isConnected;
  button.onclick=()=>{
    if(!current()||busy)return;if(editor.children.length){status.textContent='작성 중인 문서를 저장하거나 닫은 뒤 가져와 주세요.';return;}if(panel){panel.remove();panel=null;return;}
    panel=document.createElement('span');const select=document.createElement('select'),placeholder=document.createElement('option');select.setAttribute('aria-label','복사할 계획 항목');placeholder.value='';placeholder.textContent='복사할 항목 선택';select.append(placeholder);
    candidates.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${item.source.date} · ${item.source.title} · ${item.kind==='chart'?'계획도':'중량물'} · ${item.label}`;select.append(option);});
    const notice=document.createElement('span');notice.textContent='연결 사진을 복사하며 작성자 시험 서명은 지워집니다. ';const apply=document.createElement('button');apply.type='button';apply.textContent='가져오기';panel.append(notice,select,apply);row.append(' ',panel);
    apply.onclick=async()=>{if(!current()||apply.disabled)return;if(editor.children.length){status.textContent='작성 중인 문서를 저장하거나 닫은 뒤 가져와 주세요.';return;}if(!/^\d+$/.test(select.value)){status.textContent='복사할 항목을 선택해 주세요.';return;}const item=candidates[Number(select.value)];if(!item)return;busy=true;apply.disabled=true;select.disabled=true;try{
      await send(`/api/worker/documents/${doc.id}/copy-plan-component`,'POST',{siteId:doc.site_id,sourceId:item.source.id,sourceVersion:item.source.edit_version,targetVersion:doc.edit_version,kind:item.kind,index:item.index,reportContext});
      if(current()){status.textContent=editor.children.length?'항목을 가져왔습니다. 작성 중인 입력을 복사한 뒤 문서를 다시 열어 주세요.':'항목을 가져왔습니다. 작성자 시험 서명은 다시 확인해 주세요.';if(!editor.children.length)await updateList();}
    }catch(error){if(current())status.textContent=error.message;}finally{busy=false;apply.disabled=false;select.disabled=false;}};
  };
}
