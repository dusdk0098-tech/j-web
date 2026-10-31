export function workerSitePath(key) {
  return typeof key==='string' && /^[\w-]{43}$/.test(key) ? `/join?site=${encodeURIComponent(key)}` : null;
}
export function replaceWorkerSiteAddress(key,browserHistory) {
  const path=workerSitePath(key);if(!path)return false;
  try{browserHistory.replaceState(browserHistory.state,'',path);return true;}catch{return false;}
}
export function workerJoinCredentials(params,siteKey) {
  return params.get('site') ? {siteKey} : {token:params.get('token')};
}
