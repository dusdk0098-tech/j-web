const storageKey='jweb.worker.remembered';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_]{3,40}$/.test(value);
async function fingerprint(siteKey,cryptoApi){
  if(typeof siteKey!=='string'||!/^[\w-]{43}$/.test(siteKey)||!cryptoApi?.subtle)throw Error('현장 아이디 저장을 사용할 수 없습니다.');
  const bytes=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(siteKey)));return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function rememberWorker(storage,cryptoApi=globalThis.crypto){
  if(!storage)throw Error('아이디 저장을 사용할 수 없습니다.');
  const read=()=>{const raw=storage.getItem(storageKey);if(!raw)return null;try{const value=JSON.parse(raw);return value&&typeof value.site==='string'&&/^[0-9a-f]{64}$/.test(value.site)&&validId(value.loginId)?value:null;}catch{return null;}};
  return {
    async load(siteKey){const saved=read();if(!saved)return null;return saved.site===await fingerprint(siteKey,cryptoApi)?saved.loginId:null;},
    async save(siteKey,loginId,allowed=()=>true){if(!validId(loginId))throw Error('시험 아이디를 확인해 주세요.');const site=await fingerprint(siteKey,cryptoApi);if(allowed())storage.setItem(storageKey,JSON.stringify({site,loginId}));},
    async clear(siteKey,allowed=()=>true){const saved=read();if(!saved||saved.site!==await fingerprint(siteKey,cryptoApi)||!allowed())return;const current=read();if(current&&current.site===saved.site&&current.loginId===saved.loginId)storage.removeItem(storageKey);},
    clearAll(){storage.removeItem(storageKey);}
  };
}
