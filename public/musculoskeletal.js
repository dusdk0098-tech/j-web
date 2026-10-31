import { riskScaleOptions, riskScore, copyMusculoskeletalItems } from './risk-scale.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={processName:'가상 공정명',contractor:'가상 협력사',task:'작업 내용',hazard:'부담 요인',existingMeasures:'현재 조치',additionalMeasures:'추가 조치'};
const choices={grade:['상','중','하'],improvedGrade:['상','중','하'],likelihood:['1','2','3','4','5'],severity:['1','2','3','4']};
const choiceLabels={grade:'현재 위험 등급',improvedGrade:'개선 후 위험 등급',likelihood:'가능성',severity:'중대성'};

export function mountMusculoskeletal(container,{rows,companies,scale,references}){
  container.innerHTML='<fieldset><legend>근골격계 가상 위험요인</legend><p>직접 입력한 시험 자료입니다. 자동 참고자료와 실제 위험 판정은 제공하지 않습니다.</p><div data-mus-list></div><button type="button" data-mus-direct>직접 입력 3개 추가</button> <button type="button" data-mus-add>항목 추가</button> <button type="button" data-mus-delete>선택 항목 삭제</button><p data-mus-status role="status"></p></fieldset>';
  const list=container.querySelector('[data-mus-list]'),status=container.querySelector('[data-mus-status]');let referencePanel;
  function add(row={}){
    if(list.children.length>=100){status.textContent='근골격계 항목은 100개까지 입력할 수 있습니다.';return;}
    const item=document.createElement('fieldset');
    item.innerHTML=`<legend>근골격계 항목</legend><label><input type="checkbox" data-mus-selected ${row.selected===false?'':'checked'}> 평가에 선택</label><label>현장 협력사 선택<select data-mus-company><option value="0">직접 입력</option>${row.contractorId&&!companies.some(c=>c.id===row.contractorId)?`<option selected value="${esc(row.contractorId)}">이전 업체를 찾을 수 없음</option>`:''}${companies.map(c=>`<option value="${c.id}" ${c.id===row.contractorId?'selected':''}>${esc(c.name)} · 등록번호 ${esc(c.id)}</option>`).join('')}</select></label>${Object.entries(fields).map(([key,label])=>`<label>${esc(label)}<input data-mus-field="${key}" maxlength="2000" value="${esc(row[key]||'')}"></label>`).join('')}${Object.entries(choices).map(([key,values])=>`<label>${esc(choiceLabels[key])}<select data-mus-field="${key}"><option value="">미입력</option>${values.map(value=>`<option value="${value}" ${row[key]===value?'selected':''}>${value}</option>`).join('')}</select></label>`).join('')}<p data-mus-score aria-live="polite"></p><button type="button" data-mus-remove>삭제</button> <button type="button" data-mus-up>위로 이동</button> <button type="button" data-mus-down>아래로 이동</button>`;
    list.append(item);refresh();
  }
  function conflicts(value){return [...list.querySelectorAll('select[data-mus-field]')].some(input=>input.value&&!riskScaleOptions(value,input.dataset.musField).includes(input.value));}
  function refresh(){
    referencePanel?.refresh();
    for(const input of list.querySelectorAll('select[data-mus-field]')){const options=riskScaleOptions(scale(),input.dataset.musField);input.disabled=!options.length&&!input.value;for(const option of input.options)option.disabled=!!option.value&&!options.includes(option.value);}
    for(const row of list.children){const score=riskScore(scale(),row.querySelector('[data-mus-field=likelihood]').value,row.querySelector('[data-mus-field=severity]').value);row.querySelector('[data-mus-score]').textContent=score===null?'시험 점수: 미입력':`시험 점수: ${score}`;}
  }
  function append(items){const copied=copyMusculoskeletalItems(items,list.children.length,scale());copied.forEach(add);return copied.length;}
  const direct=container.querySelector('[data-mus-direct]');
  direct.onclick=()=>{
    if(direct.matches(':disabled')||container.closest('form')?.querySelector('button[type=submit]')?.disabled)return;
    try{append(Array.from({length:3},()=>({selected:true})));status.textContent='빈 항목 3개를 추가했습니다. 내용을 입력한 뒤 저장하세요.';container.dispatchEvent(new Event('input',{bubbles:true}));}
    catch(error){status.textContent=error.message;}
  };
  container.querySelector('[data-mus-add]').onclick=()=>add();
  container.querySelector('[data-mus-delete]').onclick=()=>{for(const row of [...list.children])if(row.querySelector('[data-mus-selected]').checked)row.remove();};
  list.addEventListener('change',event=>{if(event.target.matches('[data-mus-company]')){const company=companies.find(c=>c.id===Number(event.target.value));if(company)event.target.closest('fieldset').querySelector('[data-mus-field=contractor]').value=company.name;}refresh();});
  list.addEventListener('click',event=>{const row=event.target.closest('fieldset');if(!row||row.parentElement!==list)return;if(event.target.matches('[data-mus-remove]'))row.remove();if(event.target.matches('[data-mus-up]')&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);if(event.target.matches('[data-mus-down]')&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);if(event.target.matches('[data-mus-up],[data-mus-down]'))event.target.focus();});
  rows.forEach(add);
  const editor={refresh,conflicts,append,read(){return [...list.children].map(row=>{const result=Object.fromEntries([...row.querySelectorAll('[data-mus-field]')].map(input=>[input.dataset.musField,input.value])),id=Number(row.querySelector('[data-mus-company]').value);if(id)result.contractorId=id;result.selected=row.querySelector('[data-mus-selected]').checked;return result;});}};
  if(references){const panel=document.createElement('div');container.append(panel);referencePanel=mountMuscleReferences(panel,{...references,editor,scale});}
  return editor;
}

