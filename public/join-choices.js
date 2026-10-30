export function mountJoinChoices(form){
  const doc=form.ownerDocument,controls={};
  for(const [key,title] of [['company','등록된 소속 선택'],['occupation','등록된 직종 선택']]){
    const input=form.elements[key],label=doc.createElement('label'),select=doc.createElement('select'),list=doc.createElement('datalist');
    label.textContent=title;select.setAttribute('aria-label',title);label.append(select);input.closest('label').before(label);
    list.id=`join-${key}-options`;form.append(list);input.setAttribute('list',list.id);
    select.onchange=()=>{if(select.value)input.value=select.value;input.focus();};input.oninput=()=>{select.value=[...select.options].some(option=>option.value===input.value)?input.value:'';};
    controls[key]={input,label,select,list};
  }
  const quick=doc.createElement('details'),summary=doc.createElement('summary'),buttons=doc.createElement('div');summary.textContent='직종 빠른 선택';quick.append(summary,buttons);controls.occupation.input.closest('label').after(quick);
  return data=>{
    for(const [key,names] of [['company',data.companies||[]],['occupation',data.occupations||[]]]){
      const {input,label,select,list}=controls[key],unique=[...new Set(names.filter(name=>typeof name==='string'&&name.length))];
      const option=(value,text)=>{const item=doc.createElement('option');item.value=value;item.textContent=text;return item;};
      list.replaceChildren(...unique.map(name=>option(name,name)));select.replaceChildren(option('','직접 입력'),...unique.map(name=>option(name,name)));select.value=unique.includes(input.value)?input.value:'';label.hidden=!unique.length;
      if(key==='occupation'){quick.hidden=!unique.length;buttons.replaceChildren(...unique.map(name=>{const button=doc.createElement('button');button.type='button';button.textContent=name;button.onclick=()=>{input.value=name;select.value=name;input.focus();};return button;}));}
    }
  };
}
