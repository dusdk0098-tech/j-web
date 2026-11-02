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
  constructor(db,profiles,delivery,now=Date.now,kind='reviewer'){
    this.db=db;this.profiles=profiles;this.delivery=delivery;this.now=now;this.inflight=0;this.client=kind==='client';
    this.table=this.client?'client_recovery':'reviewer_recovery';this.key=this.client?'client_id':'reviewer_id';this.accounts=this.client?'client_accounts':'reviewers';this.sessions=this.client?'client_sessions':'reviewer_sessions';this.join=this.client?'':'JOIN reviewer_profiles p ON p.reviewer_id=c.reviewer_id';this.email=this.client?'r.email':'p.email';this.path=this.client?'/client-recovery':'/review-recovery';
    this.sendLimits=new LoginFailures();this.requestLimits=new LoginFailures();this.redeemLimits=new LoginFailures();
    db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (
      ${this.key} INTEGER PRIMARY KEY REFERENCES ${this.accounts}(id) ON DELETE CASCADE,verified_email TEXT UNIQUE,
      verify_hash TEXT UNIQUE,verify_email TEXT,verify_auth TEXT,verify_expires INTEGER,
      reset_hash TEXT UNIQUE,reset_auth TEXT,reset_expires INTEGER,last_request INTEGER NOT NULL DEFAULT 0
    );`);
    if(this.client)db.exec(`CREATE TRIGGER IF NOT EXISTS client_recovery_account_update AFTER UPDATE OF auth_version,active,email ON client_accounts
      WHEN NEW.auth_version<>OLD.auth_version OR NEW.active<>OLD.active OR NEW.email<>OLD.email BEGIN DELETE FROM client_recovery WHERE client_id=NEW.id; END;`);
    else db.exec(`
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
    const row=this.client?this.db.prepare('SELECT r.id,r.version,r.email,c.verified_email FROM client_accounts r LEFT JOIN client_recovery c ON c.client_id=r.id WHERE r.id=? AND r.active=1').get(Number(id)):this.db.prepare('SELECT p.email,c.verified_email FROM reviewer_profiles p LEFT JOIN reviewer_recovery c ON c.reviewer_id=p.reviewer_id WHERE p.reviewer_id=?').get(Number(id));
    if(this.client&&!row)throw Error('활성 발주처 계정을 확인해 주세요.');
    return {enabled:!!this.delivery,verified:!!row?.email&&row.email===row.verified_email,...(this.client?{clientId:row.id,version:row.version}:{})};
  }
  async deliver(message){
    if(!this.delivery)throw unavailable();if(this.inflight>=4)throw Object.assign(Error('전송 요청이 많습니다. 잠시 후 다시 시도해 주세요.'),{sessionStatus:503});
    this.inflight++;try{await this.delivery.send(message);}finally{this.inflight--;}
  }
  async startVerification(id,version,peer,origin,authorize=()=>{}){
    if(!this.delivery)throw unavailable();this.limit(this.sendLimits,peer,String(id));
    const raw=token(),key=hash(raw),now=this.now();
    const email=this.transaction(()=>{
      const row=this.db.prepare(`SELECT auth_version${this.client?',email,version':''} FROM ${this.accounts} WHERE id=? AND active=1`).get(Number(id));if(!row)throw Error('활성 계정을 확인해 주세요.');
      const current=this.client?{version:row.version,profile:{email:row.email}}:this.profiles.get(id);
      if(current.version!==version)throw Object.assign(Error('계정 정보가 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});
      const address=current.profile.email;if(!emailValid(address))throw Error('내 정보에 이메일을 저장한 뒤 다시 시도해 주세요.');
      this.db.prepare(`INSERT INTO ${this.table}(${this.key},verify_hash,verify_email,verify_auth,verify_expires) VALUES(?,?,?,?,?)
        ON CONFLICT(${this.key}) DO UPDATE SET verify_hash=excluded.verify_hash,verify_email=excluded.verify_email,verify_auth=excluded.verify_auth,verify_expires=excluded.verify_expires`).run(Number(id),key,address,row.auth_version,now+15*60*1000);
      return address;
    },authorize);
    try{await this.deliver({to:email,subject:'J웹 이메일 확인',text:`다음 링크에서 이메일을 확인해 주세요. 15분 동안 유효합니다.\n${origin}${this.path}#verify=${raw}`});}
    catch{throw Object.assign(Error('전송 결과를 확인할 수 없습니다. 이메일을 확인한 뒤 다시 시도해 주세요.'),{sessionStatus:503});}
    return {ok:true};
  }
  verify(raw,peer){
    const key=tokenKey(raw);this.limit(this.redeemLimits,peer,key||'invalid');if(!key)throw invalidLink();const now=this.now();
    return this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.active,r.auth_version,${this.email} AS email FROM ${this.table} c JOIN ${this.accounts} r ON r.id=c.${this.key} ${this.join} WHERE c.verify_hash=?`).get(key);
      if(!row||!row.active||row.verify_expires<=now||row.verify_auth!==row.auth_version||row.verify_email!==row.email)throw invalidLink();
      if(this.db.prepare(`SELECT 1 FROM ${this.table} WHERE verified_email=? AND ${this.key}<>?`).get(row.email,row[this.key]))throw Object.assign(Error('이미 확인된 이메일입니다. 관리자에게 문의해 주세요.'),{sessionStatus:409});
      this.db.prepare(`UPDATE ${this.table} SET verified_email=?,verify_hash=NULL,verify_email=NULL,verify_auth=NULL,verify_expires=NULL,reset_hash=NULL,reset_auth=NULL,reset_expires=NULL,last_request=0 WHERE ${this.key}=?`).run(row.email,row[this.key]);
      return {ok:true};
    });
  }
  prepareRequest(input,peer,origin){
    if(!this.delivery)throw unavailable();
    if(!input||!emailValid(input.email))throw Error('계정 찾기 정보를 확인해 주세요.');
    const identity=this.client?input.identity:input.name,phone=this.client&&typeof input.phone==='string'?input.phone.replace(/[ +\-]/g,''):'';
    if(typeof identity!=='string'||!identity.trim()||identity.length>200||(this.client&&(!['id','password'].includes(input.mode)||!/^[-+0-9 ]{7,30}$/.test(input.phone)||!/^\d{7,30}$/.test(phone))))throw Error('계정 찾기 정보를 확인해 주세요.');
    const email=input.email.trim(),name=identity.trim(),now=this.now();this.limit(this.requestLimits,peer,hash(email));
    const raw=token(),key=hash(raw);
    return this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.name,r.login_id,r.active,r.auth_version,${this.email} AS email${this.client?',r.phone':''} FROM ${this.table} c JOIN ${this.accounts} r ON r.id=c.${this.key} ${this.join} WHERE c.verified_email=? AND ${this.email}=c.verified_email AND r.active=1`).get(email);
      if(!row||(row.last_request&&now-row.last_request<60000))return null;
      if(this.client?(row.phone.replace(/[ +\-]/g,'')!==phone||(input.mode==='id'?row.name!==name:row.login_id.toLowerCase()!==name.toLowerCase())):row.name!==name)return null;
      this.db.prepare(`UPDATE ${this.table} SET reset_hash=?,reset_auth=?,reset_expires=?,last_request=? WHERE ${this.key}=?`).run(key,row.auth_version,now+15*60*1000,now,row[this.key]);
      return {to:email,subject:'J웹 계정 찾기',text:`시험 아이디: ${row.login_id}\n암호를 바꾸려면 다음 링크를 열어 주세요. 15분 동안 유효합니다.\n${origin}${this.path}#reset=${raw}`};
    });
  }
  queue(message){if(message)setImmediate(()=>{this.deliver(message).catch(()=>{});});}
  async reset(input,peer){
    const key=tokenKey(input?.token);this.limit(this.redeemLimits,peer,key||'invalid');
    if(!key)throw invalidLink();if(typeof input.password!=='string'||input.password.length<12||input.password.length>256||input.password!==input.confirmPassword)throw Error('새 암호와 확인은 같아야 하며 12자 이상 256자 이하여야 합니다.');
    return withPasswordHashes(peer,[{password:input.password}],()=>this.transaction(()=>{
      const row=this.db.prepare(`SELECT c.*,r.active,r.auth_version,r.login_id,${this.email} AS email FROM ${this.table} c JOIN ${this.accounts} r ON r.id=c.${this.key} ${this.join} WHERE c.reset_hash=?`).get(key);
      if(!row||!row.active||row.reset_expires<=this.now()||row.reset_auth!==row.auth_version||!row.verified_email||row.email!==row.verified_email)throw invalidLink();
      const salt=passwordSalt(input.password),password=passwordHash(input.password,salt,32),email=row.email;
      this.db.prepare(`UPDATE ${this.accounts} SET salt=?,password_hash=?,auth_version=lower(hex(randomblob(16)))${this.client?',version=lower(hex(randomblob(16)))':''} WHERE id=?`).run(salt,password,row[this.key]);
      this.db.prepare(`DELETE FROM ${this.sessions} WHERE ${this.key}=?`).run(row[this.key]);
      return {email,loginId:row.login_id};
    }));
  }
}

export class ClientRecovery extends ReviewerRecovery {
  constructor(db,delivery,now=Date.now){super(db,null,delivery,now,'client');}
}
