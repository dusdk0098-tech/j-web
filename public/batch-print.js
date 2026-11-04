import { workerPreviewArticles } from './worker-preview.js';
import { managerCheckQuestions } from './reviewer-manager-check.js';

const joinedOnDay=(value,date)=>{if(typeof value!=='string')return false;const iso=value.replace(' ','T'),time=Date.parse(iso+(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)?'':'Z'));return Number.isFinite(time)&&new Date(time+9*60*60*1000).toISOString().slice(0,10)===date;};

export function hazardReportBody(report,siteId,esc){
  if(!Number.isSafeInteger(Number(siteId))||Number(siteId)<1||!Number.isSafeInteger(Number(report?.id))||Number(report.id)<1||!Array.isArray(report.replies))throw Error('의견·위험신고를 다시 확인해 주세요.');
  const statuses={received:'접수',reviewing:'검토 중',resolved:'조치 완료'},status=Object.hasOwn(statuses,report.status)?statuses[report.status]:'상태 미확인',photo=`/api/sites/${Number(siteId)}/hazard-reports/${Number(report.id)}/photo`;
  return `<p>${esc(report.reporter)} · ${esc(report.created_at)} (UTC) · ${esc(status)}</p><p class="detail-body">${esc(report.body)}</p><p class="detail-body">가상 조치 내용: ${esc(report.response||'없음')}</p><h3>시험 처리 이력</h3>${report.history?.length?report.history.map(event=>`<p>${esc(event.created_at)} (UTC) · ${esc(statuses[event.previous_status]||'상태 미확인')} → ${esc(statuses[event.status]||'상태 미확인')} · 조치: ${esc(event.response||'없음')}</p>`).join(''):'<p>기록된 변경 이력이 없습니다. 이전 변경 내용은 확인할 수 없습니다.</p>'}<h3>가상 답변</h3>${report.replies.length?report.replies.map(reply=>`<p class="detail-body">${esc(reply.created_at)} (UTC) · ${esc(reply.body)}</p>`).join(''):'<p>답변 없음</p>'}${report.has_photo?`<figure><img class="worker-hazard-photo" src="${esc(photo)}?preview=1" alt="가상 신고 사진"><figcaption><a href="${esc(photo)}">시험 사진 다운로드</a></figcaption></figure>`:''}`;
}

export async function joinedBatchPreview(report,api) {
  const rows=await api(`/api/workers/joined-on?${new URLSearchParams({siteId:String(report.site.id),date:report.date})}`);
  const worker=rows.find(row=>row.id===report.worker.id&&row.site_id===report.site.id&&row.version===report.worker.version&&row.joined_at===report.worker.joined_at&&joinedOnDay(row.joined_at,report.date));
  if(!worker)throw Error('가입 기록 또는 현장이 변경되었습니다. 다시 조회해 주세요.');
  const result=await api('/api/workers/preview',{method:'POST',body:JSON.stringify({siteId:report.site.id,items:[{id:worker.id,version:worker.version}]})});
  if(result.workers?.length!==1||result.workers[0].id!==worker.id||result.workers[0].site_id!==report.site.id||result.workers[0].join?.created_at!==worker.joined_at)throw Error('가입 기록이 변경되었습니다. 다시 조회해 주세요.');
  return result;
}

export function selectBatchDocuments(documents,selectedIds) {
  if(!Array.isArray(documents)||!Array.isArray(selectedIds)||selectedIds.length===0)throw new Error('미리 볼 문서를 선택해 주세요.');
  if(selectedIds.length>20)throw new Error('한 번에 문서 20개까지 선택할 수 있습니다.');
  const available=new Set(documents.map(document=>document.id)),ids=selectedIds.map(Number);
  if(ids.some(id=>!Number.isSafeInteger(id)||!available.has(id))||new Set(ids).size!==ids.length)throw new Error('선택한 문서를 다시 확인해 주세요.');
  return ids;
}

