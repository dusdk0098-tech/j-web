import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, scrypt, scryptSync } from 'node:crypto';

// HTTP 요청은 준비되지 않은 동기 계산으로 되돌아갈 수 없다.
export const passwordRequests = new AsyncLocalStorage();
const prepared = new AsyncLocalStorage();
let active = 0;
const peers = new Set();
const changed = () => Object.assign(new Error('인증 정보가 변경되었습니다. 다시 시도해 주세요.'), { sessionStatus: 409 });
export const passwordCandidate = value => typeof value === 'string' && value.length <= 256 ? value : '';
export function assertPasswordAccount(before, after) {
  if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) throw Object.assign(changed(), { sessionStatus: 401 });
}

export function passwordSalt(password) {
  const item = prepared.getStore()?.find(item => item.fresh && item.password === password);
  if (item) return item.salt;
  if (passwordRequests.getStore()) throw changed();
  return randomBytes(16);
}

export function passwordHash(password, salt, length = 32) {
  const item = prepared.getStore()?.find(item => item.password === password && item.salt.equals(salt));
  if (item && length === 32) return item.hash;
  if (passwordRequests.getStore()) throw changed();
  return scryptSync(password, salt, length);
}

export async function withPasswordHashes(peer, inputs, commit) {
  if (typeof peer !== 'string' || !peer || peer.length > 64) throw Object.assign(new Error('로그인 중계 설정을 확인해 주세요.'), { sessionStatus: 503 });
  if (active >= 2 || peers.has(peer)) throw Object.assign(new Error('암호 확인 요청이 많습니다. 잠시 후 다시 시도해 주세요.'), { sessionStatus: 503, retryAfter: 1 });
  active++; peers.add(peer);
  try {
    const items = [];
    for (const input of inputs) {
      const password = passwordCandidate(input.password), salt = input.salt ? Buffer.from(input.salt) : randomBytes(16);
      const hash = await new Promise((resolve, reject) => scrypt(password, salt, 32, (error, value) => error ? reject(error) : resolve(value)));
      items.push({ password, salt, hash, fresh: !input.salt });
    }
    const result = passwordRequests.run(true, () => prepared.run(items, commit));
    if (result && typeof result.then === 'function') throw new Error('암호 처리 후 저장은 동기 함수여야 합니다.');
    return result;
  } finally { active--; peers.delete(peer); }
}
