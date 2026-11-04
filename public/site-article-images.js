export function siteArticleImageLimits(getRow,siteId,worker=false){
  return {allowBoardImages:true,imageUrl:image=>{const row=getRow();if(!row)throw Error('먼저 글을 저장해 주세요.');const params=new URLSearchParams({version:image.fileVersion,preview:'1'});if(!worker)params.set('siteId',String(siteId));return `${worker?'/api/worker/articles':'/api/site-articles'}/${row.id}/files/${image.attachmentId}?${params}`;}};
}

export function mountSiteArticleImagePicker(container,{row,editor,active}){
  const label=document.createElement('label'),select=document.createElement('select'),button=document.createElement('button'),status=document.createElement('p'),images=(row?.files||[]).filter(file=>file.imageType);
  label.textContent='본문에 넣을 이미지';label.append(select);button.type='button';button.textContent='이미지 넣기';button.disabled=!images.length;status.setAttribute('role','status');
  for(const [index,file] of images.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=file.name;select.append(option);}
  status.textContent=!row?'글을 저장하고 이미지를 첨부한 뒤 수정 화면에서 넣을 수 있습니다.':images.length?'본문 위치를 선택한 후 이미지를 넣으세요.':'먼저 글에 PNG·JPEG·WebP 이미지를 첨부해 주세요.';
  button.onclick=()=>{if(!active()||!container.isConnected)return;const file=images[Number(select.value)];if(!file)return;try{editor.insertBoardImage({type:'image',attachmentId:file.id,fileVersion:file.version,alt:file.name});status.textContent='이미지를 본문에 넣었습니다. 글을 저장해야 적용됩니다.';}catch(error){status.textContent=error.message;}};
  container.replaceChildren(label,button,status);
}
