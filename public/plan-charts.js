const chartFields = [['routeDescription','운행경로'],['workSequence','작업순서 및 방법'],['managementPoints','중점관리사항']];

export function mountPlanCharts(container, button, places, charts, esc) {
  const add = chart => {
    const row = document.createElement('fieldset');
    const options=places.map(place=>'<option value="'+place.id+'" '+(chart.workPlaceId===place.id?'selected':'')+'>'+esc(place.name)+'</option>').join('');
    const fields=chartFields.map(([key,label])=>'<label>'+label+'<textarea data-chart-field="'+key+'" maxlength="4000">'+esc(chart[key]||'')+'</textarea></label>').join('');
    row.innerHTML='<label>작업장소<select data-chart-place required><option value="">선택</option>'+options+'</select></label>'+fields+'<button type="button" data-remove-chart>삭제</button>';
    row.querySelector('[data-remove-chart]').onclick=()=>row.remove();
    container.append(row);
  };
  charts.forEach(add);
  button.onclick=()=>add({});
}

export function readPlanCharts(container) {
  return [...container.children].map(row=>({workPlaceId:Number(row.querySelector('[data-chart-place]').value),...Object.fromEntries(chartFields.map(([key])=>[key,row.querySelector('[data-chart-field="'+key+'"]').value]))}));
}

export function planChartsMarkup(charts, esc) {
  return '<section><h3>추가 작업계획도</h3>'+charts.map(chart=>'<article><h4>'+esc(chart.placeName||'작업장소')+'</h4>'+chartFields.map(([key,label])=>'<p><strong>'+label+'</strong></p><p class="detail-body">'+esc(chart[key]||'미입력')+'</p>').join('')+'</article>').join('')+'</section>';
}
