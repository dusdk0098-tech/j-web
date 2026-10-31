import { selectBatchDocuments } from './batch-print.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function filterPersonalNotes(notes,{from='',to='',author='',q=''}={}){
  return notes.filter(note=>(!from||note.date>=from)&&(!to||note.date<=to)&&(!author||String(note.author_id)===author)&&note.content.includes(q));
}

export function showPersonalNotePreview(doc,result,{autoPrint=false,active=()=>true}={}){
  if(doc.querySelector('dialog.common-work-preview[open]'))throw Error('열린 미리보기를 먼저 닫아 주세요.');
  const dialog=doc.createElement('dialog');dialog.className='common-work-preview personal-note-preview';dialog.setAttribute('aria-label','선택 일지 미리보기');
  dialog.innerHTML='<h2>선택 일지 미리보기</h2><p>가상 현장: '+esc(result.siteName)+' · 조회 당시 내용이며 첨부파일은 이름만 표시합니다.</p><p data-preview-status role="status"></p>'+result.items.map(note=>'<article class="common-work-print-item"><h3>'+esc(note.date)+' · '+esc(note.author_name||'관리자 시험 기록')+'</h3><p>'+(note.private?'비공개':'공개')+' · '+(note.checked?'시험 확인 완료':'시험 미확인')+'</p><p class="detail-body">'+esc(note.content)+'</p><h4>첨부파일</h4>'+(note.files.length?'<ul>'+note.files.map(file=>'<li>'+esc(file.name)+'</li>').join('')+'</ul>':'<p>첨부 없음</p>')+'</article>').join('')+'<button type="button" data-preview-print>인쇄</button> <button type="button" data-preview-close>닫기</button>';
  doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  const print=()=>{try{if(active())doc.defaultView.print();}catch{dialog.querySelector('[data-preview-status]').textContent='인쇄를 시작하지 못했습니다.';}};
  dialog.querySelector('[data-preview-close]').onclick=()=>dialog.close();dialog.querySelector('[data-preview-print]').onclick=print;
  try{dialog.showModal();}catch(error){dialog.remove();throw error;}
  if(autoPrint)doc.defaultView.requestAnimationFrame(()=>{if(dialog.open)print();});
  return dialog;
}

export function mountPersonalNoteTools({target,notes,api,base,siteId,cardAttribute,active=()=>true,filters=null}){
  const doc=target.ownerDocument,toolbar=doc.createElement('div');let generation=0,visible=notes;
  const authors=[...new Map(notes.filter(note=>note.author_id!==null).map(note=>[note.author_id,note.author_name])).entries()];
  const authorOptions=(filters?.author&&!authors.some(([id])=>String(id)===filters.author)?'<option value="'+esc(filters.author)+'" selected>선택한 작성자 (현재 조회 불가)</option>':'')+authors.map(([id,name])=>'<option value="'+id+'" '+(filters?.author===String(id)?'selected':'')+'>'+esc(name||'알 수 없는 작성자')+' · 계정 '+id+'</option>').join('');
  toolbar.innerHTML=(filters?'<div class="filters"><label>작성자 <select data-note-author><option value="">전체</option>'+authorOptions+'</select></label><label>시작일 <input type="date" data-note-from value="'+esc(filters.from||'')+'"></label><label>종료일 <input type="date" data-note-to value="'+esc(filters.to||'')+'"></label><label>내용 검색 <input data-note-query maxlength="200" value="'+esc(filters.q||'')+'"></label><button type="button" data-note-search>검색</button></div>':'')+'<div class="batch-controls"><button type="button" data-note-all>전체 선택</button> <button type="button" data-note-preview>선택 보기</button> <button type="button" data-note-print>선택 인쇄</button><p>최대 20건을 선택할 수 있으며 첨부파일은 이름만 표시합니다.</p><p data-note-batch-status role="status"></p></div>';
  target.insertBefore(toolbar,target.querySelector('article'));
  for(const note of notes){const card=target.querySelector(`[${cardAttribute}="${note.id}"]`);card.insertAdjacentHTML('afterbegin',`<label><input type="checkbox" data-note-select="${note.id}" aria-label="${esc(note.date)} 일지 선택"> 선택</label>`);}
  const status=toolbar.querySelector('[data-note-batch-status]'),selected=()=>[...target.querySelectorAll('[data-note-select]:checked')].map(input=>input.dataset.noteSelect),previewButton=toolbar.querySelector('[data-note-preview]'),printButton=toolbar.querySelector('[data-note-print]');
  const applyFilters=()=>{visible=filters?filterPersonalNotes(notes,filters):notes;const ids=new Set(visible.map(note=>note.id));for(const note of notes){const card=target.querySelector(`[${cardAttribute}="${note.id}"]`);card.hidden=!ids.has(note.id);if(card.hidden)card.querySelector('[data-note-select]').checked=false;}};
  if(filters){applyFilters();toolbar.querySelector('[data-note-search]').onclick=()=>{const from=toolbar.querySelector('[data-note-from]').value,to=toolbar.querySelector('[data-note-to]').value;if(from&&to&&from>to){status.textContent='조회 기간을 확인해 주세요.';return;}Object.assign(filters,{from,to,author:toolbar.querySelector('[data-note-author]').value,q:toolbar.querySelector('[data-note-query]').value});generation++;status.textContent='';applyFilters();};}
  toolbar.querySelector('[data-note-all]').onclick=()=>{for(const note of visible)target.querySelector(`[${cardAttribute}="${note.id}"] [data-note-select]`).checked=true;};
  const preview=async autoPrint=>{const current=generation;try{const ids=selectBatchDocuments(visible,selected()),items=ids.map(id=>({id,version:visible.find(note=>note.id===id).version}));previewButton.disabled=printButton.disabled=true;const result=await api(base+'/preview',{method:'POST',body:JSON.stringify({siteId,items})});if(!target.isConnected||!active()||current!==generation)return;if(JSON.stringify(ids)!==JSON.stringify(selected().map(Number)))throw Error('선택이 변경되었습니다. 다시 확인해 주세요.');showPersonalNotePreview(doc,result,{autoPrint,active});}catch(error){if(target.isConnected&&active())status.textContent=error.message;}finally{previewButton.disabled=printButton.disabled=false;}};
  previewButton.onclick=()=>preview(false);printButton.onclick=()=>preview(true);
}
