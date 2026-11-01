export function validateAiImage(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('JPEG, PNG, WebP 사진만 선택해 주세요.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw Error('사진은 0바이트보다 크고 5MB 이하여야 합니다.');
}

function readImage(file) {
  return new Promise((resolve,reject) => {
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(Error('사진을 읽지 못했습니다. 다시 선택해 주세요.'));
    reader.onabort=()=>reject(Error('사진 읽기가 취소되었습니다.'));
    reader.readAsDataURL(file);
  });
}

async function request(path,body) {
  const response=await fetch(`/api/ai/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  if (!response.ok) throw Error(response.status===401?'로그인이 만료되었습니다. 다른 탭에서 다시 로그인한 뒤 전송해 주세요.':result.error || '요청에 실패했습니다.');
  return result;
}

export function mountAiChat(root,{api=request,loadImage=readImage}={}) {
  const get=id=>root.querySelector(`#ai-${id}`),panel=get('panel'),toggle=get('toggle'),form=get('form'),text=get('text'),file=get('file'),send=get('send'),error=get('error'),status=get('status');
  let configured=false,sending=false,reading=false,image=null,imageEpoch=0,statusEpoch=0;
  const viewer=get('image-dialog');let imageOpener=null;
  const openImage=(photo,opener)=>{
    if(!photo)return;imageOpener=opener;get('image-full').src=`data:${photo.mimeType};base64,${photo.data}`;get('image-full').alt=photo.name;get('image-name').textContent=photo.name;viewer.showModal();get('image-close').focus();
  };
  get('preview-open').onclick=()=>openImage(image,get('preview-open'));
  get('image-close').onclick=()=>viewer.close();
  viewer.oncancel=event=>{event.preventDefault();viewer.close();};
  viewer.onclose=()=>{get('image-full').removeAttribute('src');get('image-full').alt='';get('image-name').textContent='';(panel.hidden?toggle:imageOpener===get('preview-open')&&get('attachment').hidden?text:imageOpener)?.focus();imageOpener=null;};
  const controls=()=>{send.disabled=!configured||sending||reading;text.disabled=sending;file.disabled=sending;get('remove').disabled=sending;send.textContent=sending?'답변 기다리는 중…':'전송';};
  const attachment=()=>{get('attachment').hidden=!image;get('filename').textContent=image?.name||'';if(image)get('preview').src=`data:${image.mimeType};base64,${image.data}`;else get('preview').removeAttribute('src');};
  const close=()=>{panel.hidden=true;if(viewer.open)viewer.close();toggle.setAttribute('aria-expanded','false');toggle.focus();};
  toggle.onclick=async()=>{
    if(!panel.hidden){close();return;}
    panel.hidden=false;toggle.setAttribute('aria-expanded','true');text.focus();
    const epoch=++statusEpoch;configured=false;controls();status.textContent='AI 연결 상태 확인 중…';
    try{const result=await api('status');if(epoch!==statusEpoch)return;configured=result.configured===true;status.textContent=result.message||(configured?'AI 상담을 사용할 수 있습니다.':'AI 제공업체가 설정되지 않아 전송할 수 없습니다.');}
    catch(err){if(epoch===statusEpoch)status.textContent=err.message;}
    finally{if(epoch===statusEpoch)controls();}
  };
  get('close').onclick=close;
  panel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
  file.onchange=async()=>{
    if(sending)return;const epoch=++imageEpoch,selected=file.files?.[0];reading=false;error.textContent='';controls();
    if(!selected)return;
    try{validateAiImage(selected);reading=true;controls();const data=await loadImage(selected);if(epoch!==imageEpoch)return;image={name:selected.name,mimeType:selected.type,data};attachment();}
    catch(err){if(epoch===imageEpoch)error.textContent=err.message;}
    finally{if(epoch===imageEpoch){reading=false;file.value='';controls();}}
  };
  get('remove').onclick=()=>{if(sending)return;imageEpoch++;reading=false;image=null;file.value='';attachment();controls();};
  form.onsubmit=async event=>{
    event.preventDefault();if(!configured||sending||reading)return;
    const question=text.value.trim();error.textContent='';
    if(!question&&!image){error.textContent='질문이나 사진을 입력해 주세요.';return;}
    if(question.length>4000){error.textContent='질문은 4,000자 이하로 입력해 주세요.';return;}
    const payload={text:question,...(image?{image}: {})};sending=true;controls();
    try{
      const result=await api('chat',payload);
      if(typeof result.answer!=='string'||!result.answer.trim()||!result.id)throw Error('답변을 확인하지 못했습니다. 입력 내용은 유지됩니다.');
      const doc=root.ownerDocument,article=doc.createElement('article'),questionNode=doc.createElement('p'),answer=doc.createElement('p'),feedbackStatus=doc.createElement('p');
      questionNode.textContent=`질문: ${question || '(사진 상담)'}${image?`\n첨부: ${image.name}`:''}`;answer.textContent=result.answer;feedbackStatus.setAttribute('role','status');article.append(questionNode);
      if(payload.image){
        const photo=payload.image,button=doc.createElement('button'),thumbnail=doc.createElement('img');
        button.type='button';button.className='outline ai-image-open';button.setAttribute('aria-label',`보낸 사진 확대 보기: ${photo.name}`);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','ai-image-dialog');
        thumbnail.src=`data:${photo.mimeType};base64,${photo.data}`;thumbnail.alt=photo.name;button.append(thumbnail);button.onclick=()=>openImage(photo,button);article.append(button);
      }
      article.append(answer);
      const buttons=[];let ratingBusy=false;
      for(const [rating,label] of [['good','좋음'],['bad','나쁨']]){
        const button=doc.createElement('button');button.type='button';button.className='outline';button.textContent=label;button.setAttribute('aria-label',`답변 평가: ${label}`);button.setAttribute('aria-pressed','false');buttons.push(button);article.append(button);
        button.onclick=async()=>{
          if(ratingBusy)return;ratingBusy=true;buttons.forEach(node=>node.disabled=true);feedbackStatus.textContent='평가 저장 중…';
          try{await api('feedback',{id:result.id,rating});buttons.forEach(node=>node.setAttribute('aria-pressed',String(node===button)));feedbackStatus.textContent='평가가 저장되었습니다.';}
          catch(err){feedbackStatus.textContent=err.message;}
          finally{ratingBusy=false;buttons.forEach(node=>node.disabled=false);}
        };
      }
      article.append(feedbackStatus);get('messages').append(article);text.value='';image=null;attachment();
    }catch(err){error.textContent=err.message;}
    finally{sending=false;controls();}
  };
  controls();
}

if(typeof document!=='undefined'){
  const root=document.querySelector('#ai-chat');
  if(root)mountAiChat(root);
}
