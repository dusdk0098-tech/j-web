export function setWorkerInvitationMode(form,existing){
  const message=form.querySelector('#join-details > p');
  message.textContent=existing?'개인 가입 주소입니다. 관리자가 등록한 이름을 입력하세요. 기존 구분·소속·직종과 출역 기록은 유지됩니다.':'협력업체는 소속과 직종이 필요합니다. 직영은 소속을, 근로를 제공하지 않는 사람은 소속과 직종을 생략할 수 있습니다.';
  for(const name of ['category','company','occupation']){const field=form.elements[name];field.disabled=existing;field.closest('label').hidden=existing;}
}

export function mountWorkerInvitation(anchor,worker,api,current,doc=globalThis.document){
  if(worker.has_account)return;
  const box=doc.createElement('div'),button=doc.createElement('button'),result=doc.createElement('div');
  button.type='button';button.className='small';button.textContent='개인 가입 QR 발급';button.setAttribute('aria-label',`${worker.name} 개인 가입 QR 발급`);
  result.setAttribute('aria-live','polite');box.append(button,result);anchor.after(box);
  const active=()=>box.isConnected&&current();
  button.onclick=async()=>{
    if(button.disabled||!active())return;button.disabled=true;result.textContent='개인 가입 QR을 발급하고 있습니다.';
    try{
      const issued=await api(`/api/workers/${worker.id}/invitation`,{method:'POST',body:JSON.stringify({siteId:worker.site_id,version:worker.version})},active);
      if(!active())return;
      const url=new URL(issued.link),origin=globalThis.location.origin;
      if(url.origin!==origin||url.pathname!=='/join'||url.hash||[...url.searchParams.keys()].some(key=>key!=='token')||url.searchParams.getAll('token').length!==1||!/^[\w-]{43}$/.test(url.searchParams.get('token')||'')||typeof issued.image!=='string'||!issued.image.startsWith('data:image/png;base64,')||!Number.isFinite(issued.expiresAt)||issued.expiresAt<=Date.now())throw Error('가입 QR 응답을 확인해 주세요.');
      const image=doc.createElement('img'),address=doc.createElement('input'),note=doc.createElement('p'),close=doc.createElement('button');
      image.src=issued.image;image.alt='개인 가입 QR 코드';image.width=192;image.height=192;
      address.value=issued.link;address.readOnly=true;address.setAttribute('aria-label','개인 가입 주소');
      note.textContent=`${new Date(issued.expiresAt).toLocaleString('ko-KR')}까지 한 번 사용할 수 있습니다. 해당 출입자에게만 전달하세요. 다시 발급하면 이전 주소는 중지됩니다.`;
      close.type='button';close.textContent='닫기';close.onclick=()=>result.replaceChildren();
      result.replaceChildren(image,address,note,close);button.textContent='개인 가입 QR 다시 발급';
    }catch(error){if(active())result.textContent=error.message||'개인 가입 QR을 발급하지 못했습니다.';}
    finally{if(button.isConnected)button.disabled=false;}
  };
}
