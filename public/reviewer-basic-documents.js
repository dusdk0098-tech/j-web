const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=value=>Number.isSafeInteger(value)&&value>0;

export async function mountReviewerBasicDocuments({target,siteId,api,active}){
  if(!active()||!target.isConnected)return;
  target.innerHTML='<h2>직원 시험 기본 서류</h2><p>J웹의 독립 시험 기능입니다. 본인 소속 현장의 승인된 기본 서류와 공유 자료를 조회합니다.</p><button type="button" data-reload>다시 조회</button><p data-status role="status"></p><div data-list></div><section data-detail aria-label="기본 서류 상세"></section>';
  const list=target.querySelector('[data-list]'),detail=target.querySelector('[data-detail]'),status=target.querySelector('[data-status]');
  let listEpoch=0,detailEpoch=0;
  const live=()=>active()&&target.isConnected;
  const scope=row=>`${row.site_id===siteId?'본인 소속 현장':'다른 현장'} · ${row.shared?'공유 자료':'현장 자료'}`;
  const open=async(id,listing)=>{
    if(!live()||listing!==listEpoch)return;
    const generation=++detailEpoch;detail.textContent='';status.textContent='상세를 불러오는 중입니다.';
    const current=()=>live()&&listing===listEpoch&&generation===detailEpoch;
    try{
      const data=await api(`/api/reviewer/basic-documents/${id}`);if(!current())return;
      const row=data.document;if(row.id!==id)throw Error('요청한 서류를 확인하지 못했습니다.');
      detail.innerHTML=`<h3>${esc(row.title)}</h3><p>${esc(scope(row))} · ${esc(row.category||'미분류')} · ${esc(row.date)}</p><div class="detail-body">${esc(row.body)}</div><h4>첨부파일</h4>${data.attachments.length?`<ul>${data.attachments.filter(file=>validId(file.id)).map(file=>`<li><a href="/api/reviewer/basic-documents/${id}/attachments/${file.id}">${esc(file.name)}</a></li>`).join('')}</ul>`:'<p>첨부파일이 없습니다.</p>'}<button type="button" data-close>상세 닫기</button>`;
      detail.querySelector('[data-close]').onclick=()=>{if(!current())return;detailEpoch++;detail.textContent='';};
      detail.querySelectorAll('a').forEach(link=>link.onclick=event=>{if(!current())event.preventDefault();});
      status.textContent='';
    }catch(error){if(current())status.textContent=error.message;}
  };
  const load=async()=>{
    if(!live())return;
    const generation=++listEpoch;detailEpoch++;list.textContent='';detail.textContent='';status.textContent='서류를 불러오는 중입니다.';
    try{
      const data=await api('/api/reviewer/basic-documents');if(!live()||generation!==listEpoch)return;
      const rows=data.documents.filter(row=>validId(row.id));
      list.innerHTML=rows.length?`<ul>${rows.map(row=>`<li><button type="button" data-open="${row.id}">${esc(row.title)}</button><p>${esc(scope(row))} · ${esc(row.category||'미분류')} · ${esc(row.date)}</p></li>`).join('')}</ul>`:'<p>조회할 승인된 기본 서류가 없습니다.</p>';
      list.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>open(Number(button.dataset.open),generation));status.textContent='';
    }catch(error){if(live()&&generation===listEpoch)status.textContent=error.message;}
  };
  target.querySelector('[data-reload]').onclick=load;
  await load();
}
