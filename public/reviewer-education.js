import {educationKinds} from './education-kinds.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function mountReviewerEducation({target,api,active}){
  target.innerHTML='<h2>관리자 교육 자료</h2><p>J웹의 독립 조회 기능입니다. 본인이 지정된 승인 교육만 표시합니다. 자료 열람은 참가 확인이나 서명을 생성하지 않습니다.</p><button type="button" data-reload>다시 조회</button><p data-status role="status"></p><div data-list></div><section data-detail></section>';
  const list=target.querySelector('[data-list]'),detail=target.querySelector('[data-detail]'),status=target.querySelector('[data-status]');
  let epoch=0;
  const live=()=>active()&&target.isConnected;
  const load=async()=>{
    if(!live())return;const generation=++epoch;list.textContent='';detail.textContent='';status.textContent='불러오는 중입니다.';
    try{
      const rows=await api('/api/reviewer/education');if(!live()||generation!==epoch)return;
      list.innerHTML=rows.length?rows.map(row=>`<p><button type="button" data-open="${row.id}">${esc(row.title)}</button> · ${esc(row.date)}</p>`).join(''):'<p>지정된 승인 교육이 없습니다.</p>';status.textContent='';
      list.querySelectorAll('[data-open]').forEach(button=>button.onclick=async()=>{
        if(!live())return;const request=++epoch;detail.textContent='';status.textContent='불러오는 중입니다.';
        try{
          const id=Number(button.dataset.open),data=await api(`/api/reviewer/education/${id}`);if(!live()||request!==epoch)return;
          const doc=data.document,fields=JSON.parse(doc.details||'{}');
          if(doc.id!==id)throw Error('교육 자료를 다시 확인해 주세요.');
          detail.innerHTML=`<h3>${esc(doc.title)}</h3><p>${esc(doc.date)} · ${esc(educationKinds[fields.kind]||'교육')}</p><p>${esc(fields.timeFrom)} ~ ${esc(fields.timeTo)} · ${esc(fields.educationPlace)} · ${esc(fields.instructor)}</p><div class="detail-body">${esc(doc.body)}</div>${data.attachments.map(file=>`<p><a href="/api/reviewer/education/${id}/attachments/${file.id}">${esc(file.name)}</a></p>`).join('')}`;
          detail.querySelectorAll('a').forEach(link=>link.onclick=event=>{if(!live()||request!==epoch)event.preventDefault();});status.textContent='';
        }catch(error){if(live()&&request===epoch)status.textContent=error.message;}
      });
    }catch(error){if(live()&&generation===epoch)status.textContent=error.message;}
  };
  target.querySelector('[data-reload]').onclick=load;await load();
}
