import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { passwordHash as scryptSync, passwordSalt, passwordCandidate, withPasswordHashes, assertPasswordAccount } from './password-hashing.js';
import { LoginFailures } from './login-failures.js';

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
    this.db=db;this.now=now;this.loginFailures=new LoginFailures();this.accountFailures=this.loginFailures.accounts;
    db.exec("CREATE TABLE IF NOT EXISTS admin_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,login_id TEXT NOT NULL COLLATE NOCASE UNIQUE,salt BLOB NOT NULL,password_hash BLOB NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version TEXT NOT NULL,auth_version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES admin_accounts(id),expires INTEGER NOT NULL,credential_hash BLOB NOT NULL)");
    db.exec('BEGIN IMMEDIATE');try{
      if(!db.prepare('PRAGMA table_info(admin_accounts)').all().some(column=>column.name==='scope'))db.exec("ALTER TABLE admin_accounts ADD COLUMN scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','restricted'))");
      db.exec('CREATE TABLE IF NOT EXISTS admin_site_assignments (admin_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,PRIMARY KEY(admin_id,site_id))');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(now());
  }
  available(loginId){
    if(typeof loginId!=='string'||!loginPattern.test(loginId))throw new Error('관리자 아이디를 확인해 주세요.');
    return !this.db.prepare('SELECT 1 FROM admin_accounts WHERE login_id=?').get(loginId);
  }
  async loginAsync(loginId,password,oldToken,peer){
    loginId=loginId===undefined?'admin':loginId;
    const key=typeof loginId==='string'&&loginPattern.test(loginId)?loginId.toLowerCase():'invalid',release=this.loginFailures.reserve(peer,key,this.now());
    try{
      const read=()=>key==='invalid'?null:this.db.prepare('SELECT * FROM admin_accounts WHERE login_id=?').get(loginId),row=read();
      return await withPasswordHashes(peer,[{password:passwordCandidate(password),salt:row?.salt||Buffer.alloc(16)}],()=>{assertPasswordAccount(row,read());release();return this.login(loginId,password,oldToken,peer,row??null);});
    }finally{release();}
  }
  createAsync(input,authorize,peer){return withPasswordHashes(peer,[{password:passwordValue(input.password)}],()=>this.create(input,authorize));}
  updateAsync(id,input,authorize,peer){return input.password===undefined?this.update(id,input,authorize):withPasswordHashes(peer,[{password:passwordValue(input.password)}],()=>this.update(id,input,authorize));}
  bootstrap(password){
    if(this.db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get())return;
    this.create({loginId:'admin',name:'최초 관리자',password},()=>{},true);
  }
  create(input,authorize=()=>{},bootstrap=false){
    const loginId=value(input.loginId,'관리자 아이디',50),name=value(input.name,'이름',200),password=passwordValue(input.password);
    if(!loginPattern.test(loginId))throw Error('관리자 아이디는 영문·숫자·밑줄 3~50자입니다.');
    const salt=passwordSalt(password),hash=scryptSync(password,salt,32);
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();
      if(bootstrap&&this.db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get()){this.db.exec('COMMIT');return;}
      if(!this.available(loginId))throw Error('이미 사용 중인 관리자 아이디입니다.');
      const {scope,siteIds}=this.permissions(input);
      const id=this.db.prepare("INSERT INTO admin_accounts(login_id,name,salt,password_hash,scope,version,auth_version) VALUES(?,?,?,?,?,lower(hex(randomblob(16))),lower(hex(randomblob(16))))").run(loginId,name,salt,hash,scope).lastInsertRowid;
      this.assignSites(id,siteIds);
      this.db.exec('COMMIT');return this.list().find(row=>row.id===Number(id));
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  valid(token,now=this.now()){return !!this.session(token,now);}
  context(token){return this.valid(token)?createHash('sha256').update('admin-context:'+token).digest('hex'):null;}
  login(loginId,password,oldToken='',peer='local',verifiedAccount=undefined){
    loginId=loginId===undefined?'admin':loginId;
    const now=this.now(),key=typeof loginId==='string'&&loginPattern.test(loginId)?loginId.toLowerCase():'invalid';
    this.loginFailures.check(peer,key,now);
    const row=key==='invalid'?null:this.db.prepare('SELECT id,salt,password_hash,auth_version,active FROM admin_accounts WHERE login_id=?').get(loginId),candidate=typeof password==='string'&&password.length<=256?password:'',hash=scryptSync(candidate,row?.salt||Buffer.alloc(16),32),expected=row?.password_hash||Buffer.alloc(32);
    if(!row||!row.active||!timingSafeEqual(hash,expected)){this.loginFailures.record(peer,key,now);return null;}
    const raw=randomBytes(32).toString('base64url'),newKey=tokenHash(raw),oldKey=tokenHash(oldToken);
    this.db.exec('BEGIN IMMEDIATE');try{
      const current=this.db.prepare('SELECT * FROM admin_accounts WHERE id=?').get(row.id);
      if(verifiedAccount!==undefined)assertPasswordAccount(verifiedAccount,current);
      if(!current||!current.active||current.auth_version!==row.auth_version||current.password_hash.length!==row.password_hash.length||!timingSafeEqual(current.password_hash,row.password_hash)){this.db.exec('ROLLBACK');return null;}
      this.db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(now);
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
    return {id:row.id,loginId:row.login_id,name:row.name,scope:row.scope,siteIds:this.siteIds(row.id)};
  }
  requireGlobal(token){
    const current=this.session(token);if(!current)throw Object.assign(new Error('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.'),{sessionStatus:401});
    if(current.scope!=='global')throw Object.assign(new Error('전역 관리자만 계정과 현장 배정을 관리할 수 있습니다.'),{sessionStatus:403});
    return current;
  }
  siteIds(id){return this.db.prepare('SELECT site_id FROM admin_site_assignments WHERE admin_id=? ORDER BY site_id').all(id).map(row=>row.site_id);}
  permissions(input,account){
    const scope=input.scope??account?.scope??'global';
    if(!['global','restricted'].includes(scope)||input.scope===null)throw Error('관리자 권한 범위를 확인해 주세요.');
    const ids=input.siteIds===undefined?(scope==='global'?[]:account?this.siteIds(account.id):[]):input.siteIds;
    if(!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length||(scope==='global'&&ids.length))throw Error('배정할 현장을 확인해 주세요.');
    const siteIds=[...ids].sort((a,b)=>a-b);
    if(siteIds.length){const exists=this.db.prepare('SELECT 1 FROM sites WHERE id=?');if(siteIds.some(id=>!exists.get(id)))throw Error('배정할 현장을 확인해 주세요.');}
    return {scope,siteIds};
  }
  assignSites(id,siteIds){
    if(this.siteIds(id).length)this.db.prepare('DELETE FROM admin_site_assignments WHERE admin_id=?').run(id);
    for(const siteId of siteIds)this.db.prepare('INSERT INTO admin_site_assignments(admin_id,site_id) VALUES(?,?)').run(id,siteId);
  }
  logout(token){const key=tokenHash(token);if(key)this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(key);}
  list(){return this.db.prepare('SELECT id,login_id,name,active,version,created_at,scope FROM admin_accounts ORDER BY id DESC').all().map(row=>({...row,siteIds:this.siteIds(row.id)}));}
  update(id,input,authorize=()=>{}){
    if(!input||typeof input.version!=='string'||(input.active===undefined&&input.password===undefined&&input.name===undefined&&input.scope===undefined&&input.siteIds===undefined&&input.revoke!==true)||(input.active!==undefined&&typeof input.active!=='boolean'))throw new Error('변경할 관리자 계정 정보를 확인해 주세요.');
    const name=input.name===undefined?null:value(input.name,'이름',200);
    let salt=null,hash=null;if(input.password!==undefined){salt=passwordSalt(passwordValue(input.password));hash=scryptSync(passwordValue(input.password),salt,32);}
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();const account=this.db.prepare('SELECT * FROM admin_accounts WHERE id=?').get(Number(id));if(!account)throw new Error('관리자 계정을 확인해 주세요.');if(account.version!==input.version)throw Object.assign(new Error('관리자 계정이 변경되었습니다. 다시 조회해 주세요.'),{sessionStatus:409});
      const {scope,siteIds}=this.permissions(input,account),permissionsChanged=scope!==account.scope||JSON.stringify(siteIds)!==JSON.stringify(this.siteIds(account.id));
      const active=input.active===undefined?account.active:(input.active?1:0),rotate=hash!==null||active===0||input.revoke===true||permissionsChanged;
      if((!active||scope!=='global')&&account.active&&account.scope==='global'&&this.db.prepare("SELECT count(*) AS n FROM admin_accounts WHERE active=1 AND scope='global'").get().n<=1)throw Error('마지막 활성 전역 관리자는 중지하거나 권한을 제한할 수 없습니다.');
      if(permissionsChanged)this.assignSites(account.id,siteIds);
      this.db.prepare("UPDATE admin_accounts SET name=?,active=?,scope=?,salt=?,password_hash=?,auth_version=CASE WHEN ? THEN lower(hex(randomblob(16))) ELSE auth_version END,version=lower(hex(randomblob(16))) WHERE id=?").run(name??account.name,active,scope,salt||account.salt,hash||account.password_hash,rotate?1:0,account.id);
      if(rotate)this.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(account.id);
      const result=this.list().find(row=>row.id===account.id);this.db.exec('COMMIT');if(hash)this.accountFailures.delete(account.login_id.toLowerCase());return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
