const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function mountReviewerMeetings({target,api,active,pad}){
  target.innerHTML='<h2>지정된 회의</h2><p>승인된 회의의 시험 확인이며 실제 참석이나 본인 확인을 증명하지 않습니다.</p><button type="button" data-reload>다시 조회</button><p data-status role="status"></p><div data-list></div><section data-detail></section>';
  const list=target.querySelector('[data-list]'),detail=target.querySelector('[data-detail]'),status=target.querySelector('[data-status]');let epoch=0;
  const live=()=>active()&&target.isConnected;
  const load=async()=>{if(!live())return;const generation=++epoch;list.textContent='';detail.textContent='';status.textContent='불러오는 중입니다.';try{
    const rows=await api('/api/reviewer/meetings');if(!live()||generation!==epoch)return;
    list.innerHTML=rows.length?rows.map(row=>`<p><button type="button" data-open="${row.id}">${esc(row.title)}</button> · ${esc(row.date)}</p>`).join(''):'<p>지정된 승인 회의가 없습니다.</p>';status.textContent='';
    list.querySelectorAll('[data-open]').forEach(button=>button.onclick=async()=>{if(!live())return;const request=++epoch,id=Number(button.dataset.open);detail.textContent='';status.textContent='불러오는 중입니다.';try{
      const data=await api(`/api/reviewer/meetings/${id}`);if(!live()||request!==epoch)return;const doc=data.document,fields=JSON.parse(doc.details||'{}');if(doc.id!==id)throw Error('회의 자료를 다시 확인해 주세요.');
      detail.innerHTML=`<h3>${esc(doc.title)}</h3><p>${esc(doc.date)} · ${esc(fields.timeFrom||'미입력')} ~ ${esc(fields.timeTo||'미입력')} · ${esc(fields.place||'미입력')}</p><div class="detail-body">${esc(doc.body)}</div>${['host','decisions','discussion','remarks'].map(key=>fields[key]?`<p>${esc(({host:'주관',decisions:'심의·의결',discussion:'협의',remarks:'비고'})[key])}: ${esc(fields[key])}</p>`:'').join('')}${data.attachments.map(file=>`<p><a href="/api/reviewer/meetings/${id}/attachments/${file.id}">${esc(file.name)}</a></p>`).join('')}${doc.confirmed_at?`<p>시험 참가 확인 완료</p>${data.signature?`<img class="signature-pad" alt="저장된 시험 서명" src="data:image/png;base64,${esc(data.signature)}">`:''}`:'<canvas data-signature width="320" height="120" class="signature-pad" aria-label="회의 시험 서명 입력 영역"></canvas><button type="button" data-clear>서명 지우기</button> <button type="button" data-confirm>시험 참가 확인</button><p data-confirm-status role="status"></p>'}`;
      detail.querySelectorAll('a').forEach(link=>link.onclick=event=>{if(!live()||request!==epoch)event.preventDefault();});status.textContent='';
      if(!doc.confirmed_at){const confirm=detail.querySelector('[data-confirm]'),feedback=detail.querySelector('[data-confirm-status]'),signature=pad(detail.querySelector('[data-signature]'),detail.querySelector('[data-clear]'));confirm.onclick=async()=>{if(!live()||request!==epoch||confirm.disabled)return;confirm.disabled=true;try{await api(`/api/reviewer/meetings/${id}/confirmation`,{method:'POST',body:JSON.stringify({expectedEditVersion:doc.edit_version,signature:signature()})});if(live()&&request===epoch)feedback.textContent='시험 참가 확인을 저장했습니다.';}catch(error){if(live()&&request===epoch){feedback.textContent=error.message;confirm.disabled=false;}}};}
    }catch(error){if(live()&&request===epoch)status.textContent=error.message;}});
  }catch(error){if(live()&&generation===epoch)status.textContent=error.message;}};
  target.querySelector('[data-reload]').onclick=load;await load();
}