export function selectBatchItems(documents,reports,documentIds,reportIds) {
  if(!Array.isArray(documentIds)||!Array.isArray(reportIds)||documentIds.length+reportIds.length===0)throw new Error('미리 볼 문서를 선택해 주세요.');
  if(documentIds.length+reportIds.length>20)throw new Error('한 번에 문서 20개까지 선택할 수 있습니다.');
  return {documents:documentIds.length?selectBatchDocuments(documents,documentIds):[],reports:reportIds.length?selectBatchDocuments(reports,reportIds):[]};
}

export async function siteDocumentsForDay(sites,date,api) {
  if(!Array.isArray(sites)||!sites.length||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('현장과 날짜를 선택해 주세요.');
  const results=await Promise.all(sites.map(async site=>({site,documents:await api(`/api/documents?${new URLSearchParams({siteId:String(site.id),from:date,to:date})}`)})));
  return results.flatMap(({site,documents})=>documents.filter(doc=>doc.site_id===site.id&&doc.date===date&&doc.type!=='office').map(doc=>({...doc,site_name:site.name})));
}

export async function reloadDailyBatchRows(report,api) {
  const {kind,site,date}=report;
  if(kind==='attendance')return (await api(`/api/attendance?${new URLSearchParams({siteId:String(site.id),date})}`)).filter(row=>row.present);
  if(kind==='self-check'){const row=report.rows[0];return (await api(`/api/sites/${site.id}/print-self-checks?${new URLSearchParams({date})}`)).filter(item=>item.role===row.role&&item.id===row.id);}
  if(kind==='hazard-report'){const row=report.rows[0];return (await api(`/api/sites/${site.id}/hazard-reports?${new URLSearchParams({from:date,to:date})}`)).filter(item=>item.id===row.id&&item.date===date);}
  if(!['ppe-summary','ppe-detail'].includes(kind))throw Error('출력할 보고서 종류를 확인해 주세요.');
  const rows=(await api(`/api/ppe-issues?${new URLSearchParams({siteId:String(site.id),month:date.slice(0,7)})}`)).rows.filter(row=>row.date===date);
  if(kind==='ppe-detail')return rows;
  const totals=new Map();for(const row of rows)totals.set(row.item,(totals.get(row.item)||0)+row.quantity);
  return [...totals].map(([item,quantity])=>({item,quantity}));
}

export async function siteReportsForDay(sites,date,api) {
  if(!Array.isArray(sites)||!sites.length||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('현장과 날짜를 선택해 주세요.');
  const result=await Promise.all(sites.map(async site=>{
    const [ppe,attendance,joined,checks,hazards]=await Promise.all([api(`/api/ppe-issues?${new URLSearchParams({siteId:String(site.id),month:date.slice(0,7)})}`),api(`/api/attendance?${new URLSearchParams({siteId:String(site.id),date})}`),api(`/api/workers/joined-on?${new URLSearchParams({siteId:String(site.id),date})}`),api(`/api/sites/${site.id}/print-self-checks?${new URLSearchParams({date})}`),api(`/api/sites/${site.id}/hazard-reports?${new URLSearchParams({from:date,to:date})}`)]);
    const rows=ppe.rows.filter(row=>row.date===date),totals=new Map();
    for(const row of rows)totals.set(row.item,(totals.get(row.item)||0)+row.quantity);
    const labels={manager:'관리자',reviewer:'직원',worker:'출입자'};
    return [{kind:'ppe-summary',title:'보호구 당일 요약',rows:[...totals].map(([item,quantity])=>({item,quantity}))},{kind:'ppe-detail',title:'보호구 당일 상세',rows},{kind:'attendance',title:'출역일보',rows:attendance.filter(row=>row.present)},...joined.filter(worker=>worker.site_id===site.id&&joinedOnDay(worker.joined_at,date)).map(worker=>({kind:'joined-worker',title:`신규 가입 서류 · ${worker.name}`,worker})),...checks.map(row=>({kind:'self-check',title:`${labels[row.role]||'구분 미기록'} 자가점검 · ${row.name}`,rows:[row]})),...hazards.filter(row=>row.date===date).map(row=>({kind:'hazard-report',title:`의견·위험신고 · ${row.title}`,rows:[row]}))].map(report=>({...report,site,date}));
  }));
  return result.flat().map((report,index)=>({...report,id:index+1}));
}

export function dailyBatchReport(report,esc) {
  const table=(heads,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(head=>`<th>${esc(head)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>해당 날짜의 기록이 없습니다.</p>';
  let body;
  if(report.kind==='joined-worker')body=`<p>가입기록 일자: ${esc(report.date)} (한국시간 UTC+09:00). 등록일과 다르며 현재 인적사항·보호구·이미지 첨부를 표시합니다. PDF 등 다른 첨부는 별도로 확인하세요.</p>`+workerPreviewArticles(report.preview.workers,{includeImages:true});
  else if(report.kind==='hazard-report')body=hazardReportBody(report.rows[0],report.site.id,esc);
  else if(report.kind==='ppe-summary')body=table(['보호구','수량'],report.rows.map(row=>[row.item,row.quantity]));
  else if(report.kind==='ppe-detail')body=table(['이름','구분','소속','직종','보호구','수량','시험 수령 확인'],report.rows.map(row=>[row.worker.name,row.worker.category,row.worker.company,row.worker.occupation,row.item,row.quantity,row.receipt_at?'시험 확인 기록 있음':'미확인']));
  else if(report.kind==='attendance'){
    const recorded=report.rows.filter(row=>row.units_hundredths!=null);
    body=`<p>출역 ${report.rows.length}명 · 기록된 공수 ${recorded.length?(recorded.reduce((sum,row)=>sum+row.units_hundredths,0)/100).toFixed(2):'미기록'} · 공수 미기록 ${report.rows.length-recorded.length}명</p><p>이름은 현재 정보이며 구분·소속·직종은 출역 당시 기록입니다.</p>`+table(['이름','구분','소속','직종','공수'],report.rows.map(row=>[row.name,row.attendance_category??'기록 없음',row.attendance_company??'기록 없음',row.attendance_occupation??'기록 없음',row.units_hundredths==null?'미기록':(row.units_hundredths/100).toFixed(2)]));
  }else if(report.kind==='self-check'){
    const row=report.rows[0],workerQuestions={equipment:'안전장구 확인',sober:'음주하지 않음',exercise:'안전체조 확인',briefing:'주의사항 안내 확인'};
    if(!row||!['manager','reviewer','worker'].includes(row.role))throw Error('자가점검 기록을 다시 확인해 주세요.');
    const answers=row.role==='worker'?row.answers?Object.entries(workerQuestions).map(([key,label])=>`<li>${esc(label)}: ${row.answers[key]===true?'확인':row.answers[key]===false?'미확인':'미기록'}</li>`).join(''):'':Array.isArray(row.answers)?managerCheckQuestions.map((question,i)=>`<li>${esc(question)} ${esc(row.answers[i]?.answer||'미기록')}${row.answers[i]?.note?' · '+esc(row.answers[i].note):''}</li>`).join(''):'';
    const path=row.role==='manager'?`/api/sites/${report.site.id}/manager-checks/signature`:row.role==='reviewer'?`/api/sites/${report.site.id}/reviewer-manager-checks/${row.id}/signature`:`/api/sites/${report.site.id}/self-checks/${row.id}/signature`;
    body=`<p>${esc(row.name)} · ${row.role==='manager'?'관리자 계정 미기록':row.role==='reviewer'?'직원':esc(row.category||'구분 미기록')+' · '+esc(row.company||'소속 미기록')}</p><p>기록 시각: ${esc(row.created_at||'미기록')} (UTC)${row.role==='worker'?' · 구분과 소속은 현재 정보입니다.':''}</p>`+(answers?`<ul>${answers}</ul>`:'<p>답변 미기록</p>')+(row.has_signature?`<p>시험 서명</p><img class="signature-pad" src="${esc(path+'?'+new URLSearchParams({date:report.date,...(row.role==='worker'?{preview:'1'}:{})}))}" alt="시험 자가점검 서명">`:'<p>시험 서명 없음</p>');
  }else throw Error('출력할 보고서 종류를 확인해 주세요.');
  return `<h2>가상 ${esc(report.title)}</h2><p>현장: ${esc(report.site.name)} · 조회일: ${esc(report.date)}</p><p>조회 당시의 시험 자료이며 실제 출역·지급·수령을 증명하지 않습니다.</p>${body}`;
}

export function mountSiteBatchResults({content,target,sites,state,api,current,esc,preview,onError}) {
  const find=id=>content.querySelector(id),chosen=()=>[...content.querySelectorAll('[data-print-site]:checked')].map(input=>Number(input.dataset.printSite));
  let generation=0;
  const clear=()=>{generation++;target.replaceChildren();find('#site-print-search').disabled=false;};
  content.querySelectorAll('[data-print-site]').forEach(input=>{input.onchange=clear;});find('#site-print-date').onchange=clear;
  find('#site-print-all').onclick=()=>{content.querySelectorAll('[data-print-site]').forEach(input=>{input.checked=true;});clear();};
  find('#site-print-search').onclick=async()=>{
    const request=++generation,ids=chosen(),day=find('#site-print-date').value,requested=sites.filter(site=>ids.includes(site.id)),button=find('#site-print-search');
    const active=()=>current()&&target.isConnected&&request===generation&&find('#site-print-date').value===day&&chosen().join(',')===ids.join(',');
    try{
      button.disabled=true;target.textContent='문서와 보고서를 조회하는 중입니다.';
      const scopedApi=path=>api(path,{},active),[docs,reports]=await Promise.all([siteDocumentsForDay(requested,day,scopedApi),siteReportsForDay(requested,day,scopedApi)]);
      if(!active())return;
      state.sitePrintSites=ids;state.sitePrintDate=day;
      target.innerHTML=`<p>문서 ${docs.length}건 · 당일 보고서 ${reports.length}건 (합계 최대 20개 선택)</p><button type="button" id="site-print-select-all">전체 선택</button> <button type="button" id="site-print-preview">선택 문서·보고서 미리보기</button><div class="table-wrap"><table><thead><tr><th>선택</th><th>현장</th><th>제목</th></tr></thead><tbody>${docs.map(doc=>`<tr><td><input type="checkbox" data-print-document="${doc.id}" aria-label="${esc(doc.site_name)} ${esc(doc.title)} 선택"></td><td>${esc(doc.site_name)}</td><td>${esc(doc.title)}</td></tr>`).join('')}${reports.map(report=>`<tr><td><input type="checkbox" data-print-report="${report.id}" aria-label="${esc(report.site.name)} ${esc(report.title)} 선택"></td><td>${esc(report.site.name)}</td><td>${esc(report.title)}</td></tr>`).join('')}</tbody></table></div>`;
      find('#site-print-select-all').onclick=()=>{if(active())target.querySelectorAll('[data-print-document],[data-print-report]').forEach(input=>{input.checked=true;});};
      find('#site-print-preview').onclick=async()=>{if(!active())return;try{const selected=selectBatchItems(docs,reports,[...target.querySelectorAll('[data-print-document]:checked')].map(input=>input.dataset.printDocument),[...target.querySelectorAll('[data-print-report]:checked')].map(input=>input.dataset.printReport));await preview(selected.documents,docs,reports.filter(report=>selected.reports.includes(report.id)));}catch(error){if(active())onError(error);}};
    }catch(error){if(active()){target.replaceChildren();onError(error);}}finally{if(active())button.disabled=false;}
  };
}
