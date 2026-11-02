import { createHash, randomBytes } from 'node:crypto';
import { LoginFailures } from './login-failures.js';
import { passwordHash, passwordSalt, withPasswordHashes } from './password-hashing.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const tokenKey=value=>typeof value==='string'&&/^[\w-]{43}$/.test(value)?hash(value):'';
const emailValid=value=>typeof value==='string'&&value.length<=200&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const invalidLink=()=>Object.assign(Error('확인 링크가 만료되었거나 사용할 수 없습니다.'),{sessionStatus:400});
const unavailable=()=>Object.assign(Error('이메일 전달 설정을 확인해 주세요.'),{sessionStatus:503});

export function recoveryDelivery(env=process.env,fetcher=fetch){
  const address=env.JWEB_RECOVERY_DELIVERY_URL,secret=env.JWEB_RECOVERY_DELIVERY_TOKEN;
  if(!address&&!secret)return null;
  if(!address||typeof secret!=='string'||!/^[\x21-\x7e]{16,256}$/.test(secret))throw unavailable();
  let url;try{url=new URL(address);}catch{throw unavailable();}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||(url.protocol==='http:'&&local)))throw unavailable();
  return {local,async send(message){
    const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','authorization':`Bearer ${secret}`},body:JSON.stringify(message)});
    if(response.body)await response.body.cancel();
    if(!response.ok)throw unavailable();
  }};
}

