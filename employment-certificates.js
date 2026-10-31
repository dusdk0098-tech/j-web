import { createHash } from 'node:crypto';
import { dateValue } from './domain.js';

const today=now=>new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
const conflict=()=>Object.assign(Error('발급 정보가 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});
const optional=(value,label,max=200)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error(`${label}을 확인해 주세요.`);return value.trim();};

export class EmploymentCertificates {
  constructor(db,now=()=>new Date()){
    this.db=db;this.now=now;
    db.exec(`CREATE TABLE IF NOT EXISTS employment_profiles (reviewer_id INTEGER PRIMARY KEY REFERENCES reviewers(id),employer TEXT NOT NULL,position TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS employment_certificates (id INTEGER PRIMARY KEY AUTOINCREMENT,reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),site_id INTEGER NOT NULL REFERENCES sites(id),request_id TEXT NOT NULL,request_version TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(reviewer_id,request_id));`);
  }
  transaction(fn,authorize=()=>{}){this.db.exec('BEGIN IMMEDIATE');try{authorize();const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  profile(siteId,reviewerId){
    const site=Number(siteId),id=Number(reviewerId);if(!Number.isSafeInteger(site)||site<1||!Number.isSafeInteger(id)||id<1)throw Error('직원과 현장을 확인해 주세요.');
    const row=this.db.prepare('SELECT r.id,r.site_id,r.name,r.active,s.name AS site_name,p.employer,p.position,p.start_date,p.end_date,p.enabled,p.revision FROM reviewers r JOIN sites s ON s.id=r.site_id LEFT JOIN employment_profiles p ON p.reviewer_id=r.id WHERE r.id=? AND r.site_id=?').get(id,site);if(!row)throw Error('같은 현장의 직원 계정을 확인해 주세요.');
    const person={id:row.id,siteId:row.site_id,name:row.name,siteName:row.site_name,active:!!row.active},profile={employer:row.employer||'',position:row.position||'',startDate:row.start_date||'',endDate:row.end_date||'',enabled:!!row.enabled},version=createHash('sha256').update(JSON.stringify({person,profile,revision:row.revision||''})).digest('hex');return {person,profile,version};
  }
  saveProfile(siteId,reviewerId,input,authorize=()=>{}){
    if(!input||typeof input.enabled!=='boolean'||typeof input.version!=='string'||typeof input.startDate!=='string'||typeof input.endDate!=='string')throw Error('발급 설정을 확인해 주세요.');const employer=optional(input.employer,'사업자명'),position=optional(input.position,'직책'),startDate=input.startDate?dateValue(input.startDate):'',endDate=input.endDate?dateValue(input.endDate):'';if(startDate&&endDate&&startDate>endDate)throw Error('재직 시작일은 종료일보다 늦을 수 없습니다.');if(input.enabled&&(!employer||!position||!startDate))throw Error('발급을 허용하려면 사업자명·직책·시작일을 입력해 주세요.');
    return this.transaction(()=>{const current=this.profile(siteId,reviewerId);if(current.version!==input.version)throw conflict();if(input.enabled&&!current.person.active)throw Error('활성 직원 계정을 확인해 주세요.');this.db.prepare('INSERT INTO employment_profiles(reviewer_id,employer,position,start_date,end_date,enabled,revision) VALUES(?,?,?,?,?,?,lower(hex(randomblob(16)))) ON CONFLICT(reviewer_id) DO UPDATE SET employer=excluded.employer,position=excluded.position,start_date=excluded.start_date,end_date=excluded.end_date,enabled=excluded.enabled,revision=excluded.revision').run(current.person.id,employer,position,startDate,endDate,input.enabled?1:0);return this.profile(siteId,reviewerId);},authorize);
  }
  status(reviewerId){
    const id=Number(reviewerId),actor=this.db.prepare('SELECT site_id FROM reviewers WHERE id=? AND active=1').get(id);if(!actor)throw Error('활성 직원 계정을 확인해 주세요.');const data=this.profile(actor.site_id,id),date=today(this.now()),p=data.profile,checks=[{label:'발급 허용',passed:p.enabled},{label:'사업자명',passed:!!p.employer},{label:'직책',passed:!!p.position},{label:'재직 시작일',passed:!!p.startDate&&p.startDate<=date},{label:'재직 종료 여부',passed:!p.endDate||p.endDate>=date}],version=createHash('sha256').update(JSON.stringify({profileVersion:data.version,date})).digest('hex');return {...data,checks,eligible:checks.every(check=>check.passed),date,version};
  }
  list(reviewerId){return this.db.prepare('SELECT c.id,c.created_at FROM employment_certificates c JOIN reviewers r ON r.id=c.reviewer_id AND r.site_id=c.site_id WHERE r.id=? AND r.active=1 ORDER BY c.id DESC').all(Number(reviewerId));}
  get(reviewerId,id){const actor=this.db.prepare('SELECT site_id FROM reviewers WHERE id=? AND active=1').get(Number(reviewerId));if(!actor)return null;const row=this.db.prepare('SELECT id,site_id,snapshot,created_at FROM employment_certificates WHERE id=? AND reviewer_id=? AND site_id=?').get(Number(id),Number(reviewerId),actor.site_id);return row?{id:row.id,createdAt:row.created_at,...JSON.parse(row.snapshot)}:null;}
  issue(reviewerId,input,authorize=()=>{}){
    if(!input||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{20,80}$/.test(input.requestId)||typeof input.version!=='string')throw Error('발급 요청을 확인해 주세요.');const purpose=optional(input.purpose,'발급 용도'),recipient=optional(input.recipient??'','제출처');if(!purpose)throw Error('발급 용도를 확인해 주세요.');
    return this.transaction(()=>{const existing=this.db.prepare('SELECT id,request_version,snapshot FROM employment_certificates WHERE reviewer_id=? AND request_id=?').get(Number(reviewerId),input.requestId);if(existing){const snapshot=JSON.parse(existing.snapshot);if(existing.request_version!==input.version||snapshot.purpose!==purpose||snapshot.recipient!==recipient)throw conflict();const result=this.get(reviewerId,existing.id);if(!result)throw Error('발급 기록을 확인해 주세요.');return result;}const state=this.status(reviewerId);if(state.version!==input.version)throw conflict();if(!state.eligible)throw Error('발급이 불가능합니다. 관리자에게 문의해 주세요.');const snapshot={employee:state.person.name,site:state.person.siteName,employer:state.profile.employer,position:state.profile.position,startDate:state.profile.startDate,endDate:state.profile.endDate,purpose,recipient,issueDate:state.date},id=this.db.prepare('INSERT INTO employment_certificates(reviewer_id,site_id,request_id,request_version,snapshot) VALUES(?,?,?,?,?)').run(state.person.id,state.person.siteId,input.requestId,state.version,JSON.stringify(snapshot)).lastInsertRowid;return this.get(reviewerId,id);},authorize);
  }
}
