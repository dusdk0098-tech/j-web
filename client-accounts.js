import { createHash,randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';

const loginPattern=/^[A-Za-z0-9_]{3,50}$/;
const tokenHash=token=>typeof token==='string'&&/^[\w-]{43}$/.test(token)?createHash('sha256').update(token).digest('hex'):'';
const credential=row=>createHash('sha256').update(row.password_hash).update(row.auth_version).digest();
const value=(input,label,max,required=true)=>{
  if(typeof input!=='string'||input.length>max||(required&&!input.trim()))throw new Error(label+'을 확인해 주세요.');
  return input.trim();
};
const passwordValue=password=>{
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('시험 암호는 12자 이상 256자 이하여야 합니다.');
  return password;
};

export class ClientAccounts {
  constructor(db,now=()=>Date.now()){
    this.db=db;this.now=now;this.failures=[];this.accountFailures=new Map();
    db.exec("CREATE TABLE IF NOT EXISTS client_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('company','individual')),business_number TEXT NOT NULL,login_id TEXT NOT NULL COLLATE NOCASE UNIQUE,salt BLOB NOT NULL,password_hash BLOB NOT NULL,email TEXT NOT NULL,business_name TEXT NOT NULL,name TEXT NOT NULL,position TEXT NOT NULL,phone TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version TEXT NOT NULL,auth_version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS client_sessions (token_hash TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES client_accounts(id),expires INTEGER NOT NULL,credential_hash BLOB NOT NULL)");
    db.prepare('DELETE FROM client_sessions WHERE expires<=?').run(now());
  }
  available(loginId){
    if(typeof loginId!=='string'||!loginPattern.test(loginId))throw new Error('시험 아이디를 확인해 주세요.');
    return !this.db.prepare('SELECT 1 FROM client_accounts WHERE login_id=?').get(loginId);
  }
  register(input){
    if(!input||!['company','individual'].includes(input.kind)||input.acknowledged!==true)throw new Error('가상 정보와 계정 구분을 확인해 주세요.');
    const loginId=value(input.loginId,'시험 아이디',50),password=passwordValue(input.password),businessNumber=value(input.businessNumber??'','사업자번호',10,false),businessName=value(input.businessName??'','상호',200,input.kind==='company'),name=value(input.name,'이름',200),position=value(input.position??'','직위',100,false),email=value(input.email,'이메일',200),phone=value(input.phone,'휴대전화',30);
    if(!loginPattern.test(loginId))throw new Error('시험 아이디를 확인해 주세요.');
    if(input.password!==input.confirmPassword)throw new Error('시험 암호 확인이 일치하지 않습니다.');
    if((input.kind==='company'&&!/^[0-9]{10}$/.test(businessNumber))||(businessNumber&&!/^[0-9]{10}$/.test(businessNumber)))throw new Error('가상 사업자번호는 숫자 10자리로 입력해 주세요.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[-+0-9 ]{7,30}$/.test(phone))throw new Error('가상 이메일과 휴대전화를 확인해 주세요.');
    const salt=randomBytes(16),hash=scryptSync(password,salt,32);
    this.db.exec('BEGIN IMMEDIATE');try{
      if(!this.available(loginId))throw new Error('이미 사용 중인 시험 아이디입니다.');
      const id=this.db.prepare("INSERT INTO client_accounts(kind,business_number,login_id,salt,password_hash,email,business_name,name,position,phone,version,auth_version) VALUES(?,?,?,?,?,?,?,?,?,?,lower(hex(randomblob(16))),lower(hex(randomblob(16))))").run(input.kind,businessNumber,loginId,salt,hash,email,businessName,name,position,phone).lastInsertRowid;
      this.db.exec('COMMIT');return {id:Number(id),loginId};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  login(loginId,password,oldToken=''){
    const now=this.now(),key=typeof loginId==='string'&&loginPattern.test(loginId)?loginId.toLowerCase():'invalid';
    this.failures=this.failures.filter(t=>t>now-300000);for(const [id,times] of this.accountFailures){const recent=times.filter(t=>t>now-300000);if(recent.length)this.accountFailures.set(id,recent);else this.accountFailures.delete(id);}
    const failures=this.accountFailures.get(key)||[];if(this.failures.length>=100||failures.length>=10)throw Object.assign(new Error('잠시 후 다시 로그인해 주세요.'),{sessionStatus:429});
    const row=key==='invalid'?null:this.db.prepare('SELECT id,salt,password_hash,auth_version,active FROM client_accounts WHERE login_id=?').get(loginId),candidate=typeof password==='string'&&password.length<=256?password:'',hash=scryptSync(candidate,row?.salt||Buffer.alloc(16),32),expected=row?.password_hash||Buffer.alloc(32);
    if(!row||!row.active||!timingSafeEqual(hash,expected)){this.failures.push(now);failures.push(now);this.accountFailures.set(key,failures);return null;}
    const raw=randomBytes(32).toString('base64url'),newKey=tokenHash(raw),oldKey=tokenHash(oldToken);
    this.db.exec('BEGIN IMMEDIATE');try{
      const current=this.db.prepare('SELECT id,password_hash,auth_version,active FROM client_accounts WHERE id=?').get(row.id);
      if(!current||!current.active||current.auth_version!==row.auth_version||current.password_hash.length!==row.password_hash.length||!timingSafeEqual(current.password_hash,row.password_hash)){this.db.exec('ROLLBACK');return null;}
      if(oldKey)this.db.prepare('DELETE FROM client_sessions WHERE token_hash=?').run(oldKey);
      this.db.prepare('INSERT INTO client_sessions(token_hash,client_id,expires,credential_hash) VALUES(?,?,?,?)').run(newKey,current.id,now+28800000,credential(current));
      this.db.exec('COMMIT');this.accountFailures.delete(key);return raw;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  session(token){
    const key=tokenHash(token);if(!key)return null;
    const row=this.db.prepare('SELECT c.*,s.expires,s.credential_hash FROM client_sessions s JOIN client_accounts c ON c.id=s.client_id WHERE s.token_hash=?').get(key);
    if(!row)return null;const expected=credential(row);
    if(!row.active||row.expires<=this.now()||row.credential_hash.length!==expected.length||!timingSafeEqual(row.credential_hash,expected)){this.db.prepare('DELETE FROM client_sessions WHERE token_hash=?').run(key);return null;}
    return {id:row.id,kind:row.kind,businessNumber:row.business_number,loginId:row.login_id,email:row.email,businessName:row.business_name,name:row.name,position:row.position,phone:row.phone};
  }
  logout(token){const key=tokenHash(token);if(key)this.db.prepare('DELETE FROM client_sessions WHERE token_hash=?').run(key);}
  list(){return this.db.prepare('SELECT id,kind,login_id,name,business_name,active,version,created_at FROM client_accounts ORDER BY id DESC').all();}
  update(id,input,authorize=()=>{}){
    if(!input||typeof input.version!=='string'||(input.active===undefined&&input.password===undefined)||(input.active!==undefined&&typeof input.active!=='boolean'))throw new Error('변경할 시험 계정 정보를 확인해 주세요.');
    let salt=null,hash=null;if(input.password!==undefined){salt=randomBytes(16);hash=scryptSync(passwordValue(input.password),salt,32);}
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();const account=this.db.prepare('SELECT * FROM client_accounts WHERE id=?').get(Number(id));if(!account)throw new Error('시험 계정을 확인해 주세요.');if(account.version!==input.version)throw Object.assign(new Error('시험 계정이 변경되었습니다. 다시 조회해 주세요.'),{sessionStatus:409});
      const active=input.active===undefined?account.active:(input.active?1:0),rotate=hash!==null||active===0;
      this.db.prepare("UPDATE client_accounts SET active=?,salt=?,password_hash=?,auth_version=CASE WHEN ? THEN lower(hex(randomblob(16))) ELSE auth_version END,version=lower(hex(randomblob(16))) WHERE id=?").run(active,salt||account.salt,hash||account.password_hash,rotate?1:0,account.id);
      if(rotate)this.db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(account.id);
      const result=this.db.prepare('SELECT id,kind,login_id,name,business_name,active,version,created_at FROM client_accounts WHERE id=?').get(account.id);this.db.exec('COMMIT');if(hash)this.accountFailures.delete(account.login_id.toLowerCase());return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
