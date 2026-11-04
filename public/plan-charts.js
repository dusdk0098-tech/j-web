const chartFields = [['routeDescription','운행경로'],['workSequence','작업순서 및 방법'],['managementPoints','중점관리사항']];

export function unassignedPlanImages(files, details) {
  const linked=new Set([...(details.additionalCharts||[]).flatMap(chart=>chart.imageIds||[]),...(details.heavyLoads||[]).flatMap(load=>load.safetyImageIds||[])]);
  return files.filter(file=>file.category==='plan_diagram'&&!linked.has(file.id));
}

export function mountPlanCharts(container, button, places, charts, esc, images=[]) {
  const add = chart => {
    const row = document.createElement('fieldset');
    const options=places.map(place=>'<option value="'+place.id+'" '+(chart.workPlaceId===place.id?'selected':'')+'>'+esc(place.name)+'</option>').join('');
    const fields=chartFields.map(([key,label])=>'<label>'+label+'<textarea data-chart-field="'+key+'" maxlength="4000">'+esc(chart[key]||'')+'</textarea></label>').join('');
    const choices=images.map(file=>'<label><input type="checkbox" data-chart-image value="'+file.id+'" '+((chart.imageIds||[]).includes(file.id)?'checked':'')+'> '+esc(file.name)+'</label>').join('');
    row.innerHTML='<label>작업장소<select data-chart-place required><option value="">선택</option>'+options+'</select></label>'+fields+'<fieldset><legend>계획도 이미지 (최대 5개)</legend>'+(choices||'<p>문서 저장 후 계획도 이미지를 첨부하고 다시 수정해 주세요.</p>')+'</fieldset><button type="button" data-remove-chart>삭제</button>';
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
