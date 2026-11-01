import { createHash,randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';

const loginPattern=/^[A-Za-z0-9_]{3,50}$/;
const tokenHash=token=>typeof token==='string'&&/^[\w-]{43}$/.test(token)?createHash('sha256').update(token).digest('hex'):'';
const credential=row=>createHash('sha256').update(row.password_hash).update(row.auth_version).digest();
const value=(input,label,max,required=true)=>{
  if(typeof input!=='string'||input.length>max||(required&&!input.trim()))throw new Error(label+'을 확인해 주세요.');
  return input.trim();
};
const passwordValue=password=>{
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('관리자 암호는 12자 이상 256자 이하여야 합니다.');
  return password;
};

export class AdminAccounts {
  constructor(db,now=()=>Date.now()){
    this.db=db;this.now=now;this.failures=[];this.accountFailures=new Map();
    db.exec("CREATE TABLE IF NOT EXISTS admin_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,login_id TEXT NOT NULL COLLATE NOCASE UNIQUE,salt BLOB NOT NULL,password_hash BLOB NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version TEXT NOT NULL,auth_version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES admin_accounts(id),expires INTEGER NOT NULL,credential_hash BLOB NOT NULL)");
    db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(now());
  }
  available(loginId){
    if(typeof loginId!=='string'||!loginPattern.test(loginId))throw new Error('관리자 아이디를 확인해 주세요.');
    return !this.db.prepare('SELECT 1 FROM admin_accounts WHERE login_id=?').get(loginId);
  }
  bootstrap(password){
    if(this.db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get())return;
    this.create({loginId:'admin',name:'최초 관리자',password},()=>{},true);
  }
  create(input,authorize=()=>{},bootstrap=false){
    const loginId=value(input.loginId,'관리자 아이디',50),name=value(input.name,'이름',200),password=passwordValue(input.password);
    if(!loginPattern.test(loginId))throw Error('관리자 아이디는 영문·숫자·밑줄 3~50자입니다.');
    const salt=randomBytes(16),hash=scryptSync(password,salt,32);
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();
      if(bootstrap&&this.db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get()){this.db.exec('COMMIT');return;}
      if(!this.available(loginId))throw Error('이미 사용 중인 관리자 아이디입니다.');
      const id=this.db.prepare("INSERT INTO admin_accounts(login_id,name,salt,password_hash,version,auth_version) VALUES(?,?,?,?,lower(hex(randomblob(16))),lower(hex(randomblob(16))))").run(loginId,name,salt,hash).lastInsertRowid;
      this.db.exec('COMMIT');return this.list().find(row=>row.id===Number(id));
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  valid(token,now=this.now()){return !!this.session(token,now);}
  context(token){return this.valid(token)?createHash('sha256').update('admin-context:'+token).digest('hex'):null;}
  login(loginId,password,oldToken=''){
    loginId=loginId===undefined?'admin':loginId;
    const now=this.now(),key=typeof loginId==='string'&&loginPattern.test(loginId)?loginId.toLowerCase():'invalid';
    this.failures=this.failures.filter(t=>t>now-300000);for(const [id,times] of this.accountFailures){const recent=times.filter(t=>t>now-300000);if(recent.length)this.accountFailures.set(id,recent);else this.accountFailures.delete(id);}
    const failures=this.accountFailures.get(key)||[];if(this.failures.length>=100||failures.length>=10)throw Object.assign(new Error('잠시 후 다시 로그인해 주세요.'),{sessionStatus:429});
    const row=key==='invalid'?null:this.db.prepare('SELECT id,salt,password_hash,auth_version,active FROM admin_accounts WHERE login_id=?').get(loginId),candidate=typeof password==='string'&&password.length<=256?password:'',hash=scryptSync(candidate,row?.salt||Buffer.alloc(16),32),expected=row?.password_hash||Buffer.alloc(32);
    if(!row||!row.active||!timingSafeEqual(hash,expected)){this.failures.push(now);failures.push(now);this.accountFailures.set(key,failures);return null;}
    const raw=randomBytes(32).toString('base64url'),newKey=tokenHash(raw),oldKey=tokenHash(oldToken);
    this.db.exec('BEGIN IMMEDIATE');try{
      const current=this.db.prepare('SELECT id,password_hash,auth_version,active FROM admin_accounts WHERE id=?').get(row.id);
      if(!current||!current.active||current.auth_version!==row.auth_version||current.password_hash.length!==row.password_hash.length||!timingSafeEqual(current.password_hash,row.password_hash)){this.db.exec('ROLLBACK');return null;}
      if(oldKey)this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(oldKey);
      this.db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,expires,credential_hash) VALUES(?,?,?,?)').run(newKey,current.id,now+28800000,credential(current));
      this.db.exec('COMMIT');this.accountFailures.delete(key);return raw;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  session(token,now=this.now()){
    const key=tokenHash(token);if(!key)return null;
    const row=this.db.prepare('SELECT c.*,s.expires,s.credential_hash FROM admin_sessions s JOIN admin_accounts c ON c.id=s.admin_id WHERE s.token_hash=?').get(key);
    if(!row)return null;const expected=credential(row);
    if(!row.active||row.expires<=now||row.credential_hash.length!==expected.length||!timingSafeEqual(row.credential_hash,expected)){this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(key);return null;}
    return {id:row.id,loginId:row.login_id,name:row.name};
  }
  logout(token){const key=tokenHash(token);if(key)this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(key);}
  list(){return this.db.prepare('SELECT id,login_id,name,active,version,created_at FROM admin_accounts ORDER BY id DESC').all();}
  update(id,input,authorize=()=>{}){
    if(!input||typeof input.version!=='string'||(input.active===undefined&&input.password===undefined&&input.name===undefined&&input.revoke!==true)||(input.active!==undefined&&typeof input.active!=='boolean'))throw new Error('변경할 관리자 계정 정보를 확인해 주세요.');
    const name=input.name===undefined?null:value(input.name,'이름',200);
    let salt=null,hash=null;if(input.password!==undefined){salt=randomBytes(16);hash=scryptSync(passwordValue(input.password),salt,32);}
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();const account=this.db.prepare('SELECT * FROM admin_accounts WHERE id=?').get(Number(id));if(!account)throw new Error('관리자 계정을 확인해 주세요.');if(account.version!==input.version)throw Object.assign(new Error('관리자 계정이 변경되었습니다. 다시 조회해 주세요.'),{sessionStatus:409});
      const active=input.active===undefined?account.active:(input.active?1:0),rotate=hash!==null||active===0||input.revoke===true;
      if(!active&&account.active&&this.db.prepare('SELECT count(*) AS n FROM admin_accounts WHERE active=1').get().n<=1)throw Error('마지막 활성 관리자는 중지할 수 없습니다.');
      this.db.prepare("UPDATE admin_accounts SET name=?,active=?,salt=?,password_hash=?,auth_version=CASE WHEN ? THEN lower(hex(randomblob(16))) ELSE auth_version END,version=lower(hex(randomblob(16))) WHERE id=?").run(name??account.name,active,salt||account.salt,hash||account.password_hash,rotate?1:0,account.id);
      if(rotate)this.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(account.id);
      const result=this.db.prepare('SELECT id,login_id,name,active,version,created_at FROM admin_accounts WHERE id=?').get(account.id);this.db.exec('COMMIT');if(hash)this.accountFailures.delete(account.login_id.toLowerCase());return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
