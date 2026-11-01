export function faqPage(rows,requested=1){
  const total=Math.max(1,Math.ceil(rows.length/10));
  const page=Math.max(1,Math.min(total,Number.isSafeInteger(requested)?requested:1));
  return {page,total,rows:rows.slice((page-1)*10,page*10)};
}

export function faqPager({page,total}){
  return `<nav aria-label="FAQ 페이지 이동"><button type="button" data-faq-prev ${page===1?'disabled':''}>이전</button> <span role="status" aria-live="polite">현재 ${page} / 총 ${total} 페이지</span> <button type="button" data-faq-next ${page===total?'disabled':''}>다음</button></nav>`;
}
