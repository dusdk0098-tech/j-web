import { validateWorkerInvitation } from './worker-invitation.js';

export function mountContractorInvitation({container,worker,reportContext,request,active}){
  const button=document.createElement('button'),output=document.createElement('span');button.type='button';button.textContent='개인 가입 QR 발급';output.setAttribute('aria-live','polite');container.append(' ',button,output);
  button.onclick=async()=>{
    if(button.disabled||!active()||!container.isConnected)return;button.disabled=true;output.textContent='발급 중입니다.';const current=()=>active()&&container.isConnected&&button.isConnected;
    try{
      const result=await request(`/api/worker/company-workers/${worker.id}/invitation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:worker.version,reportContext})},'json',current);if(!current())return;
      validateWorkerInvitation(result,globalThis.location.origin);
      const info=document.createElement('span'),image=document.createElement('img'),link=document.createElement('input'),close=document.createElement('button');info.textContent=`${new Date(result.expiresAt).toLocaleString('ko-KR')}까지 한 번 사용할 수 있습니다. 본인에게만 전달하세요. 다시 발급하면 이전 개인 QR은 사용할 수 없습니다.`;image.src=result.image;image.alt='개인 가입 QR';image.width=240;image.height=240;link.type='text';link.readOnly=true;link.value=result.link;link.setAttribute('aria-label','개인 가입 주소');close.type='button';close.textContent='닫기';close.onclick=()=>output.replaceChildren();output.replaceChildren(info,image,link,close);button.textContent='개인 가입 QR 다시 발급';
    }catch(error){if(current())output.textContent=`${error.message} 응답이 없었다면 이전 QR이 변경됐을 수 있습니다.`;}finally{button.disabled=false;}
  };
}
