import { createHash,createHmac,randomBytes } from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const conflict=message=>Object.assign(Error(message),{sessionStatus:409});
export class NotificationOutbox {
  constructor(db,provider,{systemWrite=fn=>fn(),now=Date.now}={}){
    this.db=db;this.provider=provider;this.systemWrite=systemWrite;this.now=now;
    db.exec(`CREATE TABLE IF NOT EXISTS notification_secret (id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_jobs (id TEXT PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),owner TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,base_fingerprint TEXT NOT NULL,previous_id TEXT,provider_fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL,claimed_at INTEGER,recipients TEXT NOT NULL);
      INSERT OR IGNORE INTO notification_secret(id,secret) VALUES(1,lower(hex(randomblob(32))));`);
    this.secret=db.prepare('SELECT secret FROM notification_secret WHERE id=1').get().secret;
  }
  status(){return this.provider.status();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  site(siteId){if(!Number.isSafeInteger(siteId)||siteId<1||!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw Error('현장을 확인해 주세요.');}
  fingerprint(siteId,input){return createHmac('sha256',this.secret).update(JSON.stringify([siteId,this.provider.fingerprint,input.recipients,input.content])).digest('hex');}
  row(id){if(typeof id!=='string'||!/^[\w-]{43}$/.test(id))throw Error('발송 작업을 확인해 주세요.');const row=this.db.prepare('SELECT * FROM notification_jobs WHERE id=?').get(id);if(!row)throw Error('발송 작업을 찾을 수 없습니다.');return row;}
  view(row){return {id:row.id,siteId:row.site_id,createdAt:row.created_at,claimed:row.claimed_at!==null,recipients:JSON.parse(row.recipients).map(({messageId,...item})=>({...item,canCheck:!!messageId&&row.provider_fingerprint===this.provider.fingerprint&&this.status().configured}))};}
  list(siteId,authorize){authorize();this.site(siteId);return this.db.prepare('SELECT * FROM notification_jobs WHERE site_id=? ORDER BY created_at DESC LIMIT 50').all(siteId).map(row=>this.view(row));}
  prepare(siteId,input,session,authorize){
    const values=this.provider.validate(input),base=this.fingerprint(siteId,values);
    return this.transaction(()=>{authorize();this.site(siteId);const latest=this.db.prepare('SELECT * FROM notification_jobs WHERE base_fingerprint=? ORDER BY rowid DESC LIMIT 1').get(base);let fingerprint=base,previous=null;
      if(input.previousId!==undefined){const old=this.row(input.previousId);if(input.duplicateRiskAccepted!==true||old.base_fingerprint!==base)throw conflict('이전 작업과 중복 발송 위험을 확인해 주세요.');previous=old.id;fingerprint=hash(base+':'+previous);const same=this.db.prepare('SELECT * FROM notification_jobs WHERE fingerprint=?').get(fingerprint);if(same){if(same.owner!==hash(session)&&same.claimed_at===null)throw conflict('다른 세션에서 같은 후속 작업을 준비했습니다.');return {...this.view(same),content:values.content,recipientsPreview:values.recipients};}if(latest?.id!==previous)throw conflict('더 최근 발송 작업이 있습니다. 이력을 다시 확인해 주세요.');}
      else if(latest)return {...this.view(latest),content:values.content,recipientsPreview:values.recipients,requiresNewPreview:latest.owner!==hash(session)||this.now()-latest.created_at>10*60*1000};
      const id=randomBytes(32).toString('base64url'),recipients=values.recipients.map(to=>({number:to.slice(0,3)+'-****-'+to.slice(-4),state:'prepared',messageId:null,code:null}));
      this.db.prepare('INSERT INTO notification_jobs(id,site_id,owner,fingerprint,base_fingerprint,previous_id,provider_fingerprint,created_at,recipients) VALUES(?,?,?,?,?,?,?,?,?)').run(id,siteId,hash(session),fingerprint,base,previous,this.provider.fingerprint,this.now(),JSON.stringify(recipients));return {...this.view(this.row(id)),content:values.content,recipientsPreview:values.recipients};});
  }
  async send(siteId,id,input,session,authorize){
    if(input.confirmed!==true)throw Error('수신번호와 본문을 확인해 주세요.');const values=this.provider.validate(input);
    const claim=this.transaction(()=>{authorize();this.site(siteId);const row=this.row(id);if(row.site_id!==siteId||row.owner!==hash(session))throw conflict('발송을 준비한 현장과 관리자 세션에서 확인해 주세요.');if(row.base_fingerprint!==this.fingerprint(siteId,values)||row.provider_fingerprint!==this.provider.fingerprint)throw conflict('미리보기 내용 또는 업체 설정이 바뀌었습니다. 다시 확인해 주세요.');if(row.claimed_at!==null)return {existing:row};if(this.db.prepare('SELECT 1 FROM notification_jobs WHERE previous_id=?').get(id))throw conflict('새 미리보기가 만들어져 이전 미리보기에서는 발송할 수 없습니다.');if(this.now()-row.created_at>10*60*1000)throw conflict('미리보기 유효시간이 지났습니다. 이력에서 새 작업을 준비해 주세요.');const recipients=JSON.parse(row.recipients).map(item=>({...item,state:'unknown'}));this.db.prepare('UPDATE notification_jobs SET claimed_at=?,recipients=? WHERE id=? AND claimed_at IS NULL').run(this.now(),JSON.stringify(recipients),id);return {recipients};});
    if(claim.existing)return this.view(claim.existing);
    // 발송 전 불명 상태를 확정한다. 프로세스 종료·응답 유실 시 같은 작업은 재전송하지 않는다.
    let results;try{results=await this.provider.send(values);}catch{results=claim.recipients.map(()=>({state:'unknown',messageId:null,code:null}));}
    this.systemWrite(()=>{this.db.prepare('UPDATE notification_jobs SET recipients=? WHERE id=? AND claimed_at IS NOT NULL').run(JSON.stringify(claim.recipients.map((item,i)=>({...item,...results[i]}))),id);});
    return this.view(this.row(id));
  }
  async refresh(siteId,id,index,authorize){
    authorize();this.site(siteId);let row=this.row(id);if(row.site_id!==siteId)throw Error('현장을 확인해 주세요.');const items=JSON.parse(row.recipients);if(!Number.isSafeInteger(index)||!items[index]||!items[index].messageId)throw Error('업체 접수 식별자가 없어 자동 조회할 수 없습니다. 업체 콘솔에서 직접 확인하세요.');if(row.provider_fingerprint!==this.provider.fingerprint)throw Error('발송 당시 업체 설정과 달라 조회할 수 없습니다.');const item=items[index];
    const result=await this.provider.result(item.messageId);
    if(result)this.systemWrite(()=>this.transaction(()=>{row=this.row(id);const current=JSON.parse(row.recipients);if(current[index].state==='delivered'||current[index].state==='failed')return;current[index]={...current[index],...result};this.db.prepare('UPDATE notification_jobs SET recipients=? WHERE id=?').run(JSON.stringify(current),id);}));
    return {...this.view(this.row(id)),checked:result!==null};
  }
}
