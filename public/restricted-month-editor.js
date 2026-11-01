const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function monthDates(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1)throw Error('올바른 조회 월을 선택해 주세요.');
  const end=new Date(month+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  return Array.from({length:end.getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
}

export function mountRestrictedMonthEditor({root,rows,month,siteId,api,current,onRows=()=>{}}){
  let busy=false,uncertain=false;
  const dates=monthDates(month),cells=()=>[...root.querySelectorAll('[data-month-cell]')];
  const values=cell=>({present:cell.querySelector('input[type=checkbox]').checked,units:cell.querySelector('input[type=number]').value});
  const changed=cell=>{const value=values(cell);return value.present!==(cell.dataset.present==='true')||(value.present&&value.units!==cell.dataset.units);};
  const status=()=>root.querySelector('[data-month-status]');
  function draw(){
    root.innerHTML=`<p>출역 여부와 공수를 수정한 뒤 변경 전체 저장을 누르세요. 빈 공수는 미입력입니다. 미출역으로 저장하면 해당 날짜를 미출역으로 변경합니다.</p><div class="table-wrap" tabindex="0" role="region" aria-label="월별 출역 편집표"><table><caption>${esc(month)} 근로자별 출역·공수</caption><thead><tr><th scope="col">근로자</th>${dates.map(date=>`<th scope="col">${date.slice(-2)}일</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(row.name)}</th>${dates.map(date=>{const present=row.days.includes(date),record=row.units.find(r=>r.date===date),units=record?.units_hundredths==null?'':String(record.units_hundredths/100),label=esc(`${row.name} ${date}`);return `<td data-month-cell data-worker="${row.id}" data-date="${date}" data-present="${present}" data-units="${units}"><label><input type="checkbox" aria-label="${label} 출역" ${present?'checked':''}>출역</label><input type="number" aria-label="${label} 공수" min="0" max="9.99" step="0.01" value="${units}" ${present?'':'disabled'} style="width:5.5rem"></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><button type="button" data-month-save>변경 전체 저장</button><p role="status" data-month-status>변경한 내용이 없습니다.</p>`;
    for(const cell of cells()){
      const presence=cell.querySelector('input[type=checkbox]'),units=cell.querySelector('input[type=number]');
      presence.onchange=()=>{units.disabled=!presence.checked;status().textContent='미저장 변경이 있습니다.';};
      units.oninput=()=>{status().textContent='미저장 변경이 있습니다.';};
    }
    root.querySelector('[data-month-save]').onclick=save;
  }
  async function save(){
    if(busy||uncertain||!current())return;
    const edits=cells().filter(changed);
    if(!edits.length){status().textContent='변경한 내용이 없습니다.';return;}
    if(edits.length>1000){status().textContent='한 번에 1000개 날짜 셀까지 저장할 수 있습니다.';return;}
    const changes=[];
    for(const cell of edits){
      const value=values(cell),row=rows.find(row=>row.id===Number(cell.dataset.worker));
      if(value.present&&(cell.querySelector('input[type=number]').validity?.valid===false||(value.units!==''&&!/^[0-9](?:\.\d{1,2})?$/.test(value.units)))){status().textContent='공수는 0~9.99 범위에서 소수 둘째 자리까지 입력하세요.';return;}
      changes.push({workerId:row.id,date:cell.dataset.date,...(value.present?value:{present:false}),expectedDayVersion:row.dayVersions[cell.dataset.date]??0,expectedVersion:row.version});
    }
    busy=true;for(const input of root.querySelectorAll('input,button'))input.disabled=true;
    status().textContent='저장 중입니다.';
    try{
      await api('/api/attendance/month/cells',{method:'PUT',body:JSON.stringify({siteId,month,changes})},current);
      if(!current())return;
      uncertain=true;
      const latest=await api(`/api/attendance/month?siteId=${siteId}&month=${month}`,{},current);
      if(!current())return;
      rows=latest;onRows(latest);uncertain=false;draw();status().textContent='변경 전체를 저장했습니다.';
    }catch(error){if(current())status().textContent=uncertain?`저장은 완료됐지만 재조회하지 못했습니다. 입력을 보존했습니다. 조회·새로고침으로 확인하세요. ${error.message}`:`저장하지 못했습니다. 입력을 보존했습니다. 충돌이면 입력 내용을 별도로 복사한 뒤 새로고침하세요. ${error.message}`;}
    finally{busy=false;if(current()&&!uncertain){root.querySelector('[data-month-save]').disabled=false;for(const cell of cells()){cell.querySelector('input[type=checkbox]').disabled=false;cell.querySelector('input[type=number]').disabled=!values(cell).present;}}}
  }
  draw();
  return {dirty:()=>cells().some(changed),busy:()=>busy};
}
