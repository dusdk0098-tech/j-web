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
