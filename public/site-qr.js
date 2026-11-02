export function siteQrSession(siteId,siteName,api){
  if(!Number.isSafeInteger(siteId)||siteId<1||typeof siteName!=='string'||!siteName.trim()||typeof api!=='function')throw Error('현장을 확인해 주세요.');
  const path=`/api/sites/${siteId}`;let busy=false,version=0;
  const run=async(suffix,options)=>{if(busy)throw Error('다른 QR 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');busy=true;version++;try{return await api(path+suffix,options);}finally{busy=false;}};
  return Object.freeze({siteId,siteName,get version(){return version;},get busy(){return busy;},inviteStatus:token=>run('/invitation/status',{method:'POST',body:JSON.stringify({token})}),access:()=>run('/access',{method:'POST',body:'{}'}),status:()=>run('/access/status',{method:'GET'}),invite:()=>run('/invitation',{method:'POST',body:'{}'}),openRegistration:()=>run('/access/registration',{method:'POST',body:'{}'}),rotate:()=>run('/access/rotate',{method:'POST',body:'{}'}),revoke:()=>run('/invitation',{method:'DELETE'})});
}

export function printSiteQr(dialog,mode,print=()=>window.print()){
  if(!['access','invite'].includes(mode))throw Error('출력할 QR을 선택해 주세요.');
  const image=dialog.querySelector(mode==='access'?'#login-qr-image':'#invite-qr-image');
  if(!image?.complete||!image.naturalWidth)throw Error('QR 이미지를 불러온 뒤 다시 인쇄해 주세요.');
  dialog.dataset.qrPrint=mode;print();
}

// 확인 이후 다른 창에서 변경할 수 있으므로 확인 시점만 알리고, 인쇄마다 재확인한다.
export function siteQrPrintAction({dialog,mode,session,qr,current,button,status,error,print=printSiteQr,now=Date.now}){
  let pending=false,approved=null;
  const label=mode==='access'?'현장 QR':'가입 QR',reset=()=>{approved=null;button.textContent=label+' 확인 후 인쇄';};reset();
  return async event=>{
    event?.preventDefault();
    if(!current()||pending)return;
    const image=dialog.querySelector(mode==='access'?'#login-qr-image':'#invite-qr-image');
    try{
      if(session.busy)throw Error('다른 QR 요청이 끝난 뒤 다시 확인해 주세요.');
      if(!image?.complete||!image.naturalWidth)throw Error('QR 이미지를 불러온 뒤 다시 인쇄해 주세요.');
      if(approved&&approved.version===session.version&&approved.image===image.src&&now()-approved.at<15000&&(!approved.expiresAt||now()<approved.expiresAt)){
        reset();print(dialog,mode);error.textContent='';return;
      }
      reset();pending=true;const started=now(),shown=image.src,record=qr();status.textContent='인쇄 전 QR 상태를 확인 중입니다.';error.textContent='';
      const result=mode==='access'?await session.status():await session.inviteStatus(new URL(record.link).searchParams.get('token'));
      if(!current()||image.src!==shown)return;
      if(now()-started>=15000)throw Error('확인 응답이 늦었습니다. 다시 확인해 주세요.');
      const valid=mode==='access'?!!record.accessFingerprint&&result.accessFingerprint===record.accessFingerprint:result.valid===true&&Number.isFinite(result.expiresAt)&&result.expiresAt>now();
      if(!valid)throw Error('QR이 교체되었거나 만료·중지되었습니다. 창을 다시 열어 주세요.');
      approved={version:session.version,image:shown,at:started,expiresAt:mode==='invite'?result.expiresAt:null};
      button.textContent='확인한 '+label+' 인쇄';
      status.textContent='확인 당시 유효합니다. 15초 안에 인쇄 버튼을 다시 누르세요. 확인 이후 다른 창에서 변경하면 출력물이 무효일 수 있습니다.';
    }catch(e){if(current()){reset();status.textContent='QR 상태를 확인하지 못했습니다. 다시 확인해 주세요.';error.textContent=e.message;}}
    finally{pending=false;}
  };
}
