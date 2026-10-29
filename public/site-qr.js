export function siteQrSession(siteId,siteName,api){
  if(!Number.isSafeInteger(siteId)||siteId<1||typeof siteName!=='string'||!siteName.trim()||typeof api!=='function')throw Error('현장을 확인해 주세요.');
  const path=`/api/sites/${siteId}`;
  return Object.freeze({siteId,siteName,access:()=>api(`${path}/access`,{method:'POST',body:'{}'}),invite:()=>api(`${path}/invitation`,{method:'POST',body:'{}'}),openRegistration:()=>api(`${path}/access/registration`,{method:'POST',body:'{}'}),rotate:()=>api(`${path}/access/rotate`,{method:'POST',body:'{}'}),revoke:()=>api(`${path}/invitation`,{method:'DELETE'})});
}
