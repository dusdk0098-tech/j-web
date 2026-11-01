import { richBody,richEditorMarkup,mountRichEditor } from './rich-editor.js';
import { selectBatchDocuments } from './batch-print.js';
import { showCommonWorkPreview } from './common-work-print.js';
const categories=['공정회의','지시사항','설계변경','기타'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const workBody=row=>richBody(row.rich_content,row.content);
export function newWorkWithFiles({create,upload,publish,active=()=>true,onProgress=()=>{},onStart=()=>{}}){
  let attempted=false;
  return async(data,files)=>{
    if(attempted)throw Error('이미 저장을 요청했습니다. 목록에서 저장 결과를 먼저 확인해 주세요.');
    if(!files.length||files.length>20)throw Error('업무 첨부파일은 1개 이상 20개까지 선택해 주세요.');
    for(const file of files)if(!file.size||file.size>2*1024*1024||!file.name.trim()||file.name.length>200||/[\\/\x00-\x1f\x7f]/.test(file.name))throw Error('파일은 1바이트 이상 2MiB 이하이며 올바른 이름이어야 합니다.');
    if(data.status==='published'&&!data.category)throw Error('게시하려면 업무 구분을 선택해 주세요.');
    const check=()=>{if(!active())throw Error('화면이 변경되어 후속 저장을 중단했습니다.');};
    check();attempted=true;onStart();let row,completed=0;
    try{
      row=await create({...data,status:'draft'});check();
      if(!row?.id||typeof row.version!=='string'||!row.version)throw Error('임시 저장 응답을 확인할 수 없습니다.');
      for(const file of files){
        onProgress(`업무 #${row.id}: 첨부 ${completed+1}/${files.length} 저장 중입니다. 화면 이동 시 후속 저장이 중단됩니다.`);
        check();const result=await upload(row,file);check();
        if(typeof result?.version!=='string'||!result.version||result.version===row.version)throw Error('첨부 저장 버전을 확인할 수 없습니다.');
        row={...row,version:result.version};completed++;
      }
      if(data.status==='published'){check();await publish(row,{...data,version:row.version});check();}
      return row;
    }catch(error){
      throw Error(`${error.message} ${row?.id?'업무 #'+row.id+' · ':''}첨부 응답 확인 ${completed}/${files.length}개. 저장 결과가 불확실할 수 있어 재전송과 자동 게시를 중단했습니다. 목록에서 제목·첨부·상태를 확인하고 기존 임시 기록에 빠진 파일만 추가한 뒤 직접 게시해 주세요. 로그인 만료 시 다른 탭에서 다시 로그인해 같은 현장에서 확인해 주세요.`,{cause:error});
    }
  };
}
export async function mountCommonWork({target,base,siteId,actorId=null,api,active=()=>true}){
  let sequence=0,loadSequence=0,savePending=false,filters={from:'',to:'',category:'',process:'',author:'',q:''};
  const alive=()=>target.isConnected&&active(),owner=id=>actorId===null||actorId===id;
  const url=(path='',extra={})=>`${base}${path}?${new URLSearchParams({siteId:String(siteId),...extra})}`;
  const fileRequest=async(path,options={})=>{
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
    const data=await response.json();if(!response.ok)throw Error(response.status===401?'로그인이 만료되었습니다. 입력을 보존하려면 다른 탭에서 다시 로그인한 뒤 저장 결과 목록을 확인해 주세요.':data.error||'요청에 실패했습니다.');return data;
  };
  async function render(recovery=null,keepInput=false){
    if(savePending)return;
    const current=++loadSequence,read=recovery||keepInput?fileRequest:api,[rows,authors]=await Promise.all([read(url('',filters)),read(url('/authors'))]);if(!alive()||current!==loadSequence||savePending)return;sequence=current;
    const authorValue=item=>item.id===null?'admin':String(item.id),missing=filters.author&&!authors.some(item=>authorValue(item)===filters.author),authorOptions=(missing?'<option value="'+esc(filters.author)+'" selected>선택한 작성자 (현재 조회 불가)</option>':'')+authors.map(item=>{const value=authorValue(item);return '<option value="'+esc(value)+'" '+(filters.author===value?'selected':'')+'>'+esc(item.name)+(item.id===null?'':' · 계정 '+esc(item.id))+'</option>';}).join('');
    target.innerHTML=`<h2>가상 공통업무</h2><p>시험 기록입니다. 같은 현장의 시험 계정에 게시하며 임시 기록은 작성자만 볼 수 있습니다.</p><form data-work-form><div class="fields"><label>날짜 <input type="date" name="date" required></label><label>구분 <select name="category"><option value="">선택</option>${categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><label>공정 <input name="process" maxlength="200"></label><label>참여자 <input name="participants" maxlength="200"></label><label>지시자 <input name="instructor" maxlength="200"></label><label>위치 <input name="location" maxlength="200"></label><label>제목 <input name="title" maxlength="200" required></label>${richEditorMarkup('공통업무 내용')}<label>상태 <select name="status"><option value="draft">임시 저장</option><option value="published">게시</option></select></label></div><label>신규 업무 첨부 <input type="file" multiple data-work-new-files></label><p>업무당 최대 20개, 파일당 2MiB(2,097,152바이트). 첨부를 선택하면 먼저 임시 저장하며 모두 저장된 뒤 게시합니다.</p><p data-new-files-list></p><button type="submit">저장</button> <button type="button" data-work-cancel hidden>수정 취소</button></form><p role="status" data-work-status></p><button type="button" data-work-recover hidden>저장 결과 목록 확인</button><div class="filters"><label>시작일 <input type="date" data-work-from value="${esc(filters.from)}"></label><label>종료일 <input type="date" data-work-to value="${esc(filters.to)}"></label><label>구분 <select data-work-category><option value="">전체</option>${categories.map(c=>`<option ${filters.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>공정 <input data-work-process maxlength="200" value="${esc(filters.process)}"></label><label>작성자 <select data-work-author><option value="">전체</option>${authorOptions}</select></label><label>제목·내용·의견·참여자·지시자·위치 검색 <input data-work-query maxlength="200" value="${esc(filters.q)}"></label><button type="button" data-work-search>검색</button></div><div class="batch-controls"><button type="button" data-work-select-all>전체 선택</button> <button type="button" data-work-preview>선택 보기</button> <button type="button" data-work-print>선택 인쇄</button><p>최대 20건을 선택할 수 있으며 첨부파일은 이름만 표시합니다.</p></div>${rows.length?rows.map(row=>`<article data-work-id="${row.id}"><label><input type="checkbox" data-work-select="${row.id}" aria-label="${esc(row.title)} 선택"> 선택</label><h3>${esc(row.title)}</h3><p>${esc(row.date)} · ${esc(row.category||'구분 미선택')} · ${esc(row.process||'공정 미입력')} · ${row.status==='draft'?'임시':'게시'} · ${esc(row.author_name||'관리자 시험 기록')}</p><p>참여자: ${esc(row.participants||'미입력')} · 지시자: ${esc(row.instructor||'미입력')} · 위치: ${esc(row.location||'미입력')}</p><div class="detail-body rich-body">${workBody(row)}</div><h4>업무 첨부</h4>${row.files.map(file=>`<p><a href="${url('/'+row.id+'/files/'+file.id)}">${esc(file.name)}</a> ${owner(row.author_id)?`<button type="button" data-file-delete="${file.id}">삭제</button>`:''}</p>`).join('')||'<p>첨부 없음</p>'}${owner(row.author_id)?'<label>업무 파일 추가 <input type="file" data-work-file></label> <button type="button" data-work-edit>수정</button> <button type="button" data-work-delete>삭제</button>':''}<h4>의견</h4>${row.comments.map(comment=>`<section data-comment-id="${comment.id}"><p>${esc(comment.author_name||'관리자 시험 기록')} · ${esc(comment.created_at)} (UTC)</p><p class="detail-body">${esc(comment.content)}</p>${comment.files.map(file=>`<p><a href="${url('/'+row.id+'/files/'+file.id)}">${esc(file.name)}</a> ${owner(comment.author_id)?`<button type="button" data-file-delete="${file.id}">삭제</button>`:''}</p>`).join('')}${owner(comment.author_id)?`<label>의견 파일 추가 <input type="file" data-comment-file></label><label>의견 수정 <textarea data-comment-text maxlength="4000">${esc(comment.content)}</textarea></label><button type="button" data-comment-save>수정 저장</button> <button type="button" data-comment-delete>삭제</button>`:''}</section>`).join('')||'<p>의견 없음</p>'}${row.status==='published'?'<form data-comment-form><label>가상 의견 <textarea name="content" maxlength="4000" required></textarea></label><button type="submit">의견 등록</button></form>':''}</article>`).join(''):'<p>공통업무 기록이 없습니다.</p>'}`;
    const form=target.querySelector('[data-work-form]'),status=target.querySelector('[data-work-status]'),cancel=target.querySelector('[data-work-cancel]');let editing=null,submitting=false,stopped=false,attemptData=null;
    const error=e=>{if(alive())status.textContent=e.message;},action=async(callback,button)=>{if(button)button.disabled=true;try{await callback();await render();}catch(e){error(e);}finally{if(button)button.disabled=false;}};
    const editor=mountRichEditor(target,{onError:error});
    cancel.onclick=()=>{if(submitting||savePending)return;stopped=false;form.querySelector('[type=submit]').disabled=false;editing=null;if(newFiles){newFiles.disabled=false;newFiles.value='';fileList.textContent='';}form.reset();editor.clear();form.elements.status.querySelector('[value=draft]').disabled=false;cancel.hidden=true;};
    const newFiles=target.querySelector('[data-work-new-files]'),fileList=target.querySelector('[data-new-files-list]'),recover=target.querySelector('[data-work-recover]');
    if(newFiles)newFiles.onchange=()=>{fileList.textContent=[...newFiles.files].map(file=>file.name).join(' · ');};
    if(recover)recover.onclick=()=>{filters={from:'',to:'',category:'',process:'',author:'',q:''};render({data:attemptData,names:[...newFiles.files].map(file=>file.name)}).catch(error);};
    const saveFiles=newWorkWithFiles({
      onStart:()=>{stopped=true;target.querySelectorAll('button,input,select,textarea').forEach(control=>{control.disabled=true;});target.querySelector('[data-rich-editor]').contentEditable='false';},
      active:()=>alive()&&current===sequence,
      onProgress:message=>{if(alive()&&current===sequence)status.textContent=message;},
      create:data=>fileRequest(url(),{method:'POST',body:JSON.stringify({...data,siteId})}),
      upload:async(row,file)=>{const response=await fetch(url('/'+row.id+'/files',{version:row.version}),{method:'POST',headers:{'x-file-name':encodeURIComponent(file.name)},body:file});if(!response.ok)throw Error((await response.json()).error||'첨부 저장에 실패했습니다.');return response.json();},
      publish:(row,data)=>fileRequest(url('/'+row.id),{method:'PUT',body:JSON.stringify({...data,siteId})})
    });
    form.onsubmit=async event=>{
      event.preventDefault();if(submitting||stopped||!alive()||current!==sequence)return;
      let fileSave=false;
      try{
        const data=Object.fromEntries(new FormData(form));data.richContent=editor.value();if(editing)data.version=editing.version;
        const files=editing?[]:[...(newFiles?.files||[])];fileSave=files.length>0;attemptData=data;
        submitting=true;savePending=true;
        if(fileSave){
          await saveFiles(data,files);
        }else await api(url(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify({...data,siteId})});
        savePending=false;if(alive()&&current===sequence)await render(null,fileSave);
      }catch(e){
        if(alive()&&current===sequence){error(e);if(fileSave&&stopped){recover.hidden=false;recover.disabled=false;}}
      }finally{submitting=false;savePending=false;}
    };
    if(recovery){
      for(const key of ['date','category','process','participants','instructor','location','title','status'])form.elements[key].value=recovery.data[key]??'';
      editor.set(recovery.data.richContent,recovery.data.content);stopped=true;form.querySelector('[type=submit]').disabled=true;newFiles.disabled=true;cancel.hidden=false;
      fileList.textContent='이전 선택: '+recovery.names.join(' · ')+' (필요한 파일은 기존 업무에서 다시 선택해 주세요.)';
      status.textContent='아래 목록에서 저장된 제목·첨부·상태를 먼저 확인해 주세요. 입력은 복사용으로 보존했으며 재전송하지 않습니다. 기존 기록의 수정/업무 파일 추가로 복구하세요. 새 업무는 수정 취소 후 작성하세요.';
    }
    target.querySelector('[data-work-search]').onclick=()=>{const from=target.querySelector('[data-work-from]').value,to=target.querySelector('[data-work-to]').value;if(from&&to&&from>to){error(Error('조회 기간을 확인해 주세요.'));return;}filters={from,to,category:target.querySelector('[data-work-category]').value,process:target.querySelector('[data-work-process]').value,author:target.querySelector('[data-work-author]').value,q:target.querySelector('[data-work-query]').value};render().catch(error);};
    const selected=()=>[...target.querySelectorAll('[data-work-select]:checked')].map(input=>input.dataset.workSelect),previewButton=target.querySelector('[data-work-preview]'),printButton=target.querySelector('[data-work-print]');
    target.querySelector('[data-work-select-all]').onclick=()=>target.querySelectorAll('[data-work-select]').forEach(input=>{input.checked=true;});
    const preview=async autoPrint=>{try{const ids=selectBatchDocuments(rows,selected()),items=ids.map(id=>({id,version:rows.find(row=>row.id===id).version}));previewButton.disabled=printButton.disabled=true;const result=await api(url('/preview'),{method:'POST',body:JSON.stringify({siteId,items})});if(!alive()||current!==sequence)return;if(JSON.stringify(ids)!==JSON.stringify(selected().map(Number)))throw Error('선택이 변경되었습니다. 다시 확인해 주세요.');showCommonWorkPreview(target.ownerDocument,result,{autoPrint,active:alive});}catch(e){error(e);}finally{previewButton.disabled=printButton.disabled=false;}};
    previewButton.onclick=()=>preview(false);printButton.onclick=()=>preview(true);
    for(const row of rows){
      const card=target.querySelector(`[data-work-id="${row.id}"]`),edit=card.querySelector('[data-work-edit]'),remove=card.querySelector('[data-work-delete]'),comments=card.querySelector('[data-comment-form]');
      if(edit)edit.onclick=()=>{if(submitting||savePending)return;stopped=false;form.querySelector('[type=submit]').disabled=false;editing=row;if(newFiles){newFiles.disabled=true;newFiles.value='';fileList.textContent='수정할 업무의 첨부는 아래 업무 파일 추가에서 관리해 주세요.';}for(const key of ['date','category','process','participants','instructor','location','title','status'])form.elements[key].value=row[key]??'';editor.set(row.rich_content,row.content);form.elements.status.querySelector('[value=draft]').disabled=row.status==='published';cancel.hidden=false;form.elements.title.focus();};
      if(remove)remove.onclick=()=>{if(confirm('가상 업무와 의견·첨부를 삭제할까요?'))action(()=>api(url('/'+row.id),{method:'DELETE',body:JSON.stringify({siteId,version:row.version})}),remove);};
      if(comments)comments.onsubmit=event=>{event.preventDefault();action(()=>api(url('/'+row.id+'/comments'),{method:'POST',body:JSON.stringify({siteId,version:row.version,content:comments.elements.content.value})}),comments.querySelector('button'));};
      const upload=(input,commentId)=>{input.onchange=async()=>{const file=input.files[0];if(!file)return;await action(async()=>{const response=await fetch(url('/'+row.id+'/files',{version:row.version,...(commentId?{commentId:String(commentId)}:{})}),{method:'POST',headers:{'x-file-name':encodeURIComponent(file.name)},body:file});if(!response.ok)throw Error((await response.json()).error);},input);};};
      const workFile=card.querySelector('[data-work-file]');if(workFile)upload(workFile,null);
      card.querySelectorAll('[data-file-delete]').forEach(button=>button.onclick=()=>{if(confirm('가상 첨부파일을 삭제할까요?'))action(()=>api(url('/'+row.id+'/files/'+button.dataset.fileDelete),{method:'DELETE',body:JSON.stringify({siteId,version:row.version})}),button);});
      for(const comment of row.comments){const section=card.querySelector(`[data-comment-id="${comment.id}"]`),file=section.querySelector('[data-comment-file]'),save=section.querySelector('[data-comment-save]'),del=section.querySelector('[data-comment-delete]');if(file)upload(file,comment.id);if(save)save.onclick=()=>action(()=>api(url('/'+row.id+'/comments/'+comment.id),{method:'PUT',body:JSON.stringify({siteId,version:row.version,content:section.querySelector('[data-comment-text]').value})}),save);if(del)del.onclick=()=>{if(confirm('가상 의견과 첨부를 삭제할까요?'))action(()=>api(url('/'+row.id+'/comments/'+comment.id),{method:'DELETE',body:JSON.stringify({siteId,version:row.version})}),del);};}
    }
  }
  await render();
}
