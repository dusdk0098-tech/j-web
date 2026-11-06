import { imageChoiceMarkup } from './plan-charts.js';

export function heavyRiggingChoices(kind, saved='') {
  const choices=kind==='lines'?['1줄','2줄','3줄','4줄']:['일자형','올가미형','U자형'];
  return saved&&!choices.includes(saved)?[...choices,saved]:choices;
}

export function heavyRiggingOptions(kind, saved, esc) {
  return '<option value="">선택</option>'+heavyRiggingChoices(kind,saved).map(value=>'<option value="'+esc(value)+'" '+(value===saved?'selected':'')+'>'+esc(value)+'</option>').join('');
}

export function heavyLiftOptions(saved='') {
  return '<option value="">선택</option><option value="hook" '+(saved==='hook'?'selected':'')+'>훅 사용 (줄걸이 미사용)</option><option value="rigging" '+(saved==='rigging'?'selected':'')+'>줄걸이 사용</option>'+(saved==='other'?'<option value="other" selected>기타 방식 (기존 기록)</option>':'');
}

export function heavyImageChoices(images, selected, esc) {
  return imageChoiceMarkup(images,selected,esc,'data-heavy-image');

}

export function heavyImageMarkup(loads, images, esc, url) {
  return '<section><h3>중량물 안전성 검토 사진</h3>'+loads.filter(load=>load.safetyImageIds?.length).map(load=>'<article><h4>'+esc(load.kind)+'</h4>'+load.safetyImageIds.map(id=>images.find(file=>file.id===id)).filter(Boolean).map(file=>'<figure><img class="plan-diagram" src="'+esc(url(file))+'" alt="'+esc(file.name)+'"><figcaption>'+esc(file.name)+'</figcaption></figure>').join('')+'</article>').join('')+'</section>';
}

export function riggingStandardChoices(asset, saved='') {
  let standards=asset?.standards;
  if(!standards&&asset?.details){try{standards=JSON.parse(asset.details).standards;}catch{standards=[];}}
  const options=Array.isArray(standards)?[...new Set(standards.filter(value=>typeof value==='string'&&value))]:[];
  return saved&&!options.includes(saved)?[...options,saved]:options;
}

export function mountRiggingStandards(row, assets, saved, esc) {
  for(const [assetKey,standardKey] of [['riggingId','ropeStandard'],['fasteningId','fasteningStandard']]){
    const asset=row.querySelector('[data-heavy="'+assetKey+'"]'),standard=row.querySelector('[data-heavy="'+standardKey+'"]'),remembered=new Map();
    let previous=asset.value;remembered.set(previous,saved[standardKey]||'');
    const render=()=>{
      const value=remembered.get(asset.value)||'',selected=assets.find(item=>String(item.id)===asset.value),values=riggingStandardChoices(selected,value);
      standard.innerHTML='<option value="">규격 선택 안 함</option>'+values.map(entry=>'<option value="'+esc(entry)+'" '+(entry===value?'selected':'')+'>'+esc(entry)+'</option>').join('');
    };
    standard.addEventListener('change',()=>remembered.set(asset.value,standard.value));
    asset.addEventListener('change',()=>{remembered.set(previous,standard.value);previous=asset.value;render();});
    render();
  }
}
