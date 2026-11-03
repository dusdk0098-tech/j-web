import { instructionRecipientAudit } from './instruction-recipients.js';

export function mountInstructionRecipientAudit(host,{siteId,api,current,onOpen}){
  const doc=host.ownerDocument,section=doc.createElement('section'),title=doc.createElement('h3'),description=doc.createElement('p'),button=doc.createElement('button'),status=doc.createElement('p'),list=doc.createElement('ul');
  title.textContent='기존 지시서 담당자 확인';description.textContent='현재 현장의 전체 작업지시서를 현재 출입자·업체 정보와 비교합니다. 소속은 나중에 바뀔 수 있으므로 과거 지정이 잘못됐다고 확정하지 않습니다. 조회 중 정보가 바뀔 수 있으며 기록이나 접근 권한은 변경하지 않습니다.';
  button.type='button';button.textContent='확인 필요한 지시서 조회';status.setAttribute('role','status');section.append(title,description,button,status,list);host.append(section);
  let sequence=0;const active=()=>current()&&section.isConnected;
  button.onclick=async()=>{
    if(!active()||button.disabled)return;button.disabled=true;const request=++sequence;list.replaceChildren();status.textContent='조회 중입니다.';
    try{
      const query=new URLSearchParams({siteId:String(siteId)}),[documents,workers,companies]=await Promise.all([api(`/api/documents?${query}&type=instruction`,{},active),api(`/api/workers?${query}`,{},active),api(`/api/companies?${query}`,{},active)]);
      if(!active()||request!==sequence)return;const rows=instructionRecipientAudit(documents,workers,companies);list.replaceChildren();
      for(const row of rows){const li=doc.createElement('li'),link=doc.createElement('button'),detail=doc.createElement('span');link.type='button';link.className='link';link.textContent=row.title;link.onclick=()=>{if(active())onOpen(row.id);};detail.textContent=` · ${row.date} · ${row.reason} · 기록된 업체: ${row.company||'미기록'} · 기록된 담당자: ${row.recipient||'미기록'}`;li.append(link,detail);list.append(li);}
      status.textContent=rows.length?`현재 정보와 비교해 확인할 문서 ${rows.length}건입니다.`:'현재 정보와 비교해 확인할 문서가 없습니다.';
    }catch(error){if(active()&&request===sequence)status.textContent=error.message;}finally{if(active()&&request===sequence)button.disabled=false;}
  };
}
