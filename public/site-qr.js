export function siteQrSession(siteId,siteName,api){
  if(!Number.isSafeInteger(siteId)||siteId<1||typeof siteName!=='string'||!siteName.trim()||typeof api!=='function')throw Error('현장을 확인해 주세요.');
  const path=`/api/sites/${siteId}`;let busy=false;
  const run=async(suffix,options)=>{if(busy)throw Error('다른 QR 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');busy=true;try{return await api(path+suffix,options);}finally{busy=false;}};
  return Object.freeze({siteId,siteName,access:()=>run('/access',{method:'POST',body:'{}'}),invite:()=>run('/invitation',{method:'POST',body:'{}'}),openRegistration:()=>run('/access/registration',{method:'POST',body:'{}'}),rotate:()=>run('/access/rotate',{method:'POST',body:'{}'}),revoke:()=>run('/invitation',{method:'DELETE'})});
}