export class ReviewerRecovery {
  constructor(db,profiles,delivery,now=Date.now){
    this.db=db;this.profiles=profiles;this.delivery=delivery;this.now=now;this.inflight=0;
    this.sendLimits=new LoginFailures();this.requestLimits=new LoginFailures();this.redeemLimits=new LoginFailures();
    db.exec(`CREATE TABLE IF NOT EXISTS reviewer_recovery (
      reviewer_id INTEGER PRIMARY KEY REFERENCES reviewers(id) ON DELETE CASCADE,verified_email TEXT UNIQUE,
      verify_hash TEXT UNIQUE,verify_email TEXT,verify_auth TEXT,verify_expires INTEGER,
      reset_hash TEXT UNIQUE,reset_auth TEXT,reset_expires INTEGER,last_request INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS reviewer_recovery_email_update AFTER UPDATE OF email ON reviewer_profiles
      WHEN NEW.email<>OLD.email BEGIN DELETE FROM reviewer_recovery WHERE reviewer_id=NEW.reviewer_id; END;
    CREATE TRIGGER IF NOT EXISTS reviewer_recovery_email_delete AFTER DELETE ON reviewer_profiles
      BEGIN DELETE FROM reviewer_recovery WHERE reviewer_id=OLD.reviewer_id; END;
    CREATE TRIGGER IF NOT EXISTS reviewer_recovery_auth_update AFTER UPDATE OF auth_version,active ON reviewers
      WHEN NEW.auth_version<>OLD.auth_version OR NEW.active<>OLD.active BEGIN DELETE FROM reviewer_recovery WHERE reviewer_id=NEW.id; END;`);
  }
  transaction(fn,authorize=()=>{}){this.db.exec('BEGIN IMMEDIATE');try{authorize();const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  limit(limiter,peer,key){const now=this.now();limiter.record(peer,key,now);}
  status(id){
    const row=this.db.prepare('SELECT p.email,c.verified_email FROM reviewer_profiles p LEFT JOIN reviewer_recovery c ON c.reviewer_id=p.reviewer_id WHERE p.reviewer_id=?').get(Number(id));
    return {enabled:!!this.delivery,verified:!!row?.email&&row.email===row.verified_email};
  }
  async deliver(message){
    if(!this.delivery)throw unavailable();if(this.inflight>=4)throw Object.assign(Error('전송 요청이 많습니다. 잠시 후 다시 시도해 주세요.'),{sessionStatus:503});
    this.inflight++;try{await this.delivery.send(message);}finally{this.inflight--;}
  }
  async startVerification(id,version,peer,origin,authorize=()=>{}){
    if(!this.delivery)throw unavailable();this.limit(this.sendLimits,peer,String(id));
    const raw=token(),key=hash(raw),now=this.now();
    const email=this.transaction(()=>{
      const current=this.profiles.get(id),row=this.db.prepare('SELECT auth_version FROM reviewers WHERE id=? AND active=1').get(Number(id));
      if(current.version!==version)throw Object.assign(Error('직원 정보가 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});
      const address=current.profile.email;if(!row||!emailValid(address))throw Error('내 정보에 이메일을 저장한 뒤 다시 시도해 주세요.');
      this.db.prepare(`INSERT INTO reviewer_recovery(reviewer_id,verify_hash,verify_email,verify_auth,verify_expires) VALUES(?,?,?,?,?)
        ON CONFLICT(reviewer_id) DO UPDATE SET verify_hash=excluded.verify_hash,verify_email=excluded.verify_email,verify_auth=excluded.verify_auth,verify_expires=excluded.verify_expires`).run(Number(id),key,address,row.auth_version,now+15*60*1000);
      return address;
    },authorize);
    try{await this.deliver({to:email,subject:'J웹 이메일 확인',text:`다음 링크에서 이메일을 확인해 주세요. 15분 동안 유효합니다.\n${origin}/review-recovery#verify=${raw}`});}
    catch{throw Object.assign(Error('전송 결과를 확인할 수 없습니다. 이메일을 확인한 뒤 다시 시도해 주세요.'),{sessionStatus:503});}
    return {ok:true};
  }
  verify(raw,peer){
    const key=tokenKey(raw);this.limit(this.redeemLimits,peer,key||'invalid');if(!key)throw invalidLink();const now=this.now();
    return this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.active,r.auth_version,p.email FROM reviewer_recovery c JOIN reviewers r ON r.id=c.reviewer_id JOIN reviewer_profiles p ON p.reviewer_id=c.reviewer_id WHERE c.verify_hash=?`).get(key);
      if(!row||!row.active||row.verify_expires<=now||row.verify_auth!==row.auth_version||row.verify_email!==row.email)throw invalidLink();
      if(this.db.prepare('SELECT 1 FROM reviewer_recovery WHERE verified_email=? AND reviewer_id<>?').get(row.email,row.reviewer_id))throw Object.assign(Error('이미 확인된 이메일입니다. 관리자에게 문의해 주세요.'),{sessionStatus:409});
      this.db.prepare('UPDATE reviewer_recovery SET verified_email=?,verify_hash=NULL,verify_email=NULL,verify_auth=NULL,verify_expires=NULL,reset_hash=NULL,reset_auth=NULL,reset_expires=NULL,last_request=0 WHERE reviewer_id=?').run(row.email,row.reviewer_id);
      return {ok:true};
    });
  }
  prepareRequest(input,peer,origin){
    if(!this.delivery)throw unavailable();
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||!emailValid(input.email))throw Error('이름과 이메일을 확인해 주세요.');
    const email=input.email.trim(),name=input.name.trim(),now=this.now();this.limit(this.requestLimits,peer,hash(email));
    const raw=token(),key=hash(raw);
    return this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.name,r.login_id,r.active,r.auth_version,p.email FROM reviewer_recovery c JOIN reviewers r ON r.id=c.reviewer_id JOIN reviewer_profiles p ON p.reviewer_id=c.reviewer_id WHERE c.verified_email=? AND p.email=c.verified_email AND r.name=? AND r.active=1`).get(email,name);
      if(!row||(row.last_request&&now-row.last_request<60000))return null;
      this.db.prepare('UPDATE reviewer_recovery SET reset_hash=?,reset_auth=?,reset_expires=?,last_request=? WHERE reviewer_id=?').run(key,row.auth_version,now+15*60*1000,now,row.reviewer_id);
      return {to:email,subject:'J웹 계정 찾기',text:`시험 아이디: ${row.login_id}\n암호를 바꾸려면 다음 링크를 열어 주세요. 15분 동안 유효합니다.\n${origin}/review-recovery#reset=${raw}`};
    });
  }
  queue(message){if(message)setImmediate(()=>{this.deliver(message).catch(()=>{});});}
  async reset(input,peer){
    const key=tokenKey(input?.token);this.limit(this.redeemLimits,peer,key||'invalid');
    if(!key)throw invalidLink();if(typeof input.password!=='string'||input.password.length<12||input.password.length>256||input.password!==input.confirmPassword)throw Error('새 암호와 확인은 같아야 하며 12자 이상 256자 이하여야 합니다.');
    return withPasswordHashes(peer,[{password:input.password}],()=>this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.active,r.auth_version,r.login_id,p.email FROM reviewer_recovery c JOIN reviewers r ON r.id=c.reviewer_id JOIN reviewer_profiles p ON p.reviewer_id=c.reviewer_id WHERE c.reset_hash=?`).get(key);
      if(!row||!row.active||row.reset_expires<=this.now()||row.reset_auth!==row.auth_version||!row.verified_email||row.email!==row.verified_email)throw invalidLink();
      const salt=passwordSalt(input.password),password=passwordHash(input.password,salt,32),email=row.email;
      this.db.prepare('UPDATE reviewers SET salt=?,password_hash=?,auth_version=lower(hex(randomblob(16))) WHERE id=?').run(salt,password,row.reviewer_id);
      this.db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(row.reviewer_id);
      return {email,loginId:row.login_id};
    }));
  }
}
