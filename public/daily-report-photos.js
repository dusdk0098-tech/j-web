const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function dailyReportPhotos(siteId,documentId,photos){
  if(!Number.isSafeInteger(siteId)||siteId<1||!Number.isSafeInteger(documentId)||documentId<1||!Array.isArray(photos))throw Error('일보 사진을 확인해 주세요.');
  const figures=photos.map(photo=>{
    if(!photo||!['attachment','site'].includes(photo.kind)||!Number.isSafeInteger(photo.id)||photo.id<1||typeof photo.version!=='string'||!/^[a-f0-9]{64}$/.test(photo.version))throw Error('일보 사진을 다시 조회해 주세요.');
    const url=`/api/sites/${siteId}/daily-reports/${documentId}/print-photos/${photo.kind}/${photo.id}?version=${photo.version}`;
    return `<figure><img src="${url}" alt="${esc(photo.name)}"><figcaption>${photo.kind==='site'?'현장사진':'일보 첨부'} · ${esc(photo.name)}${photo.description?' · '+esc(photo.description):''}</figcaption></figure>`;
  }).join('');
  return `<section class="daily-report-photos"><h3>가상 사진</h3><p>일보에 첨부된 사진과 같은 현장·날짜의 현장사진입니다.</p>${figures||'<p>해당 사진이 없습니다.</p>'}</section>`;
}
