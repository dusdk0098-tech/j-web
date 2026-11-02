const storageKey='jweb.worker.remembered';
const identityStorageKey='jweb.worker.identity';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_]{3,40}$/.test(value);
const validIdentity=value=>value&&typeof value.name==='string'&&!!value.name.trim()&&value.name.length<=200&&!/[\x00-\x1f\x7f]/.test(value.name)&&typeof value.birthDigits==='string'&&/^\d{6}$/.test(value.birthDigits);
async function fingerprint(siteKey,cryptoApi){
  if(typeof siteKey!=='string'||!/^[\w-]{43}$/.test(siteKey)||!cryptoApi?.subtle)throw Error('현장 아이디 저장을 사용할 수 없습니다.');
  const bytes=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(siteKey)));return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function rememberWorker(storage,cryptoApi=globalThis.crypto){
  if(!storage)throw Error('아이디 저장을 사용할 수 없습니다.');
  const fingerprints=new Map(),getFingerprint=async key=>{const known=fingerprints.get(key);if(known)return known;const value=await fingerprint(key,cryptoApi);fingerprints.set(key,value);return value;};
  const read=()=>{const raw=storage.getItem(storageKey);if(!raw)return null;try{const value=JSON.parse(raw);return value&&typeof value.site==='string'&&/^[0-9a-f]{64}$/.test(value.site)&&validId(value.loginId)?value:null;}catch{return null;}};
  const readIdentity=()=>{const raw=storage.getItem(identityStorageKey);if(!raw)return null;try{const value=JSON.parse(raw);return value&&typeof value.site==='string'&&/^[0-9a-f]{64}$/.test(value.site)&&validIdentity(value)?value:null;}catch{return null;}};
  return {
    async load(siteKey){const saved=read();if(!saved)return null;return saved.site===await getFingerprint(siteKey)?saved.loginId:null;},
    async save(siteKey,loginId,allowed=()=>true){if(!validId(loginId))throw Error('시험 아이디를 확인해 주세요.');const site=await getFingerprint(siteKey);if(allowed())storage.setItem(storageKey,JSON.stringify({site,loginId}));},
    async clear(siteKey,allowed=()=>true){const saved=read();if(!saved)return;const site=fingerprints.get(siteKey)||await getFingerprint(siteKey);if(saved.site!==site||!allowed())return;const current=read();if(current&&current.site===saved.site&&current.loginId===saved.loginId)storage.removeItem(storageKey);},
    clearAll(){storage.removeItem(storageKey);},
    async loadIdentity(siteKey){const saved=readIdentity();if(!saved||saved.site!==await getFingerprint(siteKey))return null;return {name:saved.name,birthDigits:saved.birthDigits};},
    async saveIdentity(siteKey,identity,allowed=()=>true){if(!validIdentity(identity))throw Error('이름과 생년월일을 확인해 주세요.');const site=await getFingerprint(siteKey);if(allowed())storage.setItem(identityStorageKey,JSON.stringify({site,name:identity.name.trim(),birthDigits:identity.birthDigits}));},
    async clearIdentity(siteKey,allowed=()=>true){const saved=readIdentity();if(!saved)return;const site=fingerprints.get(siteKey)||await getFingerprint(siteKey);if(saved.site!==site||!allowed())return;const current=readIdentity();if(current&&current.site===saved.site&&current.name===saved.name&&current.birthDigits===saved.birthDigits)storage.removeItem(identityStorageKey);},
    clearIdentityAll(){storage.removeItem(identityStorageKey);}
  };
}
