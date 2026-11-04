const originalKinds=['고소작업대(시저형)','고소작업대(차량형)','굴착기','덤프트럭','이동식크레인','콘크리트펌프카'];

export function equipmentKinds(items) {
  return [...new Set([...originalKinds,...items.map(item=>item.kind).filter(Boolean)])];
}
export function equipmentOptions(items, kind, selected, esc) {
  return '<option value="">선택</option>'+items.filter(item=>!kind||item.kind===kind).map(item=>'<option value="'+item.id+'" '+(String(item.id)===String(selected||'')?'selected':'')+'>'+esc(item.kind)+' · '+esc(item.model)+' · '+esc(item.registration)+'</option>').join('');
}
export function equipmentFilterMarkup(items, selected, esc) {
  return '<label>장비 분류<select data-assignment-kind><option value="">전체</option>'+equipmentKinds(items).map(kind=>'<option value="'+esc(kind)+'">'+esc(kind)+'</option>').join('')+'</select></label><label>장비<select data-assignment-equipment required>'+equipmentOptions(items,'',selected,esc)+'</select></label>';
}
export function mountEquipmentFilter(row, items, esc) {
  const kind=row.querySelector('[data-assignment-kind]'),equipment=row.querySelector('[data-assignment-equipment]'),remembered=new Map();let previous=kind.value;
  equipment.addEventListener('change',()=>remembered.set(kind.value,equipment.value));
  kind.addEventListener('change',()=>{remembered.set(previous,equipment.value);previous=kind.value;const current=items.find(item=>String(item.id)===equipment.value),selected=current&&(!kind.value||current.kind===kind.value)?current.id:remembered.get(kind.value);equipment.innerHTML=equipmentOptions(items,kind.value,selected,esc);});
}
