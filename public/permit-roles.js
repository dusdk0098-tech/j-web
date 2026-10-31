export const permitRoleLabels=[['contractorLead','협력사 현장소장'],['coordinator','담당자'],['supervisor','관리감독자'],['safetyOfficer','안전관리자'],['siteManager','현장소장'],['inspector','감리']];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function permitRoleSnapshot(linked){
  if(linked?.type!=='permit'||!Array.isArray(linked.permitRoles))return '';
  return `<section><h3>요청 당시 역할별 시험 결재자</h3><p>J웹의 독립 시험 순서이며 같은 직원은 한 번만 결재합니다.</p><dl>${permitRoleLabels.map(([key,label])=>{const role=linked.permitRoles.find(item=>item.key===key);return `<dt>${label}</dt><dd>${esc(role?.reviewer_name||'지정 안 함')}</dd>`;}).join('')}</dl></section>`;
}
export async function mountPermitRoles({target,doc,api,active=()=>true,confirm=globalThis.confirm,onSaved=()=>{},onLockChange=()=>{},genericButton}){
  const editable=['draft','rejected'].includes(doc.status),details=JSON.parse(doc.details||'{}'),path=`/api/documents/${doc.id}/permit-roles`,current=()=>target.isConnected&&active();
  let epoch=0,busy=false,dirty=false,blocked=true,version,people=[];
  target.innerHTML='<h2>역할별 시험 결재자</h2><p>J웹의 독립 시험 규칙입니다. 아래 표시 순서대로 결재하며 같은 직원은 한 번만 결재합니다. 역할 저장은 기존 일반 시험 결재선을 대체합니다. 모두 비우면 시험 결재선도 비워집니다.</p><div data-permit-role-fields></div><button type="button" data-permit-role-reload>다시 조회</button><p data-permit-role-status role="status"></p>';
  const fields=target.querySelector('[data-permit-role-fields]'),status=target.querySelector('[data-permit-role-status]'),reload=target.querySelector('[data-permit-role-reload]');
  const controls=()=>fields.querySelectorAll('select,button');
  const lock=()=>{for(const control of controls())control.disabled=busy||blocked;reload.disabled=busy;if(genericButton)genericButton.disabled=busy||blocked||dirty;onLockChange(busy||blocked||dirty);};
  async function load(){
    if(!current()||busy)return;
    if(dirty&&!confirm('저장하지 않은 역할 선택을 버리고 다시 조회할까요?'))return;
    const request=++epoch;blocked=true;lock();status.textContent='역할별 시험 결재자를 조회하는 중입니다.';
    try{
      const [result,accounts]=await Promise.all([api(path),editable?api(`/api/reviewers?siteId=${doc.site_id}`):Promise.resolve([])]);
      if(!current()||epoch!==request)return;
      version=result.version;people=accounts.filter(person=>person.active&&Number(person.site_id)===Number(doc.site_id));dirty=false;blocked=false;
      if(genericButton){genericButton.hidden=Object.values(result.roles).some(Boolean);genericButton.disabled=false;}
      fields.innerHTML=permitRoleLabels.map(([key,label])=>{const id=result.roles[key],assigned=result.line.find(person=>Number(person.reviewer_id)===Number(id)),name=assigned?.name||assigned?.reviewer_name||'사용할 수 없는 직원';return editable?`<label>${label}<select data-permit-role="${key}"><option value="">지정 안 함</option>${id&&!people.some(person=>person.id===id)?`<option value="${Number(id)}" selected disabled>${esc(name)} · 재선택 필요</option>`:''}${people.map(person=>`<option value="${Number(person.id)}" ${person.id===id?'selected':''}>${esc(person.name)} · ${esc(person.login_id)}</option>`).join('')}</select></label>`:`<p><strong>${label}</strong> ${id?esc(name):'지정 안 함'}</p>`;}).join('')+(editable?'<p>역할 지정 시 현장소장은 필수이며 작업업체가 있으면 협력사 현장소장도 필요합니다.</p><button type="button" data-permit-role-save>역할과 시험 결재선 저장</button>':'<p>현재 상태에서는 역할을 변경할 수 없습니다.</p>');
      for(const select of fields.querySelectorAll('select'))select.onchange=()=>{if(!current()||busy)return;dirty=true;lock();};
      const save=fields.querySelector('[data-permit-role-save]');if(save)save.onclick=async()=>{
        if(!current()||busy||blocked)return;
        const roles=Object.fromEntries([...fields.querySelectorAll('select')].map(select=>[select.dataset.permitRole,select.value?Number(select.value):null]));
        if(Object.values(roles).some(Boolean)){
          if(!roles.siteManager){status.textContent='현장소장을 선택해 주세요.';return;}
          if(details.directWork!==true&&String(details.company||'').trim()&&!roles.contractorLead){status.textContent='협력사 현장소장을 선택해 주세요.';return;}
          if(Object.values(roles).filter(Boolean).some(id=>!people.some(person=>person.id===id))){status.textContent='사용할 수 없는 직원을 다시 선택해 주세요.';return;}
        }
        if(!confirm('역할 선택으로 기존 일반 시험 결재선을 대체합니다. 같은 직원은 한 번만 결재하며 모두 비우면 결재선이 삭제됩니다. 저장할까요?'))return;
        busy=true;lock();status.textContent='저장하는 중입니다.';
        try{await api(path,{method:'PUT',body:JSON.stringify({expectedVersion:version,roles})});if(!current()||epoch!==request)return;dirty=false;blocked=true;status.textContent='역할과 시험 결재선을 저장했습니다.';await onSaved();}
        catch(error){if(current()&&epoch===request){blocked=true;status.textContent=`${error.message} 선택한 내용은 유지했습니다. 다시 조회하여 현재 자료를 확인한 뒤 저장하세요.`;}}
        finally{busy=false;if(current()&&epoch===request)lock();}
      };
      status.textContent='';lock();
    }catch(error){if(current()&&epoch===request){status.textContent=error.message;lock();}}
  }
  reload.onclick=load;await load();
}