export function mountMuscleReferences(container,{editor,scale,request,siteId,worker=false,active}){
  container.innerHTML=`<fieldset><legend>현장별 근골격계 참고자료</legend><p>J웹 사용자가 직접 작성해 저장한 시험 자료이며 실제 위험 판정을 제공하지 않습니다. 불러온 내용은 직접 확인한 뒤 문서를 저장하세요.</p><button type="button" data-ref-reload>같은 현장·척도 자료 조회</button><label>참고자료 선택<select data-ref-select><option value="">조회 후 선택하세요</option></select></label><button type="button" data-ref-append disabled>선택한 자료의 항목 추가</button>${worker?'':'<label>참고자료 이름<input data-ref-title maxlength="200"></label><button type="button" data-ref-save>현재 선택 항목을 참고자료로 저장</button> <button type="button" data-ref-delete disabled>선택한 참고자료 삭제</button>'}<p data-ref-status role="status"></p></fieldset>`;
  const get=name=>container.querySelector(`[data-ref-${name}]`),select=get('select'),status=get('status'),buttons=['reload','append',...(worker?[]:['save','delete'])].map(get),base=worker?'/api/worker/muscle-references':'/api/muscle-references';
  let currentScale=scale(),version=0,busy=false,rows=[],used=new Set();
  const available=()=>container.isConnected&&active()&&!container.closest('form')?.querySelector('button[type=submit]')?.disabled;
  const selected=()=>rows.find(row=>String(row.id)===select.value);
  const update=()=>{for(const button of buttons)button.disabled=busy;get('append').disabled=busy||!selected()||used.has(select.value);if(!worker)get('delete').disabled=busy||!selected();select.disabled=busy;};
  function clear(){rows=[];used.clear();select.innerHTML='<option value="">조회 후 선택하세요</option>';select.value='';update();}
  function refresh(){if(currentScale===scale())return;currentScale=scale();version++;clear();status.textContent='척도가 변경되었습니다. 참고자료를 다시 조회하세요.';}
  const query=value=>new URLSearchParams(worker?{scale:value}:{siteId:String(siteId),scale:value});
  async function perform(action){
    refresh();if(busy||!available())return;
    const snapshot=scale(),epoch=version,unchanged=()=>epoch===version&&snapshot===scale()&&available();busy=true;update();
    try{await action(snapshot,unchanged);}catch(error){if(unchanged())status.textContent=error.message;}finally{busy=false;refresh();update();}
  }
  async function load(snapshot,unchanged){
    const result=await request(`${base}?${query(snapshot)}`);if(!unchanged())return;
    if(!Array.isArray(result)||result.some(row=>!row||!Number.isSafeInteger(row.id)||row.id<1||typeof row.title!=='string'||row.scale!==snapshot))throw Error('참고자료 목록을 다시 확인해 주세요.');
    rows=result;used.clear();select.innerHTML='<option value="">선택하세요</option>'+rows.map(row=>`<option value="${row.id}">${esc(row.title)}</option>`).join('');select.value='';status.textContent=rows.length?`${rows.length}개의 사용자 작성 자료가 있습니다.`:'같은 현장·척도에 저장된 자료가 없습니다.';
  }
  select.onchange=update;
  get('reload').onclick=()=>perform(async(snapshot,unchanged)=>{clear();await load(snapshot,unchanged);});
  get('append').onclick=()=>{
    refresh();if(busy||!available()||get('append').disabled)return;
    try{const row=selected();if(!row||row.scale!==scale())return;const count=editor.append(row.items);used.add(select.value);update();status.textContent=`${count}개 항목을 추가했습니다. 확인 후 문서를 저장하세요.`;container.dispatchEvent(new Event('input',{bubbles:true}));}catch(error){status.textContent=error.message;}
  };
  if(!worker){
    get('save').onclick=()=>perform(async(snapshot,unchanged)=>{
      const title=get('title').value.trim(),items=copyMusculoskeletalItems(editor.read().filter(row=>row.selected===true),0,snapshot);
      if(!title||title.length>200)throw Error('참고자료 이름을 1~200자로 입력하세요.');if(!items.length)throw Error('저장할 근골격계 항목을 선택하세요.');
      await request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId,title,scale:snapshot,items})});if(!unchanged())return;
      clear();status.textContent='선택한 항목을 참고자료로 저장했습니다. 목록을 다시 조회해 주세요.';
    });
    get('delete').onclick=()=>perform(async(snapshot,unchanged)=>{
      const row=selected();if(!row||row.scale!==snapshot||!confirm('선택한 참고자료를 삭제할까요? 문서에 추가한 항목은 유지됩니다.'))return;
      await request(`${base}/${row.id}?${new URLSearchParams({siteId:String(siteId)})}`,{method:'DELETE'});if(!unchanged())return;
      clear();status.textContent='참고자료를 삭제했습니다. 문서에 입력한 항목은 유지됩니다. 목록을 다시 조회해 주세요.';
    });
  }
  return {refresh};
}
