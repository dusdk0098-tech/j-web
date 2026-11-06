const labels={attendance:'출역',meals:'식대',selfChecks:'자가점검',dailyTraining:'당일 교육·회의',notices:'공지 확인',noticeHistory:'이전 공지 확인',education:'문서별 교육 확인'};

export function newTransferId(random=crypto){
  const bytes=random.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function mountWorkerTransfer({panel,rows,siteId,date,esc,api,signaturePad,current,onComplete,onRefresh}){
  const options=rows.map(row=>`<option value="${row.id}">${esc(row.name)} · ${esc(row.birth_date||'생년 미기록')} · ${esc(row.company||'소속 미기록')}</option>`).join('');
  panel.innerHTML=`<h2>출역정보 전환</h2><p>같은 사람의 중복 가입으로 나뉜 기록만 합칩니다. ${esc(date)}의 출역·식대·공지 확인·교육 확인·자가점검을 옮깁니다. 급여대장, 보호구 및 다른 날짜의 기록은 바뀌지 않습니다.</p><p>기존 기록의 작성자는 그대로 표시됩니다. 대상자가 내용을 확인하고 가상 서명해야 합니다.</p><div class="fields"><label>기존 기록자 <select data-source><option value="">선택</option>${options}</select></label><label>대상 출입자 <select data-target><option value="">선택</option>${options}</select></label><button type="button" data-preview>전환 영향 확인</button></div><p data-result role="status" aria-live="polite"></p><div data-sign hidden><p data-sign-title></p><canvas class="signature-pad" width="320" height="120" aria-label="대상 출입자 시험 서명"></canvas><button type="button" data-clear>서명 지우기</button><button type="button" data-submit>전환 실행</button><button type="button" data-refresh hidden>입력 지우고 다시 조회</button></div>`;
  const source=panel.querySelector('[data-source]'),target=panel.querySelector('[data-target]'),previewButton=panel.querySelector('[data-preview]'),result=panel.querySelector('[data-result]'),sign=panel.querySelector('[data-sign]'),submit=panel.querySelector('[data-submit]'),clear=panel.querySelector('[data-clear]'),refresh=panel.querySelector('[data-refresh]'),canvas=panel.querySelector('canvas'),title=panel.querySelector('[data-sign-title]');
  const signature=signaturePad(canvas,clear),active=()=>panel.isConnected&&current();let generation=0,preview=null,pending=null,busy=false;
  const reset=()=>{generation++;preview=null;sign.hidden=true;result.textContent='';clear.click();};
  source.onchange=target.onchange=()=>{if(!pending)reset();};
  previewButton.onclick=async()=>{
    if(!active()||busy||pending)return;reset();const sourceId=Number(source.value),targetId=Number(target.value);
    if(!sourceId||!targetId||sourceId===targetId){result.textContent='같은 현장의 서로 다른 두 출입자를 선택해 주세요.';return;}
    const request=++generation;busy=true;previewButton.disabled=true;result.textContent='전환 영향을 확인하고 있습니다.';
    try{const data=await api('/api/attendance/transfers/preview',{method:'POST',body:JSON.stringify({siteId,sourceId,targetId,date})},active);if(!active()||request!==generation)return;
      const counts=Object.entries(labels).map(([key,label])=>`${label} ${data.counts[key]||0}건`).join(' · '),conflicts=data.conflicts.map(key=>labels[key]||key);
      result.textContent=counts+(conflicts.length?` · 대상자와 중복: ${conflicts.join(', ')}. 전환할 수 없습니다.`:data.counts.attendance!==1?' · 기존 기록자의 출역이 없어 전환할 수 없습니다.':'');
      if(!conflicts.length&&data.counts.attendance===1){preview=data;title.textContent=`${target.selectedOptions[0].textContent} 대상자의 시험 서명`;sign.hidden=false;}
    }catch(error){if(active()&&request===generation)result.textContent=error.message;}finally{busy=false;if(active())previewButton.disabled=false;}
  };
  refresh.onclick=()=>{if(active()&&!busy)onRefresh();};
  submit.onclick=async()=>{
    if(!active()||busy||(!preview&&!pending))return;
    try{if(!pending)pending={siteId,sourceId:preview.sourceId,targetId:preview.targetId,date,version:preview.version,requestId:newTransferId(),signature:signature()};}
    catch(error){result.textContent=error.message;return;}
    busy=true;source.disabled=target.disabled=previewButton.disabled=clear.disabled=submit.disabled=true;canvas.style.pointerEvents='none';result.textContent='전환을 처리하고 있습니다.';
    try{const saved=await api('/api/attendance/transfers',{method:'POST',body:JSON.stringify(pending)},active);if(active())await onComplete(saved);}
    catch(error){if(active()){result.textContent=`${error.message} · 결과가 불확실하면 같은 요청으로 다시 시도하세요. 입력과 서명은 보존됩니다.`;submit.textContent='같은 요청 다시 시도';refresh.hidden=false;}}
    finally{busy=false;if(active())submit.disabled=false;}
  };
}

export function mountWorkerTransferHistory({panel,siteId,date,api,current}){
  panel.innerHTML='<h2>출역정보 전환 이력</h2><p>선택한 출역 날짜의 기록입니다. 원래 서명과 기록 내용은 전환 당시의 자료입니다.</p><button type="button" data-reload>이력 새로고침</button><p role="status" data-status></p><div data-list></div><div data-detail></div>';
  const status=panel.querySelector('[data-status]'),list=panel.querySelector('[data-list]'),detail=panel.querySelector('[data-detail]'),reload=panel.querySelector('[data-reload]'),active=()=>panel.isConnected&&current();let generation=0;
  const load=async()=>{const request=++generation;status.textContent='이력을 불러오는 중입니다.';list.replaceChildren();detail.replaceChildren();
    try{const rows=await api(`/api/attendance/transfers?${new URLSearchParams({siteId:String(siteId),date})}`,{},active);if(!active()||request!==generation)return;
      status.textContent=rows.length?`${rows.length}건`: '해당 날짜의 전환 이력이 없습니다.';
      for(const row of rows){const line=document.createElement('p'),button=document.createElement('button');line.textContent=`${row.created_at} (UTC) · ${row.source_name} → ${row.target_name} · 처리: ${row.actor_name} `;button.type='button';button.textContent=`기록 ${row.id} 상세`;
        button.onclick=async()=>{const selected=++generation;detail.textContent='상세를 불러오는 중입니다.';try{const audit=await api(`/api/attendance/transfers/${row.id}?${new URLSearchParams({siteId:String(siteId)})}`,{},active);if(!active()||selected!==generation)return;detail.replaceChildren();const heading=document.createElement('h3');heading.textContent=`기록 ${audit.id} · ${audit.source_name} → ${audit.target_name}`;const consent=document.createElement('a');consent.href=`/api/attendance/transfers/${audit.id}/signature?${new URLSearchParams({siteId:String(siteId)})}`;consent.textContent='대상자 전환 시험 서명 다운로드';detail.append(heading,consent);for(const record of audit.records){const section=document.createElement('section'),title=document.createElement('h4'),info=document.createElement('p'),body=document.createElement('pre');title.textContent=labels[record.kind]||record.kind;info.textContent=`전환 전 기록자: ${record.original_name} · 서명 ${record.has_signature?'보존됨':'없음'}`;body.textContent=JSON.stringify(record.record,null,2);section.append(title,info,body);if(record.has_signature){const link=document.createElement('a');link.href=`/api/attendance/transfers/${audit.id}/signature?${new URLSearchParams({siteId:String(siteId),kind:record.kind,key:record.record_key})}`;link.textContent='전환 전 시험 서명 다운로드';section.append(link);}detail.append(section);}}catch(error){if(active()&&selected===generation)detail.textContent=error.message;}};
        line.append(button);list.append(line);}
    }catch(error){if(active()&&request===generation)status.textContent=error.message;}
  };
  reload.onclick=load;void load();
}
