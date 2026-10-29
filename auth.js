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

export class WorkerSessions extends Map {
  constructor(db,now=Date.now()){
    super();this.db=db;
    db.prepare('DELETE FROM worker_sessions WHERE expires<=?').run(now);
    const rows=db.prepare('SELECT s.token_hash,s.worker_id,s.expires,s.credential_hash,a.password_hash,w.name,w.site_id,t.name AS site_name FROM worker_sessions s JOIN worker_accounts a ON a.worker_id=s.worker_id JOIN workers w ON w.id=a.worker_id AND w.site_id=a.site_id JOIN sites t ON t.id=w.site_id').all();
    for(const row of rows){const version=createHash('sha256').update(row.password_hash).digest();if(row.credential_hash.length!==version.length||!timingSafeEqual(row.credential_hash,version)){db.prepare('DELETE FROM worker_sessions WHERE token_hash=?').run(row.token_hash);continue;}super.set(row.token_hash,{worker:{id:row.worker_id,name:row.name,site_id:row.site_id,site_name:row.site_name},expires:row.expires});}
  }
  set(key,session){
    const account=this.db.prepare('SELECT password_hash FROM worker_accounts WHERE worker_id=? AND site_id=?').get(session.worker.id,session.worker.site_id);if(!account)throw new Error('근로자 계정을 확인해 주세요.');
    const version=createHash('sha256').update(account.password_hash).digest();this.db.prepare('INSERT OR REPLACE INTO worker_sessions(token_hash,worker_id,expires,credential_hash) VALUES(?,?,?,?)').run(key,session.worker.id,session.expires,version);return super.set(key,session);
  }
  get(key){
    if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return undefined;
    const row=this.db.prepare('SELECT s.worker_id,s.expires,s.credential_hash,a.password_hash,w.name,w.site_id,t.name AS site_name FROM worker_sessions s JOIN worker_accounts a ON a.worker_id=s.worker_id JOIN workers w ON w.id=a.worker_id AND w.site_id=a.site_id JOIN sites t ON t.id=w.site_id WHERE s.token_hash=?').get(key);
    if(!row){super.delete(key);return undefined;}
    const version=createHash('sha256').update(row.password_hash).digest();if(row.expires<=Date.now()||row.credential_hash.length!==version.length||!timingSafeEqual(row.credential_hash,version)){this.delete(key);return undefined;}
    let session=super.get(key);if(!session||session.expires!==row.expires||session.worker.id!==row.worker_id||session.worker.site_id!==row.site_id){session={worker:{id:row.worker_id,name:row.name,site_id:row.site_id,site_name:row.site_name},expires:row.expires};super.set(key,session);}return session;
  }
  delete(key){if(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key))this.db.prepare('DELETE FROM worker_sessions WHERE token_hash=?').run(key);return super.delete(key);}
}
