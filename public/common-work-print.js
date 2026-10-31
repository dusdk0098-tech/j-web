import { richBody } from './rich-editor.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const files=items=>items.length?'<ul>'+items.map(file=>'<li>'+esc(file.name)+'</li>').join('')+'</ul>':'<p>첨부 없음</p>';
const author=item=>item.author_name||(item.author_id===null?'관리자 시험 기록':'알 수 없는 작성자');

export function showCommonWorkPreview(doc,result,{autoPrint=false,active=()=>true}={}){
  if(doc.querySelector('dialog.common-work-preview[open]'))throw Error('열린 미리보기를 먼저 닫아 주세요.');
  const dialog=doc.createElement('dialog');dialog.className='common-work-preview';dialog.setAttribute('aria-label','선택 업무 미리보기');
  const items=result.items.map(item=>'<article class="common-work-print-item"><h3>'+esc(item.title)+'</h3><p>'+esc(item.date)+' · '+esc(item.category||'구분 미선택')+' · '+esc(item.process||'공정 미입력')+' · '+esc(author(item))+' · '+(item.status==='draft'?'임시':'게시')+'</p><div class="detail-body rich-body">'+richBody(item.rich_content,item.content)+'</div><h4>업무 첨부</h4>'+files(item.files)+'<h4>의견</h4>'+(item.comments.length?item.comments.map(comment=>'<section><p>'+esc(author(comment))+' · '+esc(comment.created_at)+' (UTC)</p><p class="detail-body">'+esc(comment.content)+'</p>'+files(comment.files)+'</section>').join(''):'<p>의견 없음</p>')+'</article>').join('');
  dialog.innerHTML='<h2>선택 업무 미리보기</h2><p>가상 현장: '+esc(result.siteName)+' · 조회 당시 내용이며 첨부파일은 이름만 표시합니다.</p><p data-preview-status role="status"></p><div class="common-work-print-items">'+items+'</div><button type="button" data-preview-print>인쇄</button> <button type="button" data-preview-close>닫기</button>';
  doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  const print=()=>{try{doc.defaultView.print();}catch{dialog.querySelector('[data-preview-status]').textContent='인쇄를 시작하지 못했습니다.';}};
  dialog.querySelector('[data-preview-close]').onclick=()=>dialog.close();dialog.querySelector('[data-preview-print]').onclick=print;
  try{dialog.showModal();}catch(error){dialog.remove();throw error;}
  if(autoPrint)doc.defaultView.requestAnimationFrame(()=>{if(dialog.open&&active())print();});
  return dialog;
}
