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

export async function siteReportsForDay(sites,date,api) {
  if(!Array.isArray(sites)||!sites.length||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('현장과 날짜를 선택해 주세요.');
  const result=await Promise.all(sites.map(async site=>{
    const [ppe,attendance]=await Promise.all([api(`/api/ppe-issues?${new URLSearchParams({siteId:String(site.id),month:date.slice(0,7)})}`),api(`/api/attendance?${new URLSearchParams({siteId:String(site.id),date})}`)]);
    const rows=ppe.rows.filter(row=>row.date===date),totals=new Map();
    for(const row of rows)totals.set(row.item,(totals.get(row.item)||0)+row.quantity);
    return [{kind:'ppe-summary',title:'보호구 당일 요약',rows:[...totals].map(([item,quantity])=>({item,quantity}))},{kind:'ppe-detail',title:'보호구 당일 상세',rows},{kind:'attendance',title:'출역일보',rows:attendance.filter(row=>row.present)}].map(report=>({...report,site,date}));
  }));
  return result.flat().map((report,index)=>({...report,id:index+1}));
}

export function dailyBatchReport(report,esc) {
  const table=(heads,rows)=>rows.length?`<div class="table-wrap"><table><thead><tr>${heads.map(head=>`<th>${esc(head)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>해당 날짜의 기록이 없습니다.</p>';
  let body;
  if(report.kind==='ppe-summary')body=table(['보호구','수량'],report.rows.map(row=>[row.item,row.quantity]));
  else if(report.kind==='ppe-detail')body=table(['이름','구분','소속','직종','보호구','수량','시험 수령 확인'],report.rows.map(row=>[row.worker.name,row.worker.category,row.worker.company,row.worker.occupation,row.item,row.quantity,row.receipt_at?'시험 확인 기록 있음':'미확인']));
  else if(report.kind==='attendance'){
    const recorded=report.rows.filter(row=>row.units_hundredths!=null);
    body=`<p>출역 ${report.rows.length}명 · 기록된 공수 ${recorded.length?(recorded.reduce((sum,row)=>sum+row.units_hundredths,0)/100).toFixed(2):'미기록'} · 공수 미기록 ${report.rows.length-recorded.length}명</p><p>이름은 현재 정보이며 구분·소속·직종은 출역 당시 기록입니다.</p>`+table(['이름','구분','소속','직종','공수'],report.rows.map(row=>[row.name,row.attendance_category??'기록 없음',row.attendance_company??'기록 없음',row.attendance_occupation??'기록 없음',row.units_hundredths==null?'미기록':(row.units_hundredths/100).toFixed(2)]));
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
