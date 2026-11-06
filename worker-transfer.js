import {createHash} from 'node:crypto';
import {dateValue} from './domain.js';

const queries={
  attendance:'SELECT * FROM attendance WHERE worker_id=? AND date=? ORDER BY date',
  meals:'SELECT * FROM meal_checks WHERE worker_id=? AND date=? ORDER BY kind,id',
  selfChecks:'SELECT * FROM worker_self_checks WHERE worker_id=? AND date=? ORDER BY date',
  dailyTraining:'SELECT * FROM worker_daily_training WHERE worker_id=? AND date=? ORDER BY kind',
  notices:"SELECT c.*,d.date AS document_date,d.status AS document_status,d.edit_version AS document_version,d.title AS document_title,d.body AS document_body,d.details AS document_details FROM worker_notice_reads c JOIN documents d ON d.id=c.document_id WHERE c.worker_id=? AND d.site_id=? AND d.date=? AND d.type='notice' ORDER BY c.document_id",
  noticeHistory:"SELECT c.*,e.previous_title,e.previous_body,e.created_at AS edit_created_at,d.date AS document_date,d.status AS document_status,d.edit_version AS document_version FROM notice_edit_reads c JOIN notice_edits e ON e.id=c.edit_id JOIN documents d ON d.id=e.document_id WHERE c.worker_id=? AND d.site_id=? AND d.date=? AND d.type='notice' ORDER BY c.edit_id",
  education:"SELECT c.*,d.date AS document_date,d.status AS document_status,d.edit_version AS document_version,d.title AS document_title,d.body AS document_body,d.details AS document_details FROM worker_training_checks c JOIN documents d ON d.id=c.document_id WHERE c.worker_id=? AND d.site_id=? AND d.date=? AND d.type IN ('tbm','education') ORDER BY c.document_id",
  educationTargets:"SELECT t.*,d.edit_version AS document_version FROM training_targets t JOIN documents d ON d.id=t.document_id WHERE t.worker_id=? AND d.site_id=? AND d.date=? AND d.type IN ('tbm','education') ORDER BY t.document_id"
};
const documentKinds=new Set(['notices','noticeHistory','education','educationTargets']);
const keyFields={meals:'kind',dailyTraining:'kind',notices:'document_id',noticeHistory:'edit_id',education:'document_id'};
const normalize=value=>value instanceof Uint8Array?Buffer.from(value).toString('base64'):value;
function rowsFor(db,siteId,workerId,date){
  return Object.fromEntries(Object.entries(queries).map(([kind,sql])=>[kind,db.prepare(sql).all(...(documentKinds.has(kind)?[workerId,siteId,date]:[workerId,date]))]));
}
export function inspectWorkerTransfer(db,input){
  const siteId=Number(input?.siteId),sourceId=Number(input?.sourceId),targetId=Number(input?.targetId),date=dateValue(input?.date);
  if(![siteId,sourceId,targetId].every(id=>Number.isSafeInteger(id)&&id>0)||sourceId===targetId)throw new Error('같은 현장의 서로 다른 출입자를 확인해 주세요.');
  const person=id=>db.prepare('SELECT w.*,j.profile AS join_profile FROM workers w LEFT JOIN join_acknowledgements j ON j.worker_id=w.id WHERE w.id=? AND w.site_id=?').get(id,siteId),source=person(sourceId),target=person(targetId);
  if(!source||!target)throw new Error('같은 현장의 출입자를 확인해 주세요.');
  const from=rowsFor(db,siteId,sourceId,date),to=rowsFor(db,siteId,targetId,date),counts={},conflicts=[];
  for(const [kind,rows] of Object.entries(from)){
    if(kind==='educationTargets')continue;
    const selected=kind==='attendance'?rows.filter(row=>row.present===1):rows;counts[kind]=selected.length;
    const existing=to[kind],key=keyFields[kind];if(selected.length&&existing.length&&(key?selected.some(row=>existing.some(other=>row[key]===other[key])):true))conflicts.push(kind);
  }
  const encode=rows=>Object.fromEntries(Object.entries(rows).map(([kind,values])=>[kind,values.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,normalize(value)])))]));
  const relevant=new Set([...from.education,...to.education,...from.educationTargets,...to.educationTargets].map(row=>row.document_id)),targetConfiguration=[...relevant].sort((a,b)=>a-b).map(id=>[id,!!db.prepare('SELECT 1 FROM training_target_config WHERE document_id=?').get(id)]);
  const version=createHash('sha256').update(JSON.stringify({siteId,date,targetConfiguration,source:Object.fromEntries(Object.entries(source).map(([key,value])=>[key,normalize(value)])),target:Object.fromEntries(Object.entries(target).map(([key,value])=>[key,normalize(value)])),from:encode(from),to:encode(to)})).digest('hex');
  return {siteId,sourceId,targetId,date,version,counts,conflicts,from,to};
}

