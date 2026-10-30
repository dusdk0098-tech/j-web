export function siteQrSession(siteId,siteName,api){
  if(!Number.isSafeInteger(siteId)||siteId<1||typeof siteName!=='string'||!siteName.trim()||typeof api!=='function')throw Error('현장을 확인해 주세요.');
  const path=`/api/sites/${siteId}`;let busy=false;
  const run=async(suffix,options)=>{if(busy)throw Error('다른 QR 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');busy=true;try{return await api(path+suffix,options);}finally{busy=false;}};
  return Object.freeze({siteId,siteName,access:()=>run('/access',{method:'POST',body:'{}'}),invite:()=>run('/invitation',{method:'POST',body:'{}'}),openRegistration:()=>run('/access/registration',{method:'POST',body:'{}'}),rotate:()=>run('/access/rotate',{method:'POST',body:'{}'}),revoke:()=>run('/invitation',{method:'DELETE'})});
}

export function printSiteQr(dialog,mode,print=()=>window.print()){
  if(!['access','invite'].includes(mode))throw Error('출력할 QR을 선택해 주세요.');
  const image=dialog.querySelector(mode==='access'?'#login-qr-image':'#invite-qr-image');
  if(!image?.complete||!image.naturalWidth)throw Error('QR 이미지를 불러온 뒤 다시 인쇄해 주세요.');
  dialog.dataset.qrPrint=mode;print();
}
