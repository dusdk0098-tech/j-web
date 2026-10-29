import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export class LocalAuth {
  constructor(password) {
    if(typeof password!=='string' || password.length<12 || password.length>256) throw new Error('관리자 암호는 12자 이상 256자 이하여야 합니다.');
    this.salt=randomBytes(16);this.hash=scryptSync(password,this.salt,32);this.sessions=new Map();this.failures=[];
  }
  login(password, now=Date.now()) {
    this.failures=this.failures.filter(t=>t>now-5*60*1000);
    if(this.failures.length>=10) return null;
    const candidate=typeof password==='string' && password.length<=256?password:'';
    const hash=scryptSync(candidate,this.salt,32);
    if(!timingSafeEqual(hash,this.hash)){this.failures.push(now);return null;}
    this.failures=[];
    const token=randomBytes(32).toString('base64url');
    this.sessions.set(createHash('sha256').update(token).digest('hex'),now+8*60*60*1000);
    return token;
  }
  valid(token,now=Date.now()) {
    if(typeof token!=='string' || !/^[\w-]{43}$/.test(token))return false;
    const key=createHash('sha256').update(token).digest('hex'),expiry=this.sessions.get(key);
    if(!expiry || expiry<=now){this.sessions.delete(key);return false;}
    return true;
  }
  logout(token){if(typeof token==='string')this.sessions.delete(createHash('sha256').update(token).digest('hex'));}
}

export function sessionToken(cookie='') {
  return cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('jweb_session='))?.slice(13) || '';
}