export function previewWorkerTransfer(db,input,authorize=()=>{}){
  db.exec('BEGIN');try{
    authorize();const {siteId,sourceId,targetId,date,version,counts,conflicts}=inspectWorkerTransfer(db,input);authorize();db.exec('COMMIT');return {siteId,sourceId,targetId,date,version,counts,conflicts};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function installWorkerTransferSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS worker_transfer_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,
    site_id INTEGER NOT NULL REFERENCES sites(id),source_id INTEGER NOT NULL REFERENCES workers(id),target_id INTEGER NOT NULL REFERENCES workers(id),
    activity_date TEXT NOT NULL,source_name TEXT NOT NULL,target_name TEXT NOT NULL,actor_id INTEGER NOT NULL,actor_name TEXT NOT NULL,
    signature BLOB NOT NULL,manifest TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS worker_transfer_events_site_date ON worker_transfer_events(site_id,activity_date,id);
  CREATE TABLE IF NOT EXISTS worker_transfer_provenance (
    kind TEXT NOT NULL,record_key TEXT NOT NULL,worker_id INTEGER NOT NULL REFERENCES workers(id),
    original_worker_id INTEGER NOT NULL REFERENCES workers(id),original_name TEXT NOT NULL,
    transfer_id INTEGER NOT NULL REFERENCES worker_transfer_events(id),PRIMARY KEY(kind,record_key,worker_id)
  );
  CREATE TABLE IF NOT EXISTS worker_transfer_evidence (
    transfer_id INTEGER NOT NULL REFERENCES worker_transfer_events(id),kind TEXT NOT NULL,record_key TEXT NOT NULL,
    original_worker_id INTEGER NOT NULL REFERENCES workers(id),original_name TEXT NOT NULL,signature BLOB,record_json TEXT NOT NULL,
    PRIMARY KEY(transfer_id,kind,record_key)
  );`);
  const tables={meals:['meal_checks','json_array(OLD.id)',false],selfChecks:['worker_self_checks','json_array(OLD.date)',true],dailyTraining:['worker_daily_training','json_array(OLD.date,OLD.kind)',true],notices:['worker_notice_reads','json_array(OLD.document_id)',true],noticeHistory:['notice_edit_reads','json_array(OLD.edit_id)',true],education:['worker_training_checks','json_array(OLD.document_id)',true]};
  for(const [kind,[table,key,signed]] of Object.entries(tables)){
    const remove=`DELETE FROM worker_transfer_provenance WHERE kind='${kind}' AND record_key=${key} AND worker_id=OLD.worker_id`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS transfer_${table}_delete AFTER DELETE ON ${table} BEGIN ${remove}; END`);
    if(signed)db.exec(`CREATE TRIGGER IF NOT EXISTS transfer_${table}_resign AFTER UPDATE OF signature ON ${table} WHEN OLD.signature IS NOT NEW.signature BEGIN ${remove}; END`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS transfer_notice_history_origin AFTER INSERT ON notice_edit_reads BEGIN
    INSERT OR IGNORE INTO worker_transfer_provenance(kind,record_key,worker_id,original_worker_id,original_name,transfer_id)
    SELECT 'noticeHistory',json_array(NEW.edit_id),NEW.worker_id,p.original_worker_id,p.original_name,p.transfer_id
    FROM notice_edits e JOIN worker_notice_reads r ON r.document_id=e.document_id AND r.worker_id=NEW.worker_id
    JOIN worker_transfer_provenance p ON p.kind='notices' AND p.record_key=json_array(e.document_id) AND p.worker_id=NEW.worker_id
    WHERE e.id=NEW.edit_id AND NEW.signature IS r.signature AND NEW.read_at=r.read_at;
  END`);
}

export function executeWorkerTransfer(db,input,signature,actor,authorize=()=>{}){
  if(!input||typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.requestId)||typeof input.version!=='string'||!/^[a-f0-9]{64}$/.test(input.version)||!Number.isSafeInteger(actor?.id)||actor.id<1||typeof actor.name!=='string'||!actor.name.trim()||!(signature instanceof Uint8Array)||!signature.length)throw new Error('전환 요청과 서명을 확인해 주세요.');
  const requestDigest=createHash('sha256').update(JSON.stringify([Number(input.siteId),Number(input.sourceId),Number(input.targetId),input.date,input.version,actor.id,Buffer.from(signature).toString('base64')])).digest('hex');
  db.exec('BEGIN IMMEDIATE');try{
    authorize();const previous=db.prepare('SELECT id,request_digest FROM worker_transfer_events WHERE request_id=?').get(input.requestId);
    if(previous){if(previous.request_digest!==requestDigest)throw Object.assign(new Error('이전 전환 요청과 내용이 다릅니다.'),{sessionStatus:409});db.exec('COMMIT');return {id:previous.id};}
    const state=inspectWorkerTransfer(db,input);if(state.version!==input.version)throw Object.assign(new Error('출역 또는 안전활동 기록이 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});
    if(state.conflicts.length)throw Object.assign(new Error('대상자에게 같은 종류의 기록이 있습니다. 기존 기록을 확인해 주세요.'),{sessionStatus:409});
    if(state.counts.attendance!==1)throw new Error('출발 출입자의 해당 날짜 출역을 확인해 주세요.');
    const names=db.prepare('SELECT id,name FROM workers WHERE site_id=? AND id IN (?,?)').all(state.siteId,state.sourceId,state.targetId),sourceName=names.find(row=>row.id===state.sourceId).name,targetName=names.find(row=>row.id===state.targetId).name;
    const manifest={counts:state.counts,records:Object.fromEntries(Object.entries(state.from).filter(([kind])=>kind!=='educationTargets').map(([kind,rows])=>[kind,rows.map(row=>kind==='attendance'?state.date:kind==='selfChecks'?state.date:kind==='meals'||kind==='dailyTraining'?row.kind:kind==='noticeHistory'?row.edit_id:row.document_id)]))};
    const id=db.prepare('INSERT INTO worker_transfer_events(request_id,request_digest,site_id,source_id,target_id,activity_date,source_name,target_name,actor_id,actor_name,signature,manifest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(input.requestId,requestDigest,state.siteId,state.sourceId,state.targetId,state.date,sourceName,targetName,actor.id,actor.name.trim(),signature,JSON.stringify(manifest)).lastInsertRowid;
    const original=state.from.attendance[0];db.prepare('INSERT INTO worker_transfer_evidence(transfer_id,kind,record_key,original_worker_id,original_name,signature,record_json) VALUES(?,?,?,?,?,NULL,?)').run(id,'attendance',JSON.stringify([state.date]),state.sourceId,sourceName,JSON.stringify(original));db.prepare("INSERT INTO attendance(worker_id,date,present,updated_at,company_snapshot,company_id_snapshot,occupation_snapshot,category_snapshot,source,units_hundredths,daily_rate,salary_kind,salary_amount,day_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)").run(state.targetId,state.date,1,original.updated_at,original.company_snapshot,original.company_id_snapshot,original.occupation_snapshot,original.category_snapshot,'transfer',original.units_hundredths,original.daily_rate,original.salary_kind,original.salary_amount);
    db.prepare("UPDATE attendance SET present=0,source='transfer',updated_at=CURRENT_TIMESTAMP WHERE worker_id=? AND date=?").run(state.sourceId,state.date);
    const definitions={meals:['meal_checks','id'],selfChecks:['worker_self_checks','date'],dailyTraining:['worker_daily_training','kind'],notices:['worker_notice_reads','document_id'],noticeHistory:['notice_edit_reads','edit_id'],education:['worker_training_checks','document_id']};
    for(const [kind,[table,key]] of Object.entries(definitions))for(const row of state.from[kind]){
      const recordKey=JSON.stringify(kind==='selfChecks'?[state.date]:kind==='dailyTraining'?[state.date,row.kind]:[row[key]]),prior=db.prepare('SELECT original_worker_id,original_name FROM worker_transfer_provenance WHERE kind=? AND record_key=? AND worker_id=?').get(kind,recordKey,state.sourceId),originId=prior?.original_worker_id??state.sourceId,originName=prior?.original_name??sourceName;
      const record=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='signature').map(([key,value])=>[key,normalize(value)]));db.prepare('INSERT INTO worker_transfer_evidence(transfer_id,kind,record_key,original_worker_id,original_name,signature,record_json) VALUES(?,?,?,?,?,?,?)').run(id,kind,recordKey,originId,originName,row.signature??null,JSON.stringify(record));
      if(kind==='dailyTraining')db.prepare('UPDATE worker_daily_training SET worker_id=? WHERE worker_id=? AND date=? AND kind=?').run(state.targetId,state.sourceId,state.date,row.kind);else db.prepare(`UPDATE ${table} SET worker_id=? WHERE worker_id=? AND ${key}=?`).run(state.targetId,state.sourceId,row[key]);
      if(prior)db.prepare('DELETE FROM worker_transfer_provenance WHERE kind=? AND record_key=? AND worker_id=?').run(kind,recordKey,state.sourceId);
      db.prepare('INSERT INTO worker_transfer_provenance(kind,record_key,worker_id,original_worker_id,original_name,transfer_id) VALUES(?,?,?,?,?,?)').run(kind,recordKey,state.targetId,originId,originName,id);
    }
    const targeted=new Set(state.from.educationTargets.map(row=>row.document_id));for(const row of state.from.education)if(targeted.has(row.document_id))db.prepare('INSERT OR IGNORE INTO training_targets(document_id,worker_id) VALUES(?,?)').run(row.document_id,state.targetId);
    authorize();db.exec('COMMIT');return {id};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function workerTransferAudit(db,siteId,eventId,authorize=()=>{}){
  siteId=Number(siteId);eventId=Number(eventId);
  if(![siteId,eventId].every(id=>Number.isSafeInteger(id)&&id>0))throw new Error('현장과 전환 기록을 확인해 주세요.');
  db.exec('BEGIN');try{
    authorize();
    const event=db.prepare('SELECT id,site_id,source_id,target_id,activity_date,source_name,target_name,actor_id,actor_name,manifest,created_at FROM worker_transfer_events WHERE site_id=? AND id=?').get(siteId,eventId);
    if(!event){authorize();db.exec('COMMIT');return null;}
    const records=db.prepare('SELECT kind,record_key,original_worker_id,original_name,signature IS NOT NULL AS has_signature,record_json FROM worker_transfer_evidence WHERE transfer_id=? ORDER BY kind,record_key').all(eventId).map(({record_json,...row})=>({...row,record:JSON.parse(record_json)}));
    const result={...event,manifest:JSON.parse(event.manifest),records};authorize();db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function workerTransferHistory(db,siteId,date,authorize=()=>{}){
  siteId=Number(siteId);date=dateValue(date);
  if(!Number.isSafeInteger(siteId)||siteId<1)throw new Error('현장을 확인해 주세요.');
  db.exec('BEGIN');try{
    authorize();if(!db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 확인해 주세요.');
    const rows=db.prepare('SELECT id,source_name,target_name,actor_name,created_at FROM worker_transfer_events WHERE site_id=? AND activity_date=? ORDER BY id DESC').all(siteId,date);
    authorize();db.exec('COMMIT');return rows;
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function workerTransferSignature(db,siteId,eventId,kind,key,authorize=()=>{}){
  siteId=Number(siteId);eventId=Number(eventId);
  if(![siteId,eventId].every(id=>Number.isSafeInteger(id)&&id>0))throw new Error('현장과 전환 기록을 확인해 주세요.');
  if(kind!==null&&(typeof kind!=='string'||typeof key!=='string'||!Object.hasOwn(queries,kind)||kind==='educationTargets'||key.length>200))throw new Error('전환 서명 기록을 확인해 주세요.');
  db.exec('BEGIN');try{
    authorize();const row=kind===null?db.prepare('SELECT signature FROM worker_transfer_events WHERE site_id=? AND id=?').get(siteId,eventId):db.prepare('SELECT e.signature FROM worker_transfer_evidence e JOIN worker_transfer_events t ON t.id=e.transfer_id WHERE t.site_id=? AND t.id=? AND e.kind=? AND e.record_key=?').get(siteId,eventId,kind,key);
    const signature=row?.signature??null;authorize();db.exec('COMMIT');return signature;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
