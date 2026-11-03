const commonOccupations=['강구조','견출','기계-건설','기계-일반','기계설비-건축','기계설비-일반','기타','덕트','도배','도장','목공-건축','목공-형틀','미장','반장','발파','방수','배관-건축','배관-상하수도','배전','보링','보온','보일러','보통인부','비계','석공','수장','용접-일반','용접-특수','유리','전기-내선','전기-외선','정보통신','조경','조적','지붕','창호','철거','철근','측량','코킹','콘크리트','타일','토공','패널조립','포장'];
const commonQuickOccupations=['견출','기계설비-건축','기계설비-일반','기타','덕트','도장','목공-형틀','미장','반장','방수','배관-상하수도','보통인부','비계','석공','수장','유리','조경','조적','철근','코킹','콘크리트','토공','포장'];

export function mountJoinChoices(form){
  const doc=form.ownerDocument,controls={};
  for(const [key,title] of [['company','등록된 소속 선택'],['occupation','직종 선택']]){
    const input=form.elements[key],label=doc.createElement('label'),select=doc.createElement('select'),list=doc.createElement('datalist');
    label.textContent=title;select.setAttribute('aria-label',title);label.append(select);input.closest('label').before(label);
    list.id=`join-${key}-options`;form.append(list);input.setAttribute('list',list.id);
    select.onchange=()=>{if(select.value)input.value=select.value;input.focus();};input.oninput=()=>{select.value=[...select.options].some(option=>option.value===input.value)?input.value:'';};
    controls[key]={input,label,select,list};
  }
  const quick=doc.createElement('details'),summary=doc.createElement('summary'),buttons=doc.createElement('div');summary.textContent='직종 빠른 선택';quick.append(summary,buttons);controls.occupation.input.closest('label').after(quick);
  return data=>{
    for(const [key,names] of [['company',data.companies||[]],['occupation',data.occupations||[]]]){
      const {input,label,select,list}=controls[key],unique=[...new Set(names.filter(name=>typeof name==='string'&&name.length))],choices=key==='occupation'?[...new Set([...unique,...commonOccupations])]:unique;
      const option=(value,text)=>{const item=doc.createElement('option');item.value=value;item.textContent=text;return item;};
      list.replaceChildren(...choices.map(name=>option(name,name)));select.replaceChildren(option('','직접 입력'),...choices.map(name=>option(name,name)));select.value=choices.includes(input.value)?input.value:'';label.hidden=data.existingWorker===true||!choices.length;select.disabled=data.existingWorker===true;
      if(key==='occupation'){const quickNames=unique.length?unique:commonQuickOccupations;quick.hidden=data.existingWorker===true;buttons.replaceChildren(...quickNames.map(name=>{const button=doc.createElement('button');button.type='button';button.textContent=name;button.onclick=()=>{input.value=name;select.value=name;input.focus();};return button;}));}
    }
  };
}
