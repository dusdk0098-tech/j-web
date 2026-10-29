export function selectBatchDocuments(documents,selectedIds) {
  if(!Array.isArray(documents)||!Array.isArray(selectedIds)||selectedIds.length===0)throw new Error('미리 볼 문서를 선택해 주세요.');
  if(selectedIds.length>20)throw new Error('한 번에 문서 20개까지 선택할 수 있습니다.');
  const available=new Set(documents.map(document=>document.id)),ids=selectedIds.map(Number);
  if(ids.some(id=>!Number.isSafeInteger(id)||!available.has(id))||new Set(ids).size!==ids.length)throw new Error('선택한 문서를 다시 확인해 주세요.');
  return ids;
}
