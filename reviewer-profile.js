import { createHash,randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import { signatureBytes } from './store.js';

const field=(value,label,max=200)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error(`${label}을 확인해 주세요.`);return value.trim();};
const conflict=()=>Object.assign(Error('직원 정보가 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});

export class ReviewerProfile {
  constructor(db,now=Date.now){
    this.db=db;this.now=now;
    db.exec(`CREATE TABLE IF NOT EXISTS reviewer_profiles (reviewer_id INTEGER PRIMARY KEY REFERENCES reviewers(id),phone TEXT NOT NULL,mobile TEXT NOT NULL,email TEXT NOT NULL,postcode TEXT NOT NULL,address TEXT NOT NULL,address_detail TEXT NOT NULL,signature BLOB,revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviewer_profile_failures (reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),attempted_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reviewer_profile_failures_account ON reviewer_profile_failures(reviewer_id,attempted_at);`);
  }
  transaction(fn,authorize=()=>{}){this.db.exec('BEGIN IMMEDIATE');try{authorize();const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get(id){
    const row=this.db.prepare('SELECT r.id,r.site_id,r.name,r.login_id,r.auth_version,p.phone,p.mobile,p.email,p.postcode,p.address,p.address_detail,p.signature,p.revision FROM reviewers r LEFT JOIN reviewer_profiles p ON p.reviewer_id=r.id WHERE r.id=? AND r.active=1').get(Number(id));if(!row)throw Error('활성 직원 계정을 확인해 주세요.');
    const person={id:row.id,siteId:row.site_id,name:row.name,loginId:row.login_id},profile={phone:row.phone||'',mobile:row.mobile||'',email:row.email||'',postcode:row.postcode||'',address:row.address||'',addressDetail:row.address_detail||'',hasSignature:!!row.signature},version=createHash('sha256').update(JSON.stringify({person,profile,authVersion:row.auth_version,revision:row.revision||''})).digest('hex');return {person,profile,version};
  }
  signature(id){const row=this.db.prepare('SELECT p.signature FROM reviewer_profiles p JOIN reviewers r ON r.id=p.reviewer_id WHERE r.id=? AND r.active=1').get(Number(id));return row?.signature||null;}
  update(id,input,authorize=()=>{}){
    if(!input||typeof input.version!=='string'||typeof input.currentPassword!=='string'||input.currentPassword.length>256||typeof (input.newPassword??'')!=='string'||typeof (input.confirmPassword??'')!=='string')throw Error('직원 정보와 현재 암호를 확인해 주세요.');
    const next=input.newPassword??'',confirm=input.confirmPassword??'';if(next!==confirm||next&&(next.length<12||next.length>256))throw Error('새 암호와 확인은 같아야 하며 12자 이상 256자 이하여야 합니다.');
    const values={phone:field(input.phone??'','전화번호',50),mobile:field(input.mobile??'','휴대전화',50),email:field(input.email??'','이메일'),postcode:field(input.postcode??'','우편번호',20),address:field(input.address??'','주소'),addressDetail:field(input.addressDetail??'','상세 주소')},signature=input.signature===undefined?undefined:input.signature===null?null:signatureBytes(input.signature),now=this.now();
    const result=this.transaction(()=>{
      const account=this.db.prepare('SELECT salt,password_hash FROM reviewers WHERE id=? AND active=1').get(Number(id));if(!account)throw Error('활성 직원 계정을 확인해 주세요.');this.db.prepare('DELETE FROM reviewer_profile_failures WHERE attempted_at<=?').run(now-5*60*1000);
      if(this.db.prepare('SELECT count(*) AS n FROM reviewer_profile_failures WHERE reviewer_id=? AND attempted_at>?').get(Number(id),now-5*60*1000).n>=10)return {limited:true};
      const candidate=scryptSync(input.currentPassword,account.salt,32);if(candidate.length!==account.password_hash.length||!timingSafeEqual(candidate,account.password_hash)){this.db.prepare('INSERT INTO reviewer_profile_failures(reviewer_id,attempted_at) VALUES(?,?)').run(Number(id),now);return {badPassword:true};}
      if(this.get(id).version!==input.version)throw conflict();const old=this.signature(id),image=signature===undefined?old:signature;
      this.db.prepare('INSERT INTO reviewer_profiles(reviewer_id,phone,mobile,email,postcode,address,address_detail,signature,revision) VALUES(?,?,?,?,?,?,?,?,lower(hex(randomblob(16)))) ON CONFLICT(reviewer_id) DO UPDATE SET phone=excluded.phone,mobile=excluded.mobile,email=excluded.email,postcode=excluded.postcode,address=excluded.address,address_detail=excluded.address_detail,signature=excluded.signature,revision=excluded.revision').run(Number(id),values.phone,values.mobile,values.email,values.postcode,values.address,values.addressDetail,image);
      if(next){const salt=randomBytes(16),hash=scryptSync(next,salt,32);this.db.prepare('UPDATE reviewers SET salt=?,password_hash=?,auth_version=lower(hex(randomblob(16))) WHERE id=?').run(salt,hash,Number(id));this.db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(Number(id));}
      this.db.prepare('DELETE FROM reviewer_profile_failures WHERE reviewer_id=?').run(Number(id));return {passwordChanged:!!next};
    },authorize);
    if(result.limited)throw Object.assign(Error('잠시 후 다시 시도해 주세요.'),{sessionStatus:429});if(result.badPassword)throw Object.assign(Error('현재 암호를 확인해 주세요.'),{sessionStatus:403});return result;
  }
}
