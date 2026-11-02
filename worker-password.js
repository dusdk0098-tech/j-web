import {timingSafeEqual} from 'node:crypto';
import {passwordHash,passwordSalt,withPasswordHashes} from './password-hashing.js';

function validate(input){
  if(!input||typeof input.currentPassword!=='string'||input.currentPassword.length>256||typeof input.newPassword!=='string'||input.newPassword.length<12||input.newPassword.length>256||input.newPassword!==input.confirmPassword)throw Error('현재 암호와 새 암호 확인을 다시 입력해 주세요.');
}

export class WorkerPassword {
  constructor(db,now=Date.now){
    this.db=db;this.now=now;this.pending=new Map();
  }
  async changeAsync(id,input,authorize,peer){
    validate(input);id=Number(id);authorize();
    const failures=this.db.prepare('SELECT COUNT(*) AS n FROM worker_password_failures WHERE worker_id=? AND attempted_at>?').get(id,this.now()-300000).n;
    if(failures+(this.pending.get(id)||0)>=10)throw Object.assign(Error('잠시 후 다시 시도해 주세요.'),{sessionStatus:429});
    this.pending.set(id,(this.pending.get(id)||0)+1);
    try{
      const row=this.db.prepare('SELECT salt FROM worker_accounts WHERE worker_id=?').get(id);if(!row)throw Object.assign(Error('근로자 로그인이 필요합니다.'),{sessionStatus:401});
      return await withPasswordHashes(peer,[{password:input.currentPassword,salt:row.salt},{password:input.newPassword}],()=>this.change(id,input,authorize));
    }finally{const n=this.pending.get(id)-1;if(n)this.pending.set(id,n);else this.pending.delete(id);}
  }
  change(id,input,authorize=()=>{}){
    validate(input);const now=this.now();let result;
    this.db.exec('BEGIN IMMEDIATE');try{authorize();
      const account=this.db.prepare('SELECT site_id,login_id,salt,password_hash FROM worker_accounts WHERE worker_id=?').get(Number(id));if(!account)throw Object.assign(Error('근로자 로그인이 필요합니다.'),{sessionStatus:401});
      this.db.prepare('DELETE FROM worker_password_failures WHERE attempted_at<=?').run(now-300000);
      if(this.db.prepare('SELECT COUNT(*) AS n FROM worker_password_failures WHERE worker_id=? AND attempted_at>?').get(Number(id),now-300000).n>=10)result={limited:true};
      else{
        const candidate=passwordHash(input.currentPassword,account.salt,32);
        if(candidate.length!==account.password_hash.length||!timingSafeEqual(candidate,account.password_hash)){this.db.prepare('INSERT INTO worker_password_failures(worker_id,attempted_at) VALUES(?,?)').run(Number(id),now);result={badPassword:true};}
        else{
          const salt=passwordSalt(input.newPassword),hash=passwordHash(input.newPassword,salt,32);
          this.db.prepare('UPDATE worker_accounts SET salt=?,password_hash=? WHERE worker_id=?').run(salt,hash,Number(id));
          this.db.prepare('DELETE FROM worker_sessions WHERE worker_id=?').run(Number(id));this.db.prepare('DELETE FROM worker_password_failures WHERE worker_id=?').run(Number(id));
          result={siteId:account.site_id,loginId:account.login_id};
        }
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(result.limited)throw Object.assign(Error('잠시 후 다시 시도해 주세요.'),{sessionStatus:429});
    if(result.badPassword)throw Object.assign(Error('현재 암호를 확인해 주세요.'),{sessionStatus:403});
    return result;
  }
}
