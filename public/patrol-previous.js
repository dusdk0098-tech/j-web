import {patrolActivityRow,patrolItemRow,readPatrolActivities,readPatrolItems} from './patrol-activities.js';

export function mountPatrolPrevious({button,list,date,activities,items,fields,siteId,docId,submit,current,api,esc,confirm}){
  let generation=0;
  const invalidate=()=>{generation++;list.replaceChildren();};
  const inputSnapshot=()=>JSON.stringify({fields:Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value])),activities:readPatrolActivities(activities),items:readPatrolItems(items)});
  button.onclick=async()=>{
    if(!current())return;const selectedDate=date.value,request=++generation,active=()=>current()&&list.isConnected&&request===generation&&date.value===selectedDate;
    list.textContent='이전 순회 기록을 조회하고 있습니다.';
    try{
      const params=new URLSearchParams({siteId:String(siteId),type:'patrol',to:selectedDate}),rows=await api(`/api/documents?${params}`,{},active);if(!active())return;
      const sources=rows.filter(row=>row.type==='patrol'&&row.site_id===siteId&&row.id!==docId&&row.date<=selectedDate&&Number.isSafeInteger(row.edit_version));
      list.innerHTML=sources.length?sources.map((row,index)=>`<p>${esc(row.date)} · ${esc(row.title)} <button type="button" data-patrol-previous="${index}">이 기록 불러오기</button></p>`).join(''):'<p>이전 순회 기록이 없습니다.</p>';
      list.querySelectorAll('[data-patrol-previous]').forEach(choice=>choice.onclick=async()=>{
        if(!active()||submit.disabled||choice.disabled)return;const source=sources[Number(choice.dataset.patrolPrevious)];if(!source)return;
        const before=inputSnapshot();if(!confirm('현재 점검자·활동·점검 항목과 기타 내용을 선택한 기록으로 바꿀까요? 날짜·제목·첨부·서명은 바꾸지 않습니다.'))return;
        if(!active()||submit.disabled||inputSnapshot()!==before)return;choice.disabled=true;
        try{
          const fresh=await api(`/api/documents/${source.id}`,{},active);if(!active())return;
          if(submit.disabled||inputSnapshot()!==before)throw Error('입력이 변경되어 적용하지 않았습니다. 다시 확인해 주세요.');
          if(!fresh||fresh.id!==source.id||fresh.site_id!==siteId||fresh.type!=='patrol'||fresh.date>selectedDate||fresh.edit_version!==source.edit_version)throw Error('이전 기록이 변경되었습니다. 목록을 다시 조회해 주세요.');
          const data=JSON.parse(fresh.details||'{}');if(!Array.isArray(data.items)||data.items.length>100||data.patrolActivities!==undefined&&(!Array.isArray(data.patrolActivities)||data.patrolActivities.length>100))throw Error('이전 순회 기록을 확인해 주세요.');
          const itemMarkup=data.items.map(row=>patrolItemRow(row,esc)).join(''),activityMarkup=(data.patrolActivities||[]).map(row=>patrolActivityRow(row,esc)).join('');
          for(const [key,input] of Object.entries(fields))input.value=typeof data[key]==='string'?data[key]:'';
          items.innerHTML=itemMarkup;activities.innerHTML=activityMarkup;list.textContent='이전 기록을 불러왔습니다. 점검 결과와 활동을 다시 확인해 주세요.';
        }catch(error){if(active())list.textContent=error.message;}finally{choice.disabled=false;}
      });
    }catch(error){if(active())list.textContent=error.message;}
  };
  return invalidate;
}
