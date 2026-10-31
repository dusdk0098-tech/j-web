const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function basicSampleList(siteId,category,editable=false){
  if(!category)return '<p>등록된 분류를 선택하면 시험 샘플을 볼 수 있습니다.</p>';
  if(!Number.isSafeInteger(siteId)||siteId<1||!Number.isSafeInteger(category.id)||category.id<1||!Array.isArray(category.samples)||category.samples.some(file=>!Number.isSafeInteger(file.id)||file.id<1||!Number.isSafeInteger(file.size)||file.size<0))throw Error('샘플 목록을 다시 확인해 주세요.');
  if(!category.samples.length)return '<p>등록된 시험 샘플이 없습니다.</p>';
  return `<ul>${category.samples.map(file=>`<li><a href="/api/basic-categories/${category.id}/samples/${file.id}?siteId=${siteId}" download>${esc(file.name)}</a> · ${file.size}바이트${editable?` <button type="button" data-sample-delete="${file.id}">삭제</button>`:''}</li>`).join('')}</ul>`;
}

