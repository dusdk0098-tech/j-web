import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { dateValue, recordInput, text, transitions } from './domain.js';
import { PNG } from 'pngjs';
import { scheduleTypes } from './public/schedule.js';
import { workerFieldRequirements } from './public/worker-fields.js';

function workerFields(input){
  const category=text(input.category,'구분'),required=workerFieldRequirements(category),optional=(value,name,needed)=>!needed&&(value==null||typeof value==='string'&&!value.trim())?'':text(value,name);
  return {name:text(input.name,'이름'),category,company:optional(input.company,'소속',required.company),occupation:optional(input.occupation,'직종',required.occupation)};
}

function monthValue(month) {
  if(typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0,4))<1000)throw new Error('조회할 월을 확인해 주세요.');
  return month;
}
function dailyRateValue(value){if(typeof value!=='string'||!/^$|^\d{1,9}$/.test(value))throw new Error('시험 일당은 0부터 999999999까지 정수로 입력해 주세요.');return value===''?null:Number(value);}
function ppeValues(input){
  const date=dateValue(input.date),item=text(input.item,'보호구');
  if(!['string','number'].includes(typeof input.quantity)||!/^\d{1,5}$/.test(String(input.quantity)))throw new Error('지급수량을 확인해 주세요.');
  const quantity=Number(input.quantity);if(quantity<1||quantity>10000)throw new Error('지급수량을 확인해 주세요.');return {date,item,quantity};
}
function equipmentDetails(input){
  const details={};
  for(const key of ['owner','businessNumber','insurer']){
    if(input[key]!==undefined && (typeof input[key]!=='string' || input[key].length>200))throw new Error('장비 정보를 확인해 주세요.');
    details[key]=(input[key]||'').trim();
  }
  for(const key of ['registeredAt','insuranceFrom','insuranceTo','inspectedAt','inspectionFrom','inspectionTo']){
    if(input[key]!==undefined && typeof input[key]!=='string')throw new Error('장비 날짜를 확인해 주세요.');
    details[key]=input[key]?dateValue(input[key]):'';
  }
  if((details.insuranceFrom && details.insuranceTo && details.insuranceFrom>details.insuranceTo) || (details.inspectionFrom && details.inspectionTo && details.inspectionFrom>details.inspectionTo))throw new Error('보험 또는 검사 기간을 확인해 주세요.');
  return details;
}
function signatureBytes(signature) {
  if(typeof signature!=='string' || signature.length>56000)throw new Error('시험 서명을 확인해 주세요.');
  const match=signature.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw new Error('시험 서명을 입력해 주세요.');
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<67 || bytes.length>40000 || bytes.toString('base64')!==match[1] || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('시험 서명 형식을 확인해 주세요.');
  if(bytes.readUInt32BE(8)!==13 || bytes.subarray(12,16).toString('ascii')!=='IHDR' || bytes.readUInt32BE(16)>320 || bytes.readUInt32BE(20)>120 || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20))throw new Error('시험 서명 크기를 확인해 주세요.');
  let image;try{image=PNG.sync.read(bytes);}catch{throw new Error('시험 서명 이미지를 확인해 주세요.');}
  let marked=false;for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]>0 && (image.data[i]<250 || image.data[i+1]<250 || image.data[i+2]<250)){marked=true;break;}
  if(!marked)throw new Error('시험 서명을 입력해 주세요.');
  return bytes;
}
function photoBytes(photo){
  if(!photo)return null;if(typeof photo!=='string'||photo.length>2800000)throw new Error('사진은 2MB 이하여야 합니다.');
  const match=photo.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
  const bytes=Buffer.from(match[2],'base64');if(bytes.length>2*1024*1024||bytes.toString('base64')!==match[2]||(match[1]==='png'&&!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))||(match[1]==='jpeg'&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))))throw new Error('사진 형식 또는 크기를 확인해 주세요.');return bytes;
}

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS site_access (site_id INTEGER PRIMARY KEY REFERENCES sites(id),access_key TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS site_registration (site_id INTEGER PRIMARY KEY REFERENCES sites(id),expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),kind TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS board_posts (id INTEGER PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,secret INTEGER NOT NULL CHECK(secret IN (0,1)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS site_worker_blocks (site_id INTEGER NOT NULL REFERENCES sites(id),date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('holiday','ended')),PRIMARY KEY(site_id,date,kind));
      CREATE TABLE IF NOT EXISTS site_articles (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),category TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,visible INTEGER NOT NULL CHECK(visible IN (0,1)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS site_photos (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),name TEXT NOT NULL,date TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS site_article_files (id INTEGER PRIMARY KEY,article_id INTEGER NOT NULL REFERENCES site_articles(id),name TEXT NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id), name TEXT NOT NULL, trade TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS site_occupations (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),name TEXT NOT NULL,UNIQUE(site_id,name));
      CREATE TABLE IF NOT EXISTS basic_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,site_id INTEGER NOT NULL REFERENCES sites(id),parent_id INTEGER REFERENCES basic_categories(id),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS basic_category_name ON basic_categories(site_id,COALESCE(parent_id,0),name);
      CREATE TABLE IF NOT EXISTS restaurants (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),name TEXT NOT NULL,meal_price INTEGER NOT NULL,snack_price INTEGER NOT NULL,tax INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meal_defaults (site_id INTEGER NOT NULL REFERENCES sites(id),kind TEXT NOT NULL,restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),PRIMARY KEY(site_id,kind));
      CREATE TABLE IF NOT EXISTS manager_meal_defaults (site_id INTEGER NOT NULL REFERENCES sites(id),kind TEXT NOT NULL,restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),PRIMARY KEY(site_id,kind));
      CREATE TABLE IF NOT EXISTS meal_checks (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),worker_id INTEGER NOT NULL REFERENCES workers(id),date TEXT NOT NULL,kind TEXT NOT NULL,restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),restaurant_name TEXT NOT NULL,price INTEGER NOT NULL,UNIQUE(worker_id,date,kind));
      CREATE TABLE IF NOT EXISTS ppe_issues (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),worker_id INTEGER NOT NULL REFERENCES workers(id),date TEXT NOT NULL,item TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),worker_snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wage_records (site_id INTEGER NOT NULL REFERENCES sites(id),worker_id INTEGER NOT NULL REFERENCES workers(id),month TEXT NOT NULL,gross INTEGER NOT NULL,deductions TEXT NOT NULL,PRIMARY KEY(worker_id,month));
      CREATE TABLE IF NOT EXISTS safety_costs (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),category INTEGER NOT NULL,date TEXT NOT NULL,description TEXT NOT NULL,note TEXT NOT NULL,unit_price TEXT NOT NULL,quantity TEXT NOT NULL,unit TEXT NOT NULL,amount TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS safety_cost_photos (id INTEGER PRIMARY KEY,cost_id INTEGER NOT NULL REFERENCES safety_costs(id),name TEXT NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS safety_cost_report_photos (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),cost_id INTEGER NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS equipment (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),kind TEXT NOT NULL,model TEXT NOT NULL,capacity TEXT NOT NULL,manufacturer TEXT NOT NULL,registration TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_places (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),name TEXT NOT NULL,details TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rigging (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),category TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,details TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rigging_photos (id INTEGER PRIMARY KEY,rigging_id INTEGER NOT NULL REFERENCES rigging(id),name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS work_place_photos (id INTEGER PRIMARY KEY,place_id INTEGER NOT NULL REFERENCES work_places(id),name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS equipment_attachments (id INTEGER PRIMARY KEY,equipment_id INTEGER NOT NULL REFERENCES equipment(id),category TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS equipment_checks (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),equipment_id INTEGER NOT NULL REFERENCES equipment(id),date TEXT NOT NULL,items TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(document_id,equipment_id,date));
      CREATE TABLE IF NOT EXISTS workers (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id), name TEXT NOT NULL, category TEXT NOT NULL, company TEXT NOT NULL, occupation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_accounts (worker_id INTEGER PRIMARY KEY REFERENCES workers(id),site_id INTEGER NOT NULL REFERENCES sites(id),login_id TEXT NOT NULL,salt BLOB NOT NULL,password_hash BLOB NOT NULL,UNIQUE(site_id,login_id));
      CREATE TABLE IF NOT EXISTS worker_sessions (token_hash TEXT PRIMARY KEY,worker_id INTEGER NOT NULL REFERENCES workers(id),expires INTEGER NOT NULL,credential_hash BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_permissions (worker_id INTEGER NOT NULL REFERENCES workers(id),permission TEXT NOT NULL,PRIMARY KEY(worker_id,permission));
      CREATE TABLE IF NOT EXISTS worker_authored_documents (document_id INTEGER PRIMARY KEY REFERENCES documents(id),worker_id INTEGER NOT NULL REFERENCES workers(id));
      CREATE TABLE IF NOT EXISTS delegated_attendance_events (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),actor_id INTEGER NOT NULL REFERENCES workers(id),actor_name TEXT NOT NULL,worker_id INTEGER NOT NULL REFERENCES workers(id),worker_name TEXT NOT NULL,date TEXT NOT NULL,present INTEGER NOT NULL CHECK(present IN (0,1)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS worker_files (id INTEGER PRIMARY KEY,worker_id INTEGER NOT NULL REFERENCES workers(id),category TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS attendance (worker_id INTEGER NOT NULL REFERENCES workers(id), date TEXT NOT NULL, present INTEGER NOT NULL CHECK(present IN (0,1)), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(worker_id,date));
      CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id), type TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS basic_document_versions (document_id INTEGER PRIMARY KEY REFERENCES documents(id),version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_plan_copies (document_id INTEGER PRIMARY KEY REFERENCES documents(id),source_document_id INTEGER NOT NULL REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS office_document_copies (document_id INTEGER PRIMARY KEY REFERENCES documents(id),source_document_id INTEGER NOT NULL REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS office_reference_recipients (document_id INTEGER NOT NULL REFERENCES documents(id),reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),PRIMARY KEY(document_id,reviewer_id));
      CREATE TABLE IF NOT EXISTS reviewers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),login_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt BLOB NOT NULL,password_hash BLOB NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
      CREATE TABLE IF NOT EXISTS reviewer_sessions (token_hash TEXT PRIMARY KEY,reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),expires INTEGER NOT NULL,credential_hash BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS approval_steps (document_id INTEGER NOT NULL REFERENCES documents(id),position INTEGER NOT NULL,reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),PRIMARY KEY(document_id,position),UNIQUE(document_id,reviewer_id));
      CREATE TABLE IF NOT EXISTS approval_cycles (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),document_json TEXT NOT NULL,attachments_json TEXT NOT NULL,linked_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS office_reference_cycle_recipients (cycle_id INTEGER NOT NULL REFERENCES approval_cycles(id),reviewer_id INTEGER NOT NULL REFERENCES reviewers(id),PRIMARY KEY(cycle_id,reviewer_id));
      CREATE TABLE IF NOT EXISTS approval_cycle_files (cycle_id INTEGER NOT NULL REFERENCES approval_cycles(id),kind TEXT NOT NULL,parent_id INTEGER NOT NULL,file_id INTEGER NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(cycle_id,kind,parent_id,file_id));
      CREATE TABLE IF NOT EXISTS checklist_signatures (document_id INTEGER PRIMARY KEY REFERENCES documents(id),signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS tbm_signatures (document_id INTEGER PRIMARY KEY REFERENCES documents(id),signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS joint_inspection_signatures (document_id INTEGER PRIMARY KEY REFERENCES documents(id),signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS meeting_signatures (document_id INTEGER PRIMARY KEY REFERENCES documents(id),signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS worker_meeting_checks (document_id INTEGER NOT NULL REFERENCES documents(id),worker_id INTEGER NOT NULL REFERENCES workers(id),signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(document_id,worker_id));
      CREATE TABLE IF NOT EXISTS worker_notice_reads (worker_id INTEGER NOT NULL REFERENCES workers(id),document_id INTEGER NOT NULL REFERENCES documents(id),read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,document_id));
      CREATE TABLE IF NOT EXISTS worker_self_checks (worker_id INTEGER NOT NULL REFERENCES workers(id),date TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,date));
      CREATE TABLE IF NOT EXISTS manager_self_checks (site_id INTEGER NOT NULL REFERENCES sites(id),date TEXT NOT NULL,answers TEXT NOT NULL,signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(site_id,date));
      CREATE TABLE IF NOT EXISTS manager_days_off (site_id INTEGER NOT NULL REFERENCES sites(id),date TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(site_id,date));
      CREATE TABLE IF NOT EXISTS worker_training_checks (worker_id INTEGER NOT NULL REFERENCES workers(id),document_id INTEGER NOT NULL REFERENCES documents(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,document_id));
      CREATE TABLE IF NOT EXISTS worker_daily_training (worker_id INTEGER NOT NULL REFERENCES workers(id),date TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,date,kind));
      CREATE TABLE IF NOT EXISTS training_target_config (document_id INTEGER PRIMARY KEY REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS training_targets (document_id INTEGER NOT NULL REFERENCES documents(id),worker_id INTEGER NOT NULL REFERENCES workers(id),PRIMARY KEY(document_id,worker_id));
      CREATE TABLE IF NOT EXISTS work_stops (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),worker_id INTEGER REFERENCES workers(id),place TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS instruction_results (document_id INTEGER PRIMARY KEY REFERENCES documents(id),date TEXT NOT NULL,actor TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS instruction_photos (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES instruction_results(document_id),phase TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS invitations (token_hash TEXT PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id), expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS join_acknowledgements (worker_id INTEGER PRIMARY KEY REFERENCES workers(id),notice_version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS risk_activities (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), kind TEXT NOT NULL,date TEXT NOT NULL,place TEXT NOT NULL,host TEXT NOT NULL,participants TEXT NOT NULL,content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS permit_checks (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),date TEXT NOT NULL,items TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS permit_extensions (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,time_from TEXT NOT NULL,time_to TEXT NOT NULL,signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS risk_activity_photos (id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES risk_activities(id) ON DELETE CASCADE, name TEXT NOT NULL,data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS risk_activity_signatures (activity_id INTEGER PRIMARY KEY REFERENCES risk_activities(id) ON DELETE CASCADE,signature BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS hazard_reports (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),title TEXT NOT NULL,body TEXT NOT NULL,reporter TEXT NOT NULL,photo BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    if (!this.db.prepare('PRAGMA table_info(documents)').all().some(c=>c.name==='details')) this.db.exec("ALTER TABLE documents ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS basic_category_insert BEFORE INSERT ON documents WHEN NEW.type='basic' AND COALESCE(json_extract(NEW.details,'$.categoryId'),0)>0 AND NOT EXISTS(SELECT 1 FROM basic_categories WHERE id=json_extract(NEW.details,'$.categoryId') AND site_id=NEW.site_id) BEGIN SELECT RAISE(ABORT,'기본 서류 분류를 확인해 주세요.'); END;
      CREATE TRIGGER IF NOT EXISTS basic_category_update BEFORE UPDATE OF details,site_id,type ON documents WHEN NEW.type='basic' AND COALESCE(json_extract(NEW.details,'$.categoryId'),0)>0 AND NOT EXISTS(SELECT 1 FROM basic_categories WHERE id=json_extract(NEW.details,'$.categoryId') AND site_id=NEW.site_id) BEGIN SELECT RAISE(ABORT,'기본 서류 분류를 확인해 주세요.'); END;`);
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.exec(`INSERT OR IGNORE INTO basic_document_versions(document_id,version) SELECT id,lower(hex(randomblob(16))) FROM documents WHERE type='basic';
      CREATE TRIGGER IF NOT EXISTS basic_version_insert AFTER INSERT ON documents WHEN NEW.type='basic' BEGIN INSERT INTO basic_document_versions(document_id,version) VALUES(NEW.id,lower(hex(randomblob(16)))); END;
      CREATE TRIGGER IF NOT EXISTS basic_version_update AFTER UPDATE ON documents WHEN NEW.type='basic' BEGIN UPDATE basic_document_versions SET version=lower(hex(randomblob(16))) WHERE document_id=NEW.id; END;`);
      for(const table of ['attachments','events','approval_steps','approval_cycles'])for(const action of ['INSERT','UPDATE','DELETE']){
        const ids=action==='INSERT'?'NEW.document_id':action==='DELETE'?'OLD.document_id':'OLD.document_id,NEW.document_id';
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS basic_version_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN UPDATE basic_document_versions SET version=lower(hex(randomblob(16))) WHERE document_id IN (${ids}); END;`);
      }this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.db.exec('BEGIN IMMEDIATE');try{
      if(!this.db.prepare('PRAGMA table_info(reviewers)').all().some(c=>c.name==='auth_version'))this.db.exec("ALTER TABLE reviewers ADD COLUMN auth_version TEXT NOT NULL DEFAULT ''");
      if(!this.db.prepare('PRAGMA table_info(invitations)').all().some(c=>c.name==='pending'))this.db.exec('ALTER TABLE invitations ADD COLUMN pending INTEGER NOT NULL DEFAULT 0 CHECK(pending IN (0,1))');
      this.db.exec("UPDATE reviewers SET auth_version=lower(hex(randomblob(16))) WHERE auth_version=''");
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if (!this.db.prepare('PRAGMA table_info(meal_checks)').all().some(c=>c.name==='tax_snapshot')) this.db.exec('ALTER TABLE meal_checks ADD COLUMN tax_snapshot INTEGER CHECK(tax_snapshot IS NULL OR tax_snapshot BETWEEN 0 AND 999999999)');
    if (!this.db.prepare('PRAGMA table_info(documents)').all().some(c=>c.name==='approval_cycle_id')) this.db.exec('ALTER TABLE documents ADD COLUMN approval_cycle_id INTEGER');
    if (!this.db.prepare('PRAGMA table_info(workers)').all().some(c=>c.name==='created_date')) this.db.exec('ALTER TABLE workers ADD COLUMN created_date TEXT');
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='opinion')) this.db.exec("ALTER TABLE events ADD COLUMN opinion TEXT NOT NULL DEFAULT ''");
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE events ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='reviewer_id')) this.db.exec('ALTER TABLE events ADD COLUMN reviewer_id INTEGER REFERENCES reviewers(id)');
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='reviewer_name')) this.db.exec('ALTER TABLE events ADD COLUMN reviewer_name TEXT');
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='approval_cycle_id')) this.db.exec('ALTER TABLE events ADD COLUMN approval_cycle_id INTEGER');
    if (!this.db.prepare('PRAGMA table_info(work_stops)').all().some(c=>c.name==='photo')) this.db.exec('ALTER TABLE work_stops ADD COLUMN photo BLOB');
    if (!this.db.prepare('PRAGMA table_info(work_stops)').all().some(c=>c.name==='response')) this.db.exec('ALTER TABLE work_stops ADD COLUMN response TEXT');
    if (!this.db.prepare('PRAGMA table_info(worker_self_checks)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE worker_self_checks ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(worker_self_checks)').all().some(c=>c.name==='answers')) this.db.exec('ALTER TABLE worker_self_checks ADD COLUMN answers TEXT');
    if (!this.db.prepare('PRAGMA table_info(attachments)').all().some(c=>c.name==='category')) this.db.exec("ALTER TABLE attachments ADD COLUMN category TEXT NOT NULL DEFAULT 'general'");
    if (!this.db.prepare('PRAGMA table_info(worker_daily_training)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE worker_daily_training ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(join_acknowledgements)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE join_acknowledgements ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(join_acknowledgements)').all().some(c=>c.name==='equipment')) this.db.exec("ALTER TABLE join_acknowledgements ADD COLUMN equipment TEXT NOT NULL DEFAULT '[]'");
    if (!this.db.prepare('PRAGMA table_info(join_acknowledgements)').all().some(c=>c.name==='profile')) this.db.exec('ALTER TABLE join_acknowledgements ADD COLUMN profile TEXT');
    for(const [key,definition] of [['period_from',"TEXT NOT NULL DEFAULT ''"],['period_to',"TEXT NOT NULL DEFAULT ''"],['entry_mode',"TEXT NOT NULL DEFAULT 'manual'"]])if(!this.db.prepare('PRAGMA table_info(risk_activities)').all().some(c=>c.name===key))this.db.exec(`ALTER TABLE risk_activities ADD COLUMN ${key} ${definition}`);
    if(!this.db.prepare('PRAGMA table_info(risk_activities)').all().some(c=>c.name==='worker_snapshot'))this.db.exec("ALTER TABLE risk_activities ADD COLUMN worker_snapshot TEXT NOT NULL DEFAULT '[]'");
    if(!this.db.prepare('PRAGMA table_info(risk_activities)').all().some(c=>c.name==='classification'))this.db.exec("ALTER TABLE risk_activities ADD COLUMN classification TEXT NOT NULL DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(risk_activity_photos)').all().some(c=>c.name==='purpose'))this.db.exec("ALTER TABLE risk_activity_photos ADD COLUMN purpose TEXT NOT NULL DEFAULT 'photo'");
    if(!this.db.prepare('PRAGMA table_info(hazard_reports)').all().some(c=>c.name==='worker_id'))this.db.exec('ALTER TABLE hazard_reports ADD COLUMN worker_id INTEGER REFERENCES workers(id)');
    if(!this.db.prepare('PRAGMA table_info(hazard_reports)').all().some(c=>c.name==='status'))this.db.exec("ALTER TABLE hazard_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'received'");
    if(!this.db.prepare('PRAGMA table_info(hazard_reports)').all().some(c=>c.name==='response'))this.db.exec("ALTER TABLE hazard_reports ADD COLUMN response TEXT NOT NULL DEFAULT ''");
    if (!this.db.prepare('PRAGMA table_info(worker_notice_reads)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE worker_notice_reads ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(worker_training_checks)').all().some(c=>c.name==='rights_ack')) this.db.exec('ALTER TABLE worker_training_checks ADD COLUMN rights_ack TEXT');
    if (!this.db.prepare('PRAGMA table_info(worker_training_checks)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE worker_training_checks ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(equipment)').all().some(c=>c.name==='details')) this.db.exec("ALTER TABLE equipment ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    if (!this.db.prepare('PRAGMA table_info(equipment_checks)').all().some(c=>c.name==='equipment_snapshot')) this.db.exec('ALTER TABLE equipment_checks ADD COLUMN equipment_snapshot TEXT');
    if (!this.db.prepare('PRAGMA table_info(equipment_checks)').all().some(c=>c.name==='inspector')) this.db.exec('ALTER TABLE equipment_checks ADD COLUMN inspector TEXT');
    if (!this.db.prepare('PRAGMA table_info(equipment_checks)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE equipment_checks ADD COLUMN signature BLOB');
    if (!this.db.prepare('PRAGMA table_info(instruction_results)').all().some(c=>c.name==='source')) this.db.exec("ALTER TABLE instruction_results ADD COLUMN source TEXT NOT NULL DEFAULT 'manager'");
    if (!this.db.prepare('PRAGMA table_info(instruction_results)').all().some(c=>c.name==='signature')) this.db.exec('ALTER TABLE instruction_results ADD COLUMN signature BLOB');
    const attendanceColumns=this.db.prepare('PRAGMA table_info(attendance)').all().map(c=>c.name);
    const wageColumns=this.db.prepare('PRAGMA table_info(wage_records)').all().map(c=>c.name);
    for(const column of ['name_snapshot','company_snapshot','occupation_snapshot','category_snapshot','birth_date_snapshot','remark'])if(!wageColumns.includes(column))this.db.exec(`ALTER TABLE wage_records ADD COLUMN ${column} TEXT`);
    if(!attendanceColumns.includes('company_snapshot'))this.db.exec('ALTER TABLE attendance ADD COLUMN company_snapshot TEXT');
    if(!attendanceColumns.includes('occupation_snapshot'))this.db.exec('ALTER TABLE attendance ADD COLUMN occupation_snapshot TEXT');
    if(!attendanceColumns.includes('category_snapshot'))this.db.exec('ALTER TABLE attendance ADD COLUMN category_snapshot TEXT');
    if(!attendanceColumns.includes('source'))this.db.exec('ALTER TABLE attendance ADD COLUMN source TEXT');
    if(!attendanceColumns.includes('units_hundredths'))this.db.exec('ALTER TABLE attendance ADD COLUMN units_hundredths INTEGER CHECK(units_hundredths IS NULL OR units_hundredths BETWEEN 0 AND 999)');
    if(!attendanceColumns.includes('daily_rate'))this.db.exec('ALTER TABLE attendance ADD COLUMN daily_rate INTEGER CHECK(daily_rate IS NULL OR daily_rate BETWEEN 0 AND 999999999)');
    if(!attendanceColumns.includes('salary_kind'))this.db.exec("ALTER TABLE attendance ADD COLUMN salary_kind TEXT CHECK(salary_kind IS NULL OR salary_kind IN ('monthly','yearly','other'))");
    if(!attendanceColumns.includes('salary_amount'))this.db.exec('ALTER TABLE attendance ADD COLUMN salary_amount INTEGER CHECK(salary_amount IS NULL OR salary_amount BETWEEN 0 AND 999999999)');
  }
  close() { this.db.close(); }
  managerChecks(siteId) {
    return this.db.prepare("SELECT date,answers,created_at,'check' AS kind FROM manager_self_checks WHERE site_id=? UNION ALL SELECT date,NULL AS answers,created_at,'day_off' AS kind FROM manager_days_off WHERE site_id=? ORDER BY date DESC LIMIT 30").all(Number(siteId),Number(siteId));
  }
  saveManagerCheck(siteId,date,answers,signature) {
    date=dateValue(date);
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(Number(siteId)))throw new Error('현장을 선택해 주세요.');
    if(!Array.isArray(answers) || answers.length!==3 || answers.some(a=>!a || !['O','X'].includes(a.answer) || typeof a.note!=='string' || a.note.length>500))throw new Error('세 항목의 O/X와 비고를 확인해 주세요.');
    const bytes=signatureBytes(signature);
    this.db.exec('BEGIN IMMEDIATE');try{if(this.db.prepare('SELECT 1 FROM manager_self_checks WHERE site_id=? AND date=? UNION ALL SELECT 1 FROM manager_days_off WHERE site_id=? AND date=?').get(Number(siteId),date,Number(siteId),date))throw new Error('오늘의 시험 점검 또는 휴무가 이미 저장되었습니다.');this.db.prepare('INSERT INTO manager_self_checks(site_id,date,answers,signature) VALUES(?,?,?,?)').run(Number(siteId),date,JSON.stringify(answers),bytes);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  saveManagerDayOff(siteId,date){
    date=dateValue(date);siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');try{if(this.db.prepare('SELECT 1 FROM manager_self_checks WHERE site_id=? AND date=? UNION ALL SELECT 1 FROM manager_days_off WHERE site_id=? AND date=?').get(siteId,date,siteId,date))throw new Error('오늘의 시험 점검 또는 휴무가 이미 저장되었습니다.');this.db.prepare('INSERT INTO manager_days_off(site_id,date) VALUES(?,?)').run(siteId,date);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  sites() { return this.db.prepare('SELECT * FROM sites ORDER BY name').all(); }
  sitePhotos(siteId,from='',to='',query=''){
    if(from)from=dateValue(from);if(to)to=dateValue(to);if(from&&to&&from>to)throw new Error('조회 기간을 확인해 주세요.');if(typeof query!=='string'||query.length>200)throw new Error('검색어를 확인해 주세요.');
    return this.db.prepare("SELECT id,name,date,description FROM site_photos WHERE site_id=? AND (?='' OR date>=?) AND (?='' OR date<=?) AND (instr(name,?)>0 OR instr(description,?)>0) ORDER BY date DESC,id DESC").all(Number(siteId),from,from,to,to,query,query);
  }
  addSitePhoto(siteId,name,data){
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const bytes=Buffer.from(data);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
    const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    return this.db.prepare('INSERT INTO site_photos(site_id,name,date,data) VALUES(?,?,?,?)').run(siteId,name,date,bytes).lastInsertRowid;
  }
  sitePhoto(siteId,id){return this.db.prepare('SELECT * FROM site_photos WHERE site_id=? AND id=?').get(Number(siteId),Number(id))||null;}
  updateSitePhoto(siteId,id,input){
    const date=dateValue(input.date);if(typeof input.description!=='string'||input.description.length>2000)throw new Error('사진 설명을 확인해 주세요.');
    if(!this.db.prepare('UPDATE site_photos SET date=?,description=? WHERE site_id=? AND id=?').run(date,input.description.trim(),Number(siteId),Number(id)).changes)throw new Error('사진을 찾을 수 없습니다.');
  }
  deleteSitePhoto(siteId,id){if(!this.db.prepare('DELETE FROM site_photos WHERE site_id=? AND id=?').run(Number(siteId),Number(id)).changes)throw new Error('사진을 찾을 수 없습니다.');}
  boardPosts(kind,query=''){
    if(!['notice','question','general'].includes(kind)||typeof query!=='string'||query.length>200)throw new Error('게시판 또는 검색어를 확인해 주세요.');
    return this.db.prepare('SELECT * FROM board_posts WHERE kind=? AND (instr(title,?)>0 OR instr(body,?)>0) ORDER BY id DESC').all(kind,query,query);
  }
  saveBoardPost(input,id=null){
    if(!['notice','question','general'].includes(input.kind)||typeof input.secret!=='boolean'||(input.secret&&input.kind!=='question'))throw new Error('게시판과 비밀글 설정을 확인해 주세요.');
    const title=text(input.title,'제목'),body=text(input.body,'내용',10000),secret=input.secret?1:0;
    if(id===null)id=this.db.prepare('INSERT INTO board_posts(kind,title,body,secret) VALUES(?,?,?,?)').run(input.kind,title,body,secret).lastInsertRowid;
    else if(!this.db.prepare('UPDATE board_posts SET title=?,body=?,secret=? WHERE id=? AND kind=?').run(title,body,secret,Number(id),input.kind).changes)throw new Error('게시글을 찾을 수 없습니다.');
    return this.db.prepare('SELECT * FROM board_posts WHERE id=?').get(Number(id));
  }
  deleteBoardPost(kind,id){if(!['notice','question','general'].includes(kind)||!this.db.prepare('DELETE FROM board_posts WHERE kind=? AND id=?').run(kind,Number(id)).changes)throw new Error('게시글을 찾을 수 없습니다.');}
  schedules(siteId,month,query='') {
    month=monthValue(month);if(typeof query!=='string'||query.length>200)throw new Error('검색어를 확인해 주세요.');
    return this.db.prepare('SELECT * FROM schedules WHERE site_id=? AND substr(start_date,1,7)<=? AND substr(end_date,1,7)>=? AND instr(content,?)>0 ORDER BY start_date,start_time,id').all(Number(siteId),month,month,query);
  }
  saveSchedule(input,id=null){
    const siteId=Number(input.siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(!scheduleTypes.includes(input.kind))throw new Error('일정 구분을 확인해 주세요.');
    const start=dateValue(input.startDate),end=dateValue(input.endDate),startTime=input.startTime??'',endTime=input.endTime??'',content=text(input.content,'일정 내용',200);
    if(![startTime,endTime].every(t=>typeof t==='string'&&(t===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))||start>end||(start===end&&startTime&&endTime&&startTime>endTime))throw new Error('일정 기간과 시간을 확인해 주세요.');
    if(id===null)id=this.db.prepare('INSERT INTO schedules(site_id,kind,start_date,end_date,start_time,end_time,content) VALUES(?,?,?,?,?,?,?)').run(siteId,input.kind,start,end,startTime,endTime,content).lastInsertRowid;
    else if(!this.db.prepare('UPDATE schedules SET kind=?,start_date=?,end_date=?,start_time=?,end_time=?,content=? WHERE id=? AND site_id=?').run(input.kind,start,end,startTime,endTime,content,Number(id),siteId).changes)throw new Error('선택한 현장의 일정을 확인해 주세요.');
    return this.db.prepare('SELECT * FROM schedules WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  deleteSchedule(siteId,id){if(!this.db.prepare('DELETE FROM schedules WHERE site_id=? AND id=?').run(Number(siteId),Number(id)).changes)throw new Error('선택한 현장의 일정을 확인해 주세요.');}
  siteArticles(siteId,category='',query='') {
    if(!['','안전·보건','기타'].includes(category)||typeof query!=='string'||query.length>200)throw new Error('검색 조건을 확인해 주세요.');
    return this.db.prepare("SELECT id,category,title,body,visible,created_at FROM site_articles WHERE site_id=? AND (?='' OR category=?) AND (instr(title,?)>0 OR instr(body,?)>0) ORDER BY id DESC").all(Number(siteId),category,category,query,query).map(a=>({...a,files:this.articleFiles(a.id)}));
  }
  workerArticles(workerId) {
    return this.db.prepare('SELECT a.id,a.category,a.title,a.body,a.created_at FROM site_articles a JOIN workers w ON w.site_id=a.site_id WHERE w.id=? AND a.visible=1 ORDER BY a.id DESC').all(Number(workerId)).map(a=>({...a,files:this.articleFiles(a.id)}));
  }
  articleFiles(articleId){return this.db.prepare('SELECT id,name,length(data) AS size FROM site_article_files WHERE article_id=? ORDER BY id').all(Number(articleId));}
  addArticleFile(siteId,articleId,name,data){
    if(!this.db.prepare('SELECT 1 FROM site_articles WHERE id=? AND site_id=?').get(Number(articleId),Number(siteId)))throw new Error('선택한 현장의 게시글을 확인해 주세요.');
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('파일 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('파일은 1바이트 이상 2MB 이하여야 합니다.');
    if(this.articleFiles(articleId).length>=20)throw new Error('첨부파일은 게시글당 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO site_article_files(article_id,name,data) VALUES(?,?,?)').run(Number(articleId),name,data).lastInsertRowid;
  }
  articleFile(siteId,articleId,fileId){return this.db.prepare('SELECT f.* FROM site_article_files f JOIN site_articles a ON a.id=f.article_id WHERE a.site_id=? AND a.id=? AND f.id=?').get(Number(siteId),Number(articleId),Number(fileId))||null;}
  workerArticleFile(workerId,articleId,fileId){return this.db.prepare('SELECT f.* FROM site_article_files f JOIN site_articles a ON a.id=f.article_id JOIN workers w ON w.site_id=a.site_id WHERE w.id=? AND a.visible=1 AND a.id=? AND f.id=?').get(Number(workerId),Number(articleId),Number(fileId))||null;}
  deleteArticleFile(siteId,articleId,fileId){if(!this.articleFile(siteId,articleId,fileId))throw new Error('첨부파일을 찾을 수 없습니다.');this.db.prepare('DELETE FROM site_article_files WHERE id=?').run(Number(fileId));}
  saveSiteArticle(input,id=null) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(!['안전·보건','기타'].includes(input.category)||typeof input.visible!=='boolean')throw new Error('분류와 공개 설정을 확인해 주세요.');
    const title=text(input.title,'제목'),body=text(input.body,'내용',10000),visible=input.visible?1:0;
    if(id===null)id=this.db.prepare('INSERT INTO site_articles(site_id,category,title,body,visible) VALUES(?,?,?,?,?)').run(siteId,input.category,title,body,visible).lastInsertRowid;
    else if(!this.db.prepare('UPDATE site_articles SET category=?,title=?,body=?,visible=? WHERE id=? AND site_id=?').run(input.category,title,body,visible,Number(id),siteId).changes)throw new Error('선택한 현장의 게시글을 확인해 주세요.');
    return this.db.prepare('SELECT id,category,title,body,visible,created_at FROM site_articles WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  createSite(input) {
    const name = text(input.name, '현장명');
    const id = this.db.prepare('INSERT INTO sites(name) VALUES (?)').run(name).lastInsertRowid;
    return this.db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  }
  companies(siteId) {
    return this.db.prepare('SELECT * FROM companies WHERE site_id=? ORDER BY name,id').all(Number(siteId));
  }
  siteOccupations(siteId){return this.db.prepare('SELECT id,name FROM site_occupations WHERE site_id=? ORDER BY name,id').all(Number(siteId));}
  basicCategories(siteId){
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const rows=this.db.prepare('SELECT id,parent_id,name,description,position FROM basic_categories WHERE site_id=? ORDER BY position,id').all(siteId);
    const docs=this.db.prepare("SELECT d.id,json_extract(d.details,'$.categoryId') AS category_id,v.version FROM documents d JOIN basic_document_versions v ON v.document_id=d.id WHERE d.site_id=? AND d.type='basic' AND COALESCE(json_extract(d.details,'$.categoryId'),0)>0").all(siteId);
    return rows.map(row=>{const linked=docs.filter(doc=>doc.category_id===row.id);return {...row,documentIds:linked.map(doc=>doc.id),documentVersions:linked.map(doc=>({id:doc.id,version:doc.version}))};});
  }
  saveBasicCategory(siteId,input,id=null){
    siteId=Number(siteId);const name=text(input.name,'분류 이름',80),description=input.description??'';
    if(typeof description!=='string'||description.length>2000)throw new Error('분류 설명을 확인해 주세요.');
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(id!==null){const result=this.db.prepare('UPDATE basic_categories SET name=?,description=? WHERE id=? AND site_id=?').run(name,description.trim(),Number(id),siteId);if(!result.changes)throw new Error('분류를 찾을 수 없습니다.');return Number(id);}
    const parentId=input.parentId??0;if(!Number.isSafeInteger(parentId)||parentId<0)throw new Error('상위 분류를 확인해 주세요.');
    if(parentId&&!this.db.prepare('SELECT 1 FROM basic_categories WHERE id=? AND site_id=? AND parent_id IS NULL').get(parentId,siteId))throw new Error('상위 분류를 확인해 주세요.');
    return Number(this.db.prepare('INSERT INTO basic_categories(site_id,parent_id,name,description,position) VALUES(?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM basic_categories WHERE site_id=? AND parent_id IS ?))').run(siteId,parentId||null,name,description.trim(),siteId,parentId||null).lastInsertRowid);
  }
  orderBasicCategories(siteId,input){
    siteId=Number(siteId);const parentId=input.parentId??0,ids=input.ids,expectedIds=input.expectedIds;
    const valid=values=>Array.isArray(values)&&values.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(values).size===values.length;
    if(!Number.isSafeInteger(parentId)||parentId<0||!valid(ids)||!valid(expectedIds))throw new Error('분류 순서를 확인해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');try{
      const current=this.basicCategories(siteId).filter(row=>(row.parent_id||0)===parentId).map(row=>row.id);
      if(JSON.stringify(current)!==JSON.stringify(expectedIds)||JSON.stringify([...current].sort((a,b)=>a-b))!==JSON.stringify([...ids].sort((a,b)=>a-b)))throw new Error('분류 목록이 변경되었습니다. 다시 조회해 주세요.');
      const update=this.db.prepare('UPDATE basic_categories SET position=? WHERE site_id=? AND id=?');ids.forEach((id,index)=>update.run(index+1,siteId,id));this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  deleteBasicCategory(siteId,id,input){
    siteId=Number(siteId);id=Number(id);
    if(!Array.isArray(input.expectedCategories)||input.expectedCategories.some(item=>!item||!Number.isSafeInteger(item.id)||item.id<1||!(item.parent_id===null||Number.isSafeInteger(item.parent_id))||typeof item.name!=='string'||typeof item.description!=='string'||!Number.isSafeInteger(item.position))||new Set(input.expectedCategories.map(item=>item.id)).size!==input.expectedCategories.length||!Array.isArray(input.expectedDocumentVersions)||input.expectedDocumentVersions.some(item=>!item||!Number.isSafeInteger(item.id)||item.id<1||typeof item.version!=='string'||!/^[a-f0-9]{32}$/.test(item.version))||new Set(input.expectedDocumentVersions.map(item=>item.id)).size!==input.expectedDocumentVersions.length)throw new Error('삭제할 분류와 문서를 다시 확인해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');try{
      const all=this.basicCategories(siteId),item=all.find(row=>row.id===id);if(!item)throw new Error('분류를 찾을 수 없습니다.');
      const selected=all.filter(row=>row.id===id||row.parent_id===id),versions=selected.flatMap(row=>row.documentVersions),documentIds=versions.map(item=>item.id);
      const sameCategories=(a,b)=>JSON.stringify([...a].map(({id,parent_id,name,description,position})=>({id,parent_id,name,description,position})).sort((x,y)=>x.id-y.id))===JSON.stringify([...b].map(({id,parent_id,name,description,position})=>({id,parent_id,name,description,position})).sort((x,y)=>x.id-y.id));
      const sameVersions=(a,b)=>JSON.stringify([...a].map(({id,version})=>({id,version})).sort((x,y)=>x.id-y.id))===JSON.stringify([...b].map(({id,version})=>({id,version})).sort((x,y)=>x.id-y.id));
      if(!sameCategories(selected,input.expectedCategories)||!sameVersions(versions,input.expectedDocumentVersions))throw new Error('분류나 문서가 변경되었습니다. 다시 조회해 주세요.');
      for(const docId of documentIds)this.removeBasicDocumentData(siteId,docId);
      this.db.prepare('DELETE FROM basic_categories WHERE site_id=? AND parent_id=?').run(siteId,id);
      this.db.prepare('DELETE FROM basic_categories WHERE site_id=? AND id=?').run(siteId,id);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  removeBasicDocumentData(siteId,id){
    this.db.prepare('DELETE FROM approval_cycle_files WHERE cycle_id IN (SELECT id FROM approval_cycles WHERE document_id=?)').run(id);
    for(const table of ['events','approval_steps','approval_cycles','attachments','basic_document_versions'])this.db.prepare(`DELETE FROM ${table} WHERE document_id=?`).run(id);
    this.db.prepare("DELETE FROM documents WHERE id=? AND site_id=? AND type='basic'").run(id,siteId);
  }
  deleteBasicDocument(siteId,id,expectedVersion){
    siteId=Number(siteId);id=Number(id);if(typeof expectedVersion!=='string'||!/^[a-f0-9]{32}$/.test(expectedVersion))throw new Error('문서를 다시 조회해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');try{
      const doc=this.document(id);if(!doc||doc.type!=='basic'||doc.site_id!==siteId)throw new Error('선택한 현장의 기본 서류를 확인해 주세요.');
      if(doc.basic_version!==expectedVersion)throw new Error('문서가 변경되었습니다. 다시 조회해 주세요.');
      this.removeBasicDocumentData(siteId,id);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  validateBasicCategory(doc){
    if(doc.type!=='basic'||!doc.details.categoryId)return;
    const category=this.db.prepare('SELECT c.name,p.name AS parent_name FROM basic_categories c LEFT JOIN basic_categories p ON p.id=c.parent_id WHERE c.site_id=? AND c.id=?').get(doc.siteId,doc.details.categoryId);
    if(!category)throw new Error('기본 서류 분류를 확인해 주세요.');
    doc.details.category=category.parent_name?`${category.parent_name} / ${category.name}`:category.name;
  }
  ppeIssues(siteId,month){
    month=monthValue(month);siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const rows=this.db.prepare('SELECT id,date,item,quantity,worker_id,worker_snapshot FROM ppe_issues WHERE site_id=? AND date BETWEEN ? AND ? ORDER BY date DESC,id DESC').all(siteId,`${month}-01`,`${month}-31`).map(({worker_snapshot,...row})=>({...row,worker:JSON.parse(worker_snapshot)}));
    const totals=this.db.prepare('SELECT item,SUM(quantity) AS quantity FROM ppe_issues WHERE site_id=? AND date BETWEEN ? AND ? GROUP BY item ORDER BY item').all(siteId,`${month}-01`,`${month}-31`);return {rows,totals};
  }
  workerPpeIssues(siteId,workerId){
    siteId=Number(siteId);workerId=Number(workerId);if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(workerId,siteId))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    return this.db.prepare('SELECT id,date,item,quantity FROM ppe_issues WHERE site_id=? AND worker_id=? ORDER BY date DESC,id DESC').all(siteId,workerId);
  }
  workerFiles(siteId,workerId){
    siteId=Number(siteId);workerId=Number(workerId);if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(workerId,siteId))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    return this.db.prepare('SELECT id,category,name,length(data) AS size,created_at FROM worker_files WHERE worker_id=? ORDER BY id').all(workerId);
  }
  addWorkerFile(siteId,workerId,category,name,data){
    const files=this.workerFiles(siteId,workerId);if(files.length>=20)throw new Error('첨부파일은 출입자당 20개까지 가능합니다.');
    if(!['agreement','identity','training','license','bank','other'].includes(category))throw new Error('서류 종류를 확인해 주세요.');
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\\\/\x00-\x1f\x7f]/.test(name))throw new Error('파일 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('파일은 1바이트 이상 2MB 이하여야 합니다.');
    return this.db.prepare('INSERT INTO worker_files(worker_id,category,name,data) VALUES(?,?,?,?)').run(Number(workerId),category,name,data).lastInsertRowid;
  }
  workerFile(siteId,workerId,fileId){return this.db.prepare('SELECT f.* FROM worker_files f JOIN workers w ON w.id=f.worker_id WHERE w.site_id=? AND w.id=? AND f.id=?').get(Number(siteId),Number(workerId),Number(fileId))||null;}
  deleteWorkerFile(siteId,workerId,fileId){if(!this.workerFile(siteId,workerId,fileId))throw new Error('첨부파일을 찾을 수 없습니다.');this.db.prepare('DELETE FROM worker_files WHERE id=?').run(Number(fileId));}
  addPpeIssue(input){
    const siteId=Number(input.siteId),workerId=Number(input.workerId),{date,item,quantity}=ppeValues(input);
    const worker=this.db.prepare('SELECT name,category,company,occupation FROM workers WHERE id=? AND site_id=?').get(workerId,siteId);if(!worker)throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    return this.db.prepare('INSERT INTO ppe_issues(site_id,worker_id,date,item,quantity,worker_snapshot) VALUES(?,?,?,?,?,?)').run(siteId,workerId,date,item,quantity,JSON.stringify(worker)).lastInsertRowid;
  }
  updatePpeIssue(id,input){
    const {date,item,quantity}=ppeValues(input);
    if(!this.db.prepare('UPDATE ppe_issues SET date=?,item=?,quantity=? WHERE id=? AND site_id=?').run(date,item,quantity,Number(id),Number(input.siteId)).changes)throw new Error('선택한 현장의 지급 기록을 확인해 주세요.');
  }
  deletePpeIssue(siteId,id){
    if(!this.db.prepare('DELETE FROM ppe_issues WHERE id=? AND site_id=?').run(Number(id),Number(siteId)).changes)throw new Error('선택한 현장의 지급 기록을 확인해 주세요.');
  }
  addSiteOccupation(siteId,name){
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    name=text(name,'직종');const result=this.db.prepare('INSERT INTO site_occupations(site_id,name) VALUES(?,?) ON CONFLICT(site_id,name) DO NOTHING').run(siteId,name);if(!result.changes)throw new Error('이미 등록된 직종입니다.');return result.lastInsertRowid;
  }
  deleteSiteOccupation(siteId,id){if(!this.db.prepare('DELETE FROM site_occupations WHERE site_id=? AND id=?').run(Number(siteId),Number(id)).changes)throw new Error('직종을 찾을 수 없습니다.');}
  restaurants(siteId) {
    return this.db.prepare('SELECT * FROM restaurants WHERE site_id=? ORDER BY name,id').all(Number(siteId));
  }
  mealDefaults(siteId,group='direct') {
    if(!['direct','manager'].includes(group))throw new Error('자동 식대 대상 구분을 확인해 주세요.');
    const table=group==='manager'?'manager_meal_defaults':'meal_defaults';
    return this.db.prepare(`SELECT kind,restaurant_id FROM ${table} WHERE site_id=? ORDER BY kind`).all(Number(siteId));
  }
  saveMealDefaults(siteId,items,group='direct') {
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(!['direct','manager'].includes(group))throw new Error('자동 식대 대상 구분을 확인해 주세요.');
    const table=group==='manager'?'manager_meal_defaults':'meal_defaults',kinds=group==='manager'?['breakfast','lunch','dinner']:['breakfast','lunch','dinner','snack'];
    if(!Array.isArray(items)||items.length>4||new Set(items.map(x=>x?.kind)).size!==items.length)throw new Error('자동 식대 설정을 확인해 주세요.');
    for(const item of items){if(!item||!kinds.includes(item.kind)||!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND site_id=?').get(Number(item.restaurantId),siteId))throw new Error('식사 종류와 현장의 식당을 확인해 주세요.');}
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare(`DELETE FROM ${table} WHERE site_id=?`).run(siteId);const insert=this.db.prepare(`INSERT INTO ${table}(site_id,kind,restaurant_id) VALUES(?,?,?)`);for(const item of items)insert.run(siteId,item.kind,Number(item.restaurantId));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.mealDefaults(siteId,group);
  }
  applyMealDefaults(workerId,date) {
    const category=this.db.prepare('SELECT category FROM workers WHERE id=?').get(Number(workerId))?.category,table=category==='직영'?'meal_defaults':category==='현장관리자'?'manager_meal_defaults':null;if(!table)return;
    this.db.prepare(`INSERT OR IGNORE INTO meal_checks(site_id,worker_id,date,kind,restaurant_id,restaurant_name,price,tax_snapshot) SELECT w.site_id,w.id,?,d.kind,r.id,r.name,CASE WHEN d.kind='snack' THEN r.snack_price ELSE r.meal_price END,CASE WHEN d.kind='snack' THEN NULL ELSE r.tax END FROM workers w JOIN ${table} d ON d.site_id=w.site_id JOIN restaurants r ON r.id=d.restaurant_id AND r.site_id=w.site_id WHERE w.id=?`).run(date,Number(workerId));
  }
  wageRecords(siteId,month,filters={}) {
    month=monthValue(month);
    return this.db.prepare("SELECT r.worker_id,r.month,r.gross,r.deductions,r.birth_date_snapshot,r.remark,r.category_snapshot AS category,COALESCE(r.name_snapshot,'기록 없음') AS name,COALESCE(r.company_snapshot,'기록 없음') AS company,COALESCE(r.occupation_snapshot,'기록 없음') AS occupation,COUNT(a.date) AS attendance_days,SUM(a.units_hundredths) AS units_hundredths,COUNT(a.date)-COUNT(a.units_hundredths) AS units_missing,SUM(CASE WHEN a.salary_kind IS NULL AND a.daily_rate IS NOT NULL AND a.units_hundredths IS NOT NULL THEN (a.daily_rate*a.units_hundredths+50)/100 END) AS estimated_pay,COUNT(a.date)-COUNT(CASE WHEN a.salary_kind IS NULL AND a.daily_rate IS NOT NULL AND a.units_hundredths IS NOT NULL THEN a.date END) AS pay_missing FROM wage_records r JOIN workers w ON w.id=r.worker_id AND w.site_id=r.site_id LEFT JOIN attendance a ON a.worker_id=r.worker_id AND a.present=1 AND a.date BETWEEN ? AND ? WHERE r.site_id=? AND r.month=? GROUP BY r.worker_id,r.month ORDER BY name,w.id").all(`${month}-01`,`${month}-31`,Number(siteId),month).map(row=>{const deductions=JSON.parse(row.deductions),total=Object.values(deductions).reduce((a,b)=>a+b,0);return {...row,deductions,total,net:row.gross-total};}).filter(row=>(!filters.company||row.company===filters.company)&&(!filters.category||row.category===filters.category)&&(!filters.q||row.name.toLocaleLowerCase().includes(filters.q.trim().toLocaleLowerCase())));
  }
  wageSummary(siteId,month,filters={}) {
    const groups=new Map();
    for(const row of this.wageRecords(siteId,month,filters)){let group=groups.get(row.occupation);if(!group){group={occupation:row.occupation,count:0,gross:0,deductions:0,net:0};groups.set(row.occupation,group);}group.count++;group.gross+=row.gross;group.deductions+=row.total;group.net+=row.net;}
    return [...groups.values()].sort((a,b)=>a.occupation.localeCompare(b.occupation,'ko'));
  }
  wageDailyRecords(siteId,month,filters={}) {
    const records=this.wageRecords(siteId,month,filters),days=new Map(this.monthlyAttendance(siteId,month).map(worker=>[worker.id,worker.units]));
    return records.map(row=>({worker_id:row.worker_id,days:days.get(row.worker_id)||[]}));
  }
  saveWageRecord(input,update=false) {
    const siteId=Number(input.siteId),workerId=Number(input.workerId),month=monthValue(input.month);
    const worker=this.db.prepare('SELECT name,company,occupation,category FROM workers WHERE id=? AND site_id=?').get(workerId,siteId);if(!worker)throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    const amount=(value)=>{if(typeof value!=='string'||!/^\d{1,9}$/.test(value))throw new Error('금액은 0 이상의 정수로 입력해 주세요.');return Number(value);},gross=amount(input.gross);
    if(!input.deductions||typeof input.deductions!=='object'||Array.isArray(input.deductions))throw new Error('공제 항목을 확인해 주세요.');
    const deductions=Object.fromEntries(['income','local','health','care','pension','employment'].map(key=>[key,amount(input.deductions[key])]));
    if(Object.values(deductions).reduce((a,b)=>a+b,0)>gross)throw new Error('공제액 합계가 노임보다 큽니다.');
    if(input.remark!==undefined&&(typeof input.remark!=='string'||input.remark.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.remark)))throw new Error('시험 비고를 확인해 주세요.');
    const remark=input.remark===undefined?null:input.remark.trim();
    if(update){
      if(!this.db.prepare('UPDATE wage_records SET gross=?,deductions=?,remark=COALESCE(?,remark) WHERE site_id=? AND worker_id=? AND month=?').run(gross,JSON.stringify(deductions),remark,siteId,workerId,month).changes)throw new Error('수정할 노임 기록을 찾을 수 없습니다.');
    }else if(!this.db.prepare('INSERT INTO wage_records(site_id,worker_id,month,gross,deductions,name_snapshot,company_snapshot,occupation_snapshot,category_snapshot,birth_date_snapshot,remark) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(worker_id,month) DO NOTHING').run(siteId,workerId,month,gross,JSON.stringify(deductions),worker.name,worker.company,worker.occupation,worker.category,this.joinAcknowledgement(siteId,workerId)?.profile?.birthDate||null,remark).changes)throw new Error('이미 등록된 노임 기록입니다. 수정을 이용해 주세요.');
  }
  mealChecks(siteId,date) {
    date=dateValue(date);
    return this.db.prepare('SELECT m.*,w.name AS worker_name FROM meal_checks m JOIN workers w ON w.id=m.worker_id WHERE m.site_id=? AND m.date=? ORDER BY w.name,m.kind,m.id').all(Number(siteId),date);
  }
  monthlyMealChecks(siteId,month) {
    month=monthValue(month);
    return this.db.prepare("SELECT w.id,w.name,COUNT(*) AS count,SUM(m.price) AS total FROM meal_checks m JOIN workers w ON w.id=m.worker_id AND w.site_id=m.site_id WHERE m.site_id=? AND m.date BETWEEN ? AND ? GROUP BY w.id,w.name ORDER BY w.name,w.id").all(Number(siteId),`${month}-01`,`${month}-31`);
  }
  mealStatement(siteId,month) {
    month=monthValue(month);siteId=Number(siteId);
    const site=this.db.prepare('SELECT id,name FROM sites WHERE id=?').get(siteId);if(!site)throw new Error('현장을 선택해 주세요.');
    const rows=this.db.prepare('SELECT m.date,m.kind,m.restaurant_name,m.price,m.tax_snapshot,w.id AS worker_id,w.name,w.company,w.category FROM meal_checks m JOIN workers w ON w.id=m.worker_id AND w.site_id=m.site_id WHERE m.site_id=? AND m.date BETWEEN ? AND ? ORDER BY w.name,w.id,m.date,m.kind').all(siteId,`${month}-01`,`${month}-31`);
    const groups=this.db.prepare('SELECT kind,restaurant_name,price,tax_snapshot,COUNT(*) AS quantity,SUM(price) AS total,CASE WHEN tax_snapshot IS NULL THEN NULL ELSE SUM(price+tax_snapshot) END AS total_with_tax FROM meal_checks WHERE site_id=? AND date BETWEEN ? AND ? GROUP BY kind,restaurant_name,price,tax_snapshot ORDER BY restaurant_name,kind,price,tax_snapshot').all(siteId,`${month}-01`,`${month}-31`);
    return {site,month,rows,groups};
  }
  workerMonthlyMealChecks(siteId,workerId,month) {
    month=monthValue(month);siteId=Number(siteId);workerId=Number(workerId);
    if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(workerId,siteId))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    return this.db.prepare('SELECT id,date,kind,restaurant_name,price,tax_snapshot FROM meal_checks WHERE site_id=? AND worker_id=? AND date BETWEEN ? AND ? ORDER BY date,kind').all(siteId,workerId,`${month}-01`,`${month}-31`);
  }
  setWorkerMonthlyMeals(input) {
    const siteId=Number(input.siteId),workerId=Number(input.workerId),month=monthValue(input.month),kind=input.kind;
    if(!['breakfast','lunch','dinner','snack'].includes(kind)||typeof input.present!=='boolean')throw new Error('식사 종류와 선택 상태를 확인해 주세요.');
    if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(workerId,siteId))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    if(input.present){
      const restaurant=this.db.prepare('SELECT * FROM restaurants WHERE id=? AND site_id=?').get(Number(input.restaurantId),siteId);
      if(!restaurant)throw new Error('선택한 현장의 식당을 확인해 주세요.');
      return this.db.prepare('INSERT OR IGNORE INTO meal_checks(site_id,worker_id,date,kind,restaurant_id,restaurant_name,price,tax_snapshot) SELECT ?,a.worker_id,a.date,?,?,?,?,? FROM attendance a WHERE a.worker_id=? AND a.present=1 AND a.date BETWEEN ? AND ?').run(siteId,kind,restaurant.id,restaurant.name,kind==='snack'?restaurant.snack_price:restaurant.meal_price,kind==='snack'?null:restaurant.tax,workerId,`${month}-01`,`${month}-31`).changes;
    }
    return this.db.prepare('DELETE FROM meal_checks WHERE site_id=? AND worker_id=? AND kind=? AND date BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM attendance a WHERE a.worker_id=meal_checks.worker_id AND a.date=meal_checks.date AND a.present=1)').run(siteId,workerId,kind,`${month}-01`,`${month}-31`).changes;
  }
  saveMealCheck(input) {
    const siteId=Number(input.siteId),workerId=Number(input.workerId),date=dateValue(input.date),kind=input.kind;
    if(!['breakfast','lunch','dinner','snack'].includes(kind))throw new Error('식사 종류를 확인해 주세요.');
    const worker=this.db.prepare('SELECT w.id FROM workers w JOIN attendance a ON a.worker_id=w.id WHERE w.id=? AND w.site_id=? AND a.date=? AND a.present=1').get(workerId,siteId,date);
    if(!worker)throw new Error('선택한 날짜의 출역자를 확인해 주세요.');
    const restaurant=this.db.prepare('SELECT * FROM restaurants WHERE id=? AND site_id=?').get(Number(input.restaurantId),siteId);
    if(!restaurant)throw new Error('선택한 현장의 식당을 확인해 주세요.');
    this.db.prepare('INSERT INTO meal_checks(site_id,worker_id,date,kind,restaurant_id,restaurant_name,price,tax_snapshot) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(worker_id,date,kind) DO UPDATE SET restaurant_id=excluded.restaurant_id,restaurant_name=excluded.restaurant_name,price=excluded.price,tax_snapshot=excluded.tax_snapshot').run(siteId,workerId,date,kind,restaurant.id,restaurant.name,kind==='snack'?restaurant.snack_price:restaurant.meal_price,kind==='snack'?null:restaurant.tax);
  }
  deleteMealCheck(siteId,id) {
    if(!this.db.prepare('DELETE FROM meal_checks WHERE site_id=? AND id=?').run(Number(siteId),Number(id)).changes)throw new Error('선택한 현장의 식대 기록을 확인해 주세요.');
  }
  saveRestaurant(input,id=null) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(id!==null&&!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND site_id=?').get(Number(id),siteId))throw new Error('선택한 현장의 식당을 확인해 주세요.');
    const name=text(input.name,'식당명'),amount=(value,label)=>{if(typeof value!=='string'||!/^\d{1,9}$/.test(value))throw new Error(label+'을 확인해 주세요.');return Number(value);};
    const meal=amount(input.mealPrice,'식비'),snack=amount(input.snackPrice,'간식비'),tax=amount(input.tax,'부가세');
    if(id===null)id=this.db.prepare('INSERT INTO restaurants(site_id,name,meal_price,snack_price,tax) VALUES(?,?,?,?,?)').run(siteId,name,meal,snack,tax).lastInsertRowid;
    else this.db.prepare('UPDATE restaurants SET name=?,meal_price=?,snack_price=?,tax=? WHERE id=? AND site_id=?').run(name,meal,snack,tax,Number(id),siteId);
    return this.db.prepare('SELECT * FROM restaurants WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  safetyCosts(siteId,month){
    if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('조회 월을 확인해 주세요.');
    const rows=this.db.prepare('SELECT * FROM safety_costs WHERE site_id=? AND date>=? AND date<? ORDER BY date,id').all(Number(siteId),`${month}-01`,`${month}-32`);
    return {rows,total:rows.reduce((sum,row)=>sum+BigInt(row.amount),0n).toString()};
  }
  safetyCostPhotos(siteId,costId){if(!this.db.prepare('SELECT 1 FROM safety_costs WHERE id=? AND site_id=?').get(Number(costId),Number(siteId)))throw new Error('선택한 현장의 사용내역을 확인해 주세요.');return this.db.prepare('SELECT id,name,length(data) AS size FROM safety_cost_photos WHERE cost_id=? ORDER BY id').all(Number(costId));}
  addSafetyCostPhoto(siteId,costId,name,data){
    const existing=this.safetyCostPhotos(siteId,costId);
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const bytes=Buffer.from(data);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
    if(existing.length>=20)throw new Error('사용내역당 사진은 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO safety_cost_photos(cost_id,name,data) VALUES(?,?,?)').run(Number(costId),name,bytes).lastInsertRowid;
  }
  safetyCostPhoto(siteId,costId,id){return this.db.prepare('SELECT p.* FROM safety_cost_photos p JOIN safety_costs c ON c.id=p.cost_id WHERE c.site_id=? AND c.id=? AND p.id=?').get(Number(siteId),Number(costId),Number(id))||null;}
  deleteSafetyCostPhoto(siteId,costId,id){if(!this.safetyCostPhoto(siteId,costId,id))throw new Error('사진을 찾을 수 없습니다.');this.db.prepare('DELETE FROM safety_cost_photos WHERE cost_id=? AND id=?').run(Number(costId),Number(id));}
  safetyCostReportPhotos(id){const doc=this.document(id);if(!doc||doc.type!=='cost'||!Array.isArray(JSON.parse(doc.details).rows))throw new Error('월간 사용내역서를 확인해 주세요.');return this.db.prepare('SELECT id,cost_id,name,length(data) AS size FROM safety_cost_report_photos WHERE document_id=? ORDER BY id').all(Number(id));}
  safetyCostReportPhoto(id,photoId){return this.db.prepare('SELECT * FROM safety_cost_report_photos WHERE document_id=? AND id=?').get(Number(id),Number(photoId))||null;}
  createSafetyCost(input){
    const siteId=Number(input.siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const category=Number(input.category);if(!Number.isInteger(category)||category<1||category>9)throw new Error('사용 항목을 확인해 주세요.');
    const date=dateValue(input.date),description=text(input.description,'사용내역'),unit=text(input.unit,'단위');
    if(typeof input.note!=='string'||input.note.length>2000)throw new Error('비고를 확인해 주세요.');
    const price=input.unitPrice,quantity=input.quantity;
    if(typeof price!=='string'||!/^\d{1,12}$/.test(price)||typeof quantity!=='string'||!/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity))throw new Error('단가와 수량을 확인해 주세요.');
    const [whole,fraction='']=quantity.split('.'),scale=10n**BigInt(fraction.length),numerator=BigInt(price)*(BigInt(whole)*scale+BigInt(fraction||'0'));
    if(numerator%scale!==0n)throw new Error('금액은 원 단위로 계산되어야 합니다.');
    const amount=(numerator/scale).toString();
    const id=this.db.prepare('INSERT INTO safety_costs(site_id,category,date,description,note,unit_price,quantity,unit,amount) VALUES(?,?,?,?,?,?,?,?,?)').run(siteId,category,date,description,input.note.trim(),price,quantity,unit,amount).lastInsertRowid;
    return this.db.prepare('SELECT * FROM safety_costs WHERE id=?').get(id);
  }
  createSafetyCostReport(input){
    const siteId=Number(input.siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const month=input.month,report=this.safetyCosts(siteId,month);if(!report.rows.length)throw new Error('해당 월의 사용내역을 먼저 등록해 주세요.');
    const periodFrom=dateValue(input.periodFrom),periodTo=dateValue(input.periodTo);if(periodFrom>periodTo)throw new Error('공사기간을 확인해 주세요.');
    const amounts={};for(const key of ['contractAmount','budget','progressAmount']){const value=input[key];if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error('금액을 확인해 주세요.');amounts[key]=value;}
    const progress=input.progress;if(typeof progress!=='string'||!/^\d{1,3}(?:\.\d{1,2})?$/.test(progress)||Number(progress)>100)throw new Error('공정률을 확인해 주세요.');
    const categoryTotals=Array.from({length:9},(_,index)=>report.rows.filter(row=>row.category===index+1).reduce((sum,row)=>sum+BigInt(row.amount),0n).toString());
    const details={month,periodFrom,periodTo,...amounts,progress,categoryTotals,total:report.total,rows:report.rows};
    const date=dateValue(input.date);this.db.exec('BEGIN IMMEDIATE');
    try{const id=this.db.prepare('INSERT INTO documents(site_id,type,title,date,body,details) VALUES(?,?,?,?,?,?)').run(siteId,'cost',`${month} 가상 월간 사용내역서`,date,'시험용 문서입니다.',JSON.stringify(details)).lastInsertRowid;
      const copy=this.db.prepare('INSERT INTO safety_cost_report_photos(document_id,cost_id,name,data) SELECT ?,cost_id,name,data FROM safety_cost_photos WHERE cost_id=?');for(const row of report.rows)copy.run(id,row.id);
      this.db.exec('COMMIT');return this.document(id);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  equipment(siteId) {return this.db.prepare('SELECT * FROM equipment WHERE site_id=? ORDER BY kind,model,id').all(Number(siteId));}
  workPlaces(siteId){return this.db.prepare('SELECT * FROM work_places WHERE site_id=? ORDER BY name,id').all(Number(siteId));}
  rigging(siteId){return this.db.prepare('SELECT * FROM rigging WHERE site_id=? ORDER BY name,id').all(Number(siteId));}
  riggingPhotos(siteId,id){if(!this.db.prepare('SELECT 1 FROM rigging WHERE id=? AND site_id=?').get(Number(id),Number(siteId)))throw new Error('선택한 현장의 장구를 확인해 주세요.');return this.db.prepare('SELECT id,name,length(data) AS size FROM rigging_photos WHERE rigging_id=? ORDER BY id').all(Number(id));}
  addRiggingPhoto(siteId,id,name,data){
    const existing=this.riggingPhotos(siteId,id);
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const bytes=Buffer.from(data);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
    if(existing.length>=20)throw new Error('사진은 장구당 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO rigging_photos(rigging_id,name,data) VALUES(?,?,?)').run(Number(id),name,bytes).lastInsertRowid;
  }
  riggingPhoto(siteId,id,photoId){return this.db.prepare('SELECT p.* FROM rigging_photos p JOIN rigging r ON r.id=p.rigging_id WHERE r.site_id=? AND r.id=? AND p.id=?').get(Number(siteId),Number(id),Number(photoId))||null;}
  deleteRiggingPhoto(siteId,id,photoId){if(!this.riggingPhoto(siteId,id,photoId))throw new Error('사진을 찾을 수 없습니다.');this.db.prepare('DELETE FROM rigging_photos WHERE id=?').run(Number(photoId));}
  createRigging(input,id=null){
    const siteId=Number(input.siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    if(id!==null){
      if(!this.db.prepare('SELECT 1 FROM rigging WHERE id=? AND site_id=?').get(Number(id),siteId))throw new Error('선택한 현장의 장구를 확인해 주세요.');
      const plans=this.db.prepare("SELECT details FROM documents WHERE site_id=? AND type='work_plan'").all(siteId);
      if(plans.some(plan=>(JSON.parse(plan.details).riggingIds||[]).includes(Number(id))))throw new Error('계획서에 연결된 장구는 수정할 수 없습니다.');
    }
    if(!['줄걸이','체결장구'].includes(input.category))throw new Error('장구 구분을 확인해 주세요.');
    const standards=input.standards??[],additional=input.additional??[];
    if(!Array.isArray(standards)||standards.length>20||standards.some(value=>typeof value!=='string'||!value.trim()||value.length>200))throw new Error('규격을 확인해 주세요.');
    if(!Array.isArray(additional)||additional.length>20||additional.some(row=>!row||typeof row!=='object'||Array.isArray(row)||typeof row.label!=='string'||typeof row.value!=='string'||!row.label.trim()||!row.value.trim()||row.label.length>200||row.value.length>2000))throw new Error('추가정보를 확인해 주세요.');
    const spec=input.spec??'';if(typeof spec!=='string'||spec.length>5000)throw new Error('제원을 확인해 주세요.');
    const details={standards:standards.map(value=>value.trim()),additional:additional.map(row=>({label:row.label.trim(),value:row.value.trim()})),spec:spec.trim()};
    const kind=text(input.kind,'종류'),name=text(input.name,'별칭');
    if(id===null)id=this.db.prepare('INSERT INTO rigging(site_id,category,kind,name,details) VALUES(?,?,?,?,?)').run(siteId,input.category,kind,name,JSON.stringify(details)).lastInsertRowid;
    else this.db.prepare('UPDATE rigging SET category=?,kind=?,name=?,details=? WHERE id=? AND site_id=?').run(input.category,kind,name,JSON.stringify(details),Number(id),siteId);
    return this.db.prepare('SELECT * FROM rigging WHERE id=?').get(id);
  }
  createWorkPlace(input){
    const siteId=Number(input.siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const details={};for(const area of ['work','route']){
      const source=input[area];if(!source || typeof source!=='object' || Array.isArray(source))throw new Error('작업장과 운행경로 정보를 확인해 주세요.');
      if(!['평지','경사지'].includes(source.terrain) || !['견고','보통','연약'].includes(source.ground) || !['해당없음','양호','불량'].includes(source.drainage))throw new Error('지형과 상태를 확인해 주세요.');
      const result={terrain:source.terrain,ground:source.ground,drainage:source.drainage};
      for(const key of ['reinforcement','obstacles','protection']){if(typeof source[key]!=='string' || source[key].length>2000)throw new Error('작업장 정보를 확인해 주세요.');result[key]=source[key].trim();}
      const allowed={reinforcementChoices:['철판설치','지반개량','양질토사 성토','콘크리트 포장'],obstacleChoices:['도시가스','통신선','전기','상하수도'],equipmentProtection:['신호수 배치','유도자 배치','안전 표지판','접근방지 로프','안전 펜스','라바콘'],obstacleProtection:['신호수 배치','유도자 배치','안전 표지판','접근방지 로프','안전 펜스','라바콘'],workerProtection:['신호수 배치','유도자 배치','안전 표지판','접근방지 로프','안전 펜스','라바콘']};
      for(const [key,options] of Object.entries(allowed)){const values=source[key]??[];if(!Array.isArray(values)||values.length>options.length||new Set(values).size!==values.length||values.some(value=>!options.includes(value))||(area==='route'&&key.endsWith('Protection')&&values.includes('신호수 배치')))throw new Error('작업장 선택 항목을 확인해 주세요.');result[key]=values;}
      for(const key of ['groundExtra','equipmentProtectionExtra','obstacleProtectionExtra','workerProtectionExtra']){const value=source[key]??'';if(typeof value!=='string'||value.length>2000)throw new Error('작업장 정보를 확인해 주세요.');result[key]=value.trim();}
      details[area]=result;
    }
    const additional=input.additional??[];
    if(!Array.isArray(additional)||additional.length>20||additional.some(row=>!row||typeof row!=='object'||Array.isArray(row)||typeof row.label!=='string'||typeof row.value!=='string'||row.label.length>200||row.value.length>2000||!row.label.trim()||!row.value.trim()))throw new Error('추가정보의 항목과 내용을 확인해 주세요.');
    details.additional=additional.map(row=>({label:row.label.trim(),value:row.value.trim()}));
    const id=this.db.prepare('INSERT INTO work_places(site_id,name,details) VALUES(?,?,?)').run(siteId,text(input.name,'장소 별칭'),JSON.stringify(details)).lastInsertRowid;
    return this.db.prepare('SELECT * FROM work_places WHERE id=?').get(id);
  }
  workPlacePhotos(siteId,placeId){
    if(!this.db.prepare('SELECT 1 FROM work_places WHERE id=? AND site_id=?').get(Number(placeId),Number(siteId)))throw new Error('선택한 현장의 작업장소를 확인해 주세요.');
    return this.db.prepare('SELECT id,name,length(data) AS size FROM work_place_photos WHERE place_id=? ORDER BY id').all(Number(placeId));
  }
  addWorkPlacePhoto(siteId,placeId,name,data){
    const existing=this.workPlacePhotos(siteId,placeId);
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const bytes=Buffer.from(data),png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),jpeg=bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
    if(!png&&!jpeg)throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
    if(existing.length>=20)throw new Error('사진은 장소당 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO work_place_photos(place_id,name,data) VALUES(?,?,?)').run(Number(placeId),name,bytes).lastInsertRowid;
  }
  workPlacePhoto(siteId,placeId,id){return this.db.prepare('SELECT p.* FROM work_place_photos p JOIN work_places w ON w.id=p.place_id WHERE w.site_id=? AND w.id=? AND p.id=?').get(Number(siteId),Number(placeId),Number(id))||null;}
  deleteWorkPlacePhoto(siteId,placeId,id){if(!this.workPlacePhoto(siteId,placeId,id))throw new Error('사진을 찾을 수 없습니다.');this.db.prepare('DELETE FROM work_place_photos WHERE id=?').run(Number(id));}
  equipmentAttachments(siteId,id){
    if(!this.db.prepare('SELECT 1 FROM equipment WHERE id=? AND site_id=?').get(Number(id),Number(siteId)))throw new Error('선택한 현장의 장비를 확인해 주세요.');
    return this.db.prepare("SELECT id,category,name,length(data) AS size,CASE WHEN substr(data,1,8)=X'89504E470D0A1A0A' THEN 'image/png' WHEN substr(data,1,3)=X'FFD8FF' THEN 'image/jpeg' ELSE NULL END AS image_type FROM equipment_attachments WHERE equipment_id=? ORDER BY id").all(Number(id));
  }
  addEquipmentAttachment(siteId,id,category,name,data){
    const existing=this.equipmentAttachments(siteId,id);
    if(!['lease','business','registration','inspection','insurance','specification','safety','stability','other'].includes(category))throw new Error('첨부 종류를 확인해 주세요.');
    if(typeof name!=='string' || !name.trim() || name.length>200 || /[\\/\x00-\x1f\x7f]/.test(name))throw new Error('파일 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array) || !data.length || data.length>2*1024*1024)throw new Error('파일은 1바이트 이상 2MB 이하여야 합니다.');
    if(existing.length>=20)throw new Error('첨부파일은 장비당 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO equipment_attachments(equipment_id,category,name,data) VALUES(?,?,?,?)').run(Number(id),category,name,data).lastInsertRowid;
  }
  equipmentAttachment(siteId,equipmentId,id){return this.db.prepare('SELECT a.* FROM equipment_attachments a JOIN equipment e ON e.id=a.equipment_id WHERE e.site_id=? AND e.id=? AND a.id=?').get(Number(siteId),Number(equipmentId),Number(id)) || null;}
  equipmentChecks(documentId){
    const doc=this.document(documentId);if(!doc || doc.type!=='work_plan')throw new Error('작업계획서를 확인해 주세요.');
    return this.db.prepare('SELECT id,equipment_id,date,items,created_at,equipment_snapshot,inspector,signature IS NOT NULL AS has_signature FROM equipment_checks WHERE document_id=? ORDER BY date DESC,id DESC').all(Number(documentId));
  }
  equipmentCheckSignature(documentId,checkId){return this.db.prepare('SELECT signature FROM equipment_checks WHERE document_id=? AND id=? AND signature IS NOT NULL').get(Number(documentId),Number(checkId))?.signature||null;}
  deleteEquipmentCheck(documentId,checkId){this.equipmentChecks(documentId);if(!this.db.prepare('DELETE FROM equipment_checks WHERE document_id=? AND id=?').run(Number(documentId),Number(checkId)).changes)throw new Error('시험 점검을 찾을 수 없습니다.');}
  addEquipmentCheck(documentId,input){
    const doc=this.document(documentId);if(!doc || doc.type!=='work_plan')throw new Error('작업계획서를 확인해 주세요.');
    const details=JSON.parse(doc.details),equipmentId=Number(input.equipmentId),date=dateValue(input.date);
    const equipment=this.db.prepare('SELECT id,kind,model,registration FROM equipment WHERE id=? AND site_id=?').get(equipmentId,doc.site_id);
    if(!Number.isSafeInteger(equipmentId) || !(details.equipmentIds||[]).includes(equipmentId) || !equipment)throw new Error('계획서에 연결된 현장 장비를 확인해 주세요.');
    if((details.periodFrom && date<details.periodFrom) || (details.periodTo && date>details.periodTo))throw new Error('점검일이 작업기간을 벗어났습니다.');
    if(!Array.isArray(input.items) || !input.items.length || input.items.length>100)throw new Error('점검 항목을 확인해 주세요.');
    const items=input.items.map(item=>{if(!item || typeof item!=='object' || Array.isArray(item) || !['적정','부적정','해당없음'].includes(item.result))throw new Error('점검 판정을 확인해 주세요.');const result={name:text(item.name,'점검 항목',500),result:item.result};for(const [key,label,max] of [['section','점검 구분',200],['action','조치 내용',2000]])if(item[key]!==undefined){if(typeof item[key]!=='string'||item[key].length>max)throw new Error(`${label}을 확인해 주세요.`);if(item[key].trim())result[key]=item[key].trim();}return result;});
    const inspector=input.inspector===undefined?null:text(input.inspector,'점검자',200),signature=input.signature===undefined?null:signatureBytes(input.signature);if((inspector===null)!==(signature===null))throw new Error('점검자와 시험 서명을 함께 입력해 주세요.');
    if(this.db.prepare('SELECT 1 FROM equipment_checks WHERE document_id=? AND equipment_id=? AND date=?').get(Number(documentId),equipmentId,date))throw new Error('해당 날짜의 시험 점검이 이미 있습니다.');
    return this.db.prepare('INSERT INTO equipment_checks(document_id,equipment_id,date,items,equipment_snapshot,inspector,signature) VALUES(?,?,?,?,?,?,?)').run(Number(documentId),equipmentId,date,JSON.stringify(items),JSON.stringify(equipment),inspector,signature).lastInsertRowid;
  }
  deleteEquipmentAttachment(siteId,equipmentId,id){
    if(!this.equipmentAttachment(siteId,equipmentId,id))throw new Error('첨부파일을 찾을 수 없습니다.');
    this.db.prepare('DELETE FROM equipment_attachments WHERE equipment_id=? AND id=?').run(Number(equipmentId),Number(id));
  }
  createEquipment(input) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const kind=text(input.kind,'장비 종류'),model=text(input.model,'형식');
    for(const key of ['capacity','manufacturer','registration'])if(typeof input[key]!=='string' || input[key].length>200)throw new Error('장비 항목을 확인해 주세요.');
    const id=this.db.prepare('INSERT INTO equipment(site_id,kind,model,capacity,manufacturer,registration,details) VALUES(?,?,?,?,?,?,?)').run(siteId,kind,model,input.capacity.trim(),input.manufacturer.trim(),input.registration.trim(),JSON.stringify(equipmentDetails(input))).lastInsertRowid;
    return this.db.prepare('SELECT * FROM equipment WHERE id=?').get(id);
  }
  updateEquipment(id,input) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT 1 FROM equipment WHERE id=? AND site_id=?').get(Number(id),siteId))throw new Error('선택한 현장의 장비를 확인해 주세요.');
    const kind=text(input.kind,'장비 종류'),model=text(input.model,'형식');
    for(const key of ['capacity','manufacturer','registration'])if(typeof input[key]!=='string' || input[key].length>200)throw new Error('장비 항목을 확인해 주세요.');
    this.db.prepare('UPDATE equipment SET kind=?,model=?,capacity=?,manufacturer=?,registration=?,details=? WHERE id=? AND site_id=?').run(kind,model,input.capacity.trim(),input.manufacturer.trim(),input.registration.trim(),JSON.stringify(equipmentDetails(input)),Number(id),siteId);
    return this.db.prepare('SELECT * FROM equipment WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  createCompany(input) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT id FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const id=this.db.prepare('INSERT INTO companies(site_id,name,trade) VALUES(?,?,?)').run(siteId,text(input.name,'회사명'),text(input.trade,'공종')).lastInsertRowid;
    return this.db.prepare('SELECT * FROM companies WHERE id=?').get(id);
  }
  updateCompany(id,input) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT id FROM companies WHERE id=? AND site_id=?').get(Number(id),siteId))throw new Error('선택한 현장의 협력사를 확인해 주세요.');
    this.db.prepare('UPDATE companies SET name=?,trade=? WHERE id=? AND site_id=?').run(text(input.name,'회사명'),text(input.trade,'공종'),Number(id),siteId);
    return this.db.prepare('SELECT * FROM companies WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  createWorker(input) {
    const siteId = Number(input.siteId);
    if (!this.db.prepare('SELECT id FROM sites WHERE id=?').get(siteId)) throw new Error('현장을 선택해 주세요.');
    const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const fields=workerFields(input),id = this.db.prepare('INSERT INTO workers(site_id,name,category,company,occupation,created_date) VALUES(?,?,?,?,?,?)').run(siteId,fields.name,fields.category,fields.company,fields.occupation,date).lastInsertRowid;
    return this.db.prepare('SELECT * FROM workers WHERE id=?').get(id);
  }
  updateWorker(id,input) {
    const siteId=Number(input.siteId);
    if(!this.db.prepare('SELECT id FROM workers WHERE id=? AND site_id=?').get(Number(id),siteId))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    const fields=workerFields(input);this.db.prepare('UPDATE workers SET name=?,category=?,company=?,occupation=? WHERE id=? AND site_id=?').run(fields.name,fields.category,fields.company,fields.occupation,Number(id),siteId);
    return this.db.prepare('SELECT * FROM workers WHERE id=? AND site_id=?').get(Number(id),siteId);
  }
  workers(siteId, query = '', filters = {}) {
    const category=filters.category || '',company=filters.company || '',occupation=filters.occupation || '';
    const from=filters.from?dateValue(filters.from):'',to=filters.to?dateValue(filters.to):'';
    if(from && to && from>to)throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    return this.db.prepare("SELECT workers.*,EXISTS(SELECT 1 FROM worker_accounts a WHERE a.worker_id=workers.id AND a.site_id=workers.site_id) AS has_account FROM workers WHERE site_id=? AND (name LIKE ? OR company LIKE ? OR occupation LIKE ?) AND (?='' OR category=?) AND (?='' OR company=?) AND (?='' OR occupation=?) AND (?='' OR created_date>=?) AND (?='' OR created_date<=?) ORDER BY id DESC").all(Number(siteId),...Array(3).fill(`%${query}%`),category,category,company,company,occupation,occupation,from,from,to,to);
  }
  attendance(siteId, date) {
    date = dateValue(date);
    return this.db.prepare('SELECT workers.id,workers.name,workers.category,workers.company,workers.occupation,COALESCE(attendance.present,0) AS present,attendance.source,attendance.units_hundredths,attendance.daily_rate,attendance.salary_kind,attendance.salary_amount FROM workers LEFT JOIN attendance ON attendance.worker_id=workers.id AND attendance.date=? WHERE workers.site_id=? ORDER BY workers.name,workers.id').all(date,Number(siteId));
  }
  monthlyAttendance(siteId,month) {
    month=monthValue(month);
    const workers=this.db.prepare('SELECT id,name,company,occupation FROM workers WHERE site_id=? ORDER BY name,id').all(Number(siteId));
    const records=this.db.prepare('SELECT attendance.worker_id,attendance.date,attendance.units_hundredths,attendance.daily_rate,attendance.salary_kind,attendance.salary_amount,attendance.category_snapshot,attendance.company_snapshot,attendance.occupation_snapshot FROM attendance JOIN workers ON workers.id=attendance.worker_id WHERE workers.site_id=? AND attendance.present=1 AND attendance.date BETWEEN ? AND ? ORDER BY attendance.date').all(Number(siteId),`${month}-01`,`${month}-31`);
    const units=new Map(workers.map(w=>[w.id,[]]));
    for(const record of records)units.get(record.worker_id).push({date:record.date,units_hundredths:record.units_hundredths,daily_rate:record.daily_rate,salary_kind:record.salary_kind,salary_amount:record.salary_amount,estimated_pay:record.salary_kind!==null||record.daily_rate===null||record.units_hundredths===null?null:Math.floor((record.daily_rate*record.units_hundredths+50)/100),category:record.category_snapshot,company:record.company_snapshot,occupation:record.occupation_snapshot});
    return workers.map(w=>({...w,days:units.get(w.id).map(record=>record.date),units:units.get(w.id)}));
  }
  workerAttendance(workerId,month) {
    month=monthValue(month);
    return this.db.prepare('SELECT date FROM attendance WHERE worker_id=? AND present=1 AND date BETWEEN ? AND ? ORDER BY date').all(Number(workerId),`${month}-01`,`${month}-31`).map(row=>row.date);
  }
  workerAttendanceUnits(workerId,month){month=monthValue(month);return this.db.prepare('SELECT date,units_hundredths FROM attendance WHERE worker_id=? AND present=1 AND date BETWEEN ? AND ? ORDER BY date').all(Number(workerId),`${month}-01`,`${month}-31`);}
  workerNotices(workerId,date) {
    date=dateValue(date);
    return this.db.prepare("SELECT d.id,d.title,d.body,d.date,r.read_at FROM workers w JOIN documents d ON d.site_id=w.site_id LEFT JOIN worker_notice_reads r ON r.document_id=d.id AND r.worker_id=w.id WHERE w.id=? AND d.type='notice' AND d.status='approved' AND d.date=? ORDER BY d.id DESC").all(Number(workerId),date).map(notice=>({...notice,files:this.attachments(notice.id).map(({id,name,size})=>({id,name,size}))}));
  }
  workerNoticeFile(workerId,documentId,fileId,date){
    date=dateValue(date);
    return this.db.prepare("SELECT a.name,a.data FROM workers w JOIN documents d ON d.site_id=w.site_id JOIN attachments a ON a.document_id=d.id WHERE w.id=? AND d.id=? AND a.id=? AND d.type='notice' AND d.status='approved' AND d.date=?").get(Number(workerId),Number(documentId),Number(fileId),date)||null;
  }
  workerMeetings(workerId){
    const rows=this.db.prepare("SELECT d.id,d.type,d.title,d.date,d.body,d.details,c.created_at FROM workers w JOIN documents d ON d.site_id=w.site_id LEFT JOIN worker_meeting_checks c ON c.document_id=d.id AND c.worker_id=w.id WHERE w.id=? AND d.type IN ('work_council','safety_meeting') AND d.status='approved' ORDER BY d.date DESC,d.id DESC").all(Number(workerId));
    return rows.map(row=>{const details=JSON.parse(row.details);return {...row,details:{kind:details.kind||'',place:details.place||'',timeFrom:details.timeFrom||'',timeTo:details.timeTo||'',host:details.host||'',decisions:details.decisions||'',discussion:details.discussion||'',remarks:details.remarks||''},selected:(details.workerSnapshot||[]).some(person=>person.id===Number(workerId))};}).filter(row=>row.selected).map(({selected,...row})=>({...row,files:this.attachments(row.id).map(({id,name,size})=>({id,name,size}))}));
  }
  workerMeetingAttachment(workerId,documentId,fileId){if(!this.workerMeetings(workerId).some(row=>row.id===Number(documentId)))return null;const file=this.attachment(fileId);return file?.document_id===Number(documentId)?file:null;}
  confirmWorkerMeeting(workerId,documentId,signature){
    if(!Number.isSafeInteger(documentId)||!this.workerMeetings(workerId).some(row=>row.id===documentId))throw new Error('지정된 승인 회의를 확인해 주세요.');
    const bytes=signatureBytes(signature);this.db.prepare('INSERT OR IGNORE INTO worker_meeting_checks(document_id,worker_id,signature) VALUES(?,?,?)').run(documentId,Number(workerId),bytes);
  }
  meetingChecks(documentId){
    const doc=this.document(documentId);if(!doc||!['work_council','safety_meeting'].includes(doc.type))throw new Error('회의 문서를 확인해 주세요.');
    return this.db.prepare('SELECT worker_id,created_at FROM worker_meeting_checks WHERE document_id=? ORDER BY worker_id').all(doc.id);
  }
  meetingWorkerSignature(documentId,workerId){
    const doc=this.document(documentId);if(!doc||!['work_council','safety_meeting'].includes(doc.type))return null;
    return this.db.prepare('SELECT signature FROM worker_meeting_checks WHERE document_id=? AND worker_id=?').get(doc.id,Number(workerId))?.signature||null;
  }
  workerTraining(workerId,date) {
    date=dateValue(date);
    return this.db.prepare("SELECT d.id,d.type,d.title,d.body,d.details,c.created_at,c.signature IS NOT NULL AS has_signature FROM workers w JOIN documents d ON d.site_id=w.site_id LEFT JOIN worker_training_checks c ON c.worker_id=w.id AND c.document_id=d.id WHERE w.id=? AND d.type IN ('tbm','education') AND d.status='approved' AND d.date=? AND (NOT EXISTS (SELECT 1 FROM training_target_config t WHERE t.document_id=d.id) OR EXISTS (SELECT 1 FROM training_targets t WHERE t.document_id=d.id AND t.worker_id=w.id)) ORDER BY d.id DESC").all(Number(workerId),date).map(row=>{const details=JSON.parse(row.details);return {...row,details:{kind:details.kind||'',otherTitle:details.otherTitle||'',instructor:details.instructor||'',weather:details.weather||'',work:details.work||'',hazards:details.hazards||''},files:this.attachments(row.id).map(({id,name,size})=>({id,name,size}))};});
  }
  workerTrainingAttachment(workerId,documentId,fileId,date){if(!this.workerTraining(workerId,date).some(row=>row.id===Number(documentId)))return null;const file=this.attachment(fileId);return file?.document_id===Number(documentId)?file:null;}
  dailyTraining(workerId,date) {
    return this.db.prepare('SELECT kind,created_at,signature IS NOT NULL AS has_signature FROM worker_daily_training WHERE worker_id=? AND date=? ORDER BY kind').all(Number(workerId),dateValue(date));
  }
  confirmDailyTraining(workerId,date,kinds,rightsConfirmed,signature) {
    date=dateValue(date);
    if(rightsConfirmed!==true)throw new Error('권리와 의무를 확인해 주세요.');
    if(!Array.isArray(kinds) || !kinds.length || kinds.length>3 || new Set(kinds).size!==kinds.length || kinds.some(k=>!['tbm','education','meeting'].includes(k)))throw new Error('교육 종류를 선택해 주세요.');
    if(!this.db.prepare('SELECT 1 FROM workers WHERE id=?').get(Number(workerId)))throw new Error('근로자를 확인해 주세요.');
    const bytes=signature===undefined ? null : signatureBytes(signature);
    this.db.exec('BEGIN IMMEDIATE');
    try{const insert=this.db.prepare('INSERT OR IGNORE INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)');for(const kind of kinds)insert.run(Number(workerId),date,kind,bytes);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.dailyTraining(workerId,date);
  }
  dailyTrainingSignature(siteId,workerId,date,kind){
    if(!['tbm','education','meeting'].includes(kind))throw new Error('교육 종류를 확인해 주세요.');
    return this.db.prepare('SELECT c.signature FROM worker_daily_training c JOIN workers w ON w.id=c.worker_id WHERE w.site_id=? AND w.id=? AND c.date=? AND c.kind=? AND c.signature IS NOT NULL').get(Number(siteId),Number(workerId),dateValue(date),kind)?.signature || null;
  }
  documentTrainingSignature(documentId,workerId){
    return this.db.prepare("SELECT c.signature FROM documents d JOIN workers w ON w.site_id=d.site_id JOIN worker_daily_training c ON c.worker_id=w.id AND c.date=d.date AND c.kind=d.type WHERE d.id=? AND w.id=? AND d.type IN ('tbm','education') AND c.signature IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM training_target_config t WHERE t.document_id=d.id) OR EXISTS (SELECT 1 FROM training_targets t WHERE t.document_id=d.id AND t.worker_id=w.id))").get(Number(documentId),Number(workerId))?.signature||null;
  }
  confirmWorkerTraining(workerId,documentId,date,rightsConfirmed,signature) {
    date=dateValue(date);
    const doc=this.db.prepare("SELECT d.id FROM workers w JOIN documents d ON d.site_id=w.site_id WHERE w.id=? AND d.id=? AND d.type IN ('tbm','education') AND d.status='approved' AND d.date=? AND (NOT EXISTS (SELECT 1 FROM training_target_config t WHERE t.document_id=d.id) OR EXISTS (SELECT 1 FROM training_targets t WHERE t.document_id=d.id AND t.worker_id=w.id))").get(Number(workerId),Number(documentId),date);
    if(!doc)throw new Error('오늘 참여할 교육 문서를 확인해 주세요.');
    if(rightsConfirmed!==true)throw new Error('권리와 의무를 확인해 주세요.');
    const bytes=signature===undefined?null:signatureBytes(signature);
    this.db.prepare("INSERT INTO worker_training_checks(worker_id,document_id,rights_ack,signature) VALUES(?,?,'demo-v1',?) ON CONFLICT(worker_id,document_id) DO UPDATE SET rights_ack=CASE WHEN excluded.signature IS NOT NULL THEN COALESCE(worker_training_checks.rights_ack,excluded.rights_ack) ELSE worker_training_checks.rights_ack END,signature=COALESCE(worker_training_checks.signature,excluded.signature)").run(Number(workerId),doc.id,bytes);
  }
  confirmWorkerNotice(workerId,documentId,signature,date) {
    date=dateValue(date);
    const doc=this.db.prepare("SELECT d.id FROM workers w JOIN documents d ON d.site_id=w.site_id WHERE w.id=? AND d.id=? AND d.type='notice' AND d.status='approved' AND d.date=?").get(Number(workerId),Number(documentId),date);
    if(!doc)throw new Error('확인할 공지를 찾을 수 없습니다.');
    const bytes=signatureBytes(signature);
    this.db.prepare('INSERT OR IGNORE INTO worker_notice_reads(worker_id,document_id,signature) VALUES(?,?,?)').run(Number(workerId),doc.id,bytes);
  }
  noticeReads(documentId) {
    const doc=this.document(documentId);
    if(!doc || doc.type!=='notice')throw new Error('유해·위험 공지를 확인해 주세요.');
    return this.db.prepare('SELECT w.id,w.name,w.company,a.occupation_snapshot AS attendance_occupation,r.read_at,r.signature IS NOT NULL AS has_signature FROM worker_notice_reads r JOIN workers w ON w.id=r.worker_id LEFT JOIN attendance a ON a.worker_id=w.id AND a.date=? AND a.present=1 WHERE r.document_id=? AND w.site_id=? ORDER BY r.read_at,w.id').all(doc.date,Number(documentId),doc.site_id);
  }
  noticeSignature(documentId,workerId) {
    return this.db.prepare("SELECT r.signature FROM worker_notice_reads r JOIN documents d ON d.id=r.document_id JOIN workers w ON w.id=r.worker_id AND w.site_id=d.site_id WHERE d.id=? AND d.type='notice' AND w.id=? AND r.signature IS NOT NULL").get(Number(documentId),Number(workerId))?.signature || null;
  }
  trainingChecks(documentId) {
    const doc=this.document(documentId);
    if(!doc || !['tbm','education'].includes(doc.type))throw new Error('교육 문서를 확인해 주세요.');
    return this.db.prepare('SELECT w.id,w.name,w.company,c.created_at,c.rights_ack,c.signature IS NOT NULL AS has_signature FROM worker_training_checks c JOIN workers w ON w.id=c.worker_id WHERE c.document_id=? AND w.site_id=? ORDER BY c.created_at,w.id').all(Number(documentId),doc.site_id);
  }
  trainingCheckSignature(documentId,workerId){return this.db.prepare("SELECT c.signature FROM worker_training_checks c JOIN documents d ON d.id=c.document_id JOIN workers w ON w.id=c.worker_id AND w.site_id=d.site_id WHERE d.id=? AND d.type IN ('tbm','education') AND w.id=? AND c.signature IS NOT NULL").get(Number(documentId),Number(workerId))?.signature||null;}
  workerActivities(siteId,workerId,kinds=[],offset=0){
    siteId=Number(siteId);workerId=Number(workerId);
    if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(workerId,siteId))throw new Error('같은 현장의 출입자를 확인해 주세요.');
    const valid=['tbm','education','notice','checklist','hazard','risk','work_plan','instruction'];
    if(!Array.isArray(kinds)||kinds.some(kind=>!valid.includes(kind))||new Set(kinds).size!==kinds.length||!Number.isSafeInteger(offset)||offset<0)throw new Error('활동 검색 조건을 확인해 주세요.');
    if(!kinds.length)kinds=valid;
    const query=`WITH ctx AS (SELECT ? AS site,? AS worker), activity AS (
      SELECT d.type AS kind,d.date,d.title,'문서별 시험 참가 확인' AS detail,d.id AS document_id FROM worker_training_checks c JOIN documents d ON d.id=c.document_id WHERE c.worker_id=(SELECT worker FROM ctx) AND d.site_id=(SELECT site FROM ctx) AND d.type IN ('tbm','education') AND d.status='approved'
      UNION ALL SELECT c.kind,c.date,'당일 종류별 확인','시험 확인 (문서별 확인과 별도)',NULL FROM worker_daily_training c WHERE c.worker_id=(SELECT worker FROM ctx) AND c.kind IN ('tbm','education')
      UNION ALL SELECT 'notice',d.date,d.title,'시험 공지 확인',d.id FROM worker_notice_reads c JOIN documents d ON d.id=c.document_id WHERE c.worker_id=(SELECT worker FROM ctx) AND d.site_id=(SELECT site FROM ctx) AND d.type='notice' AND d.status='approved'
      UNION ALL SELECT 'checklist',c.date,'자가점검','시험 자가점검',NULL FROM worker_self_checks c WHERE c.worker_id=(SELECT worker FROM ctx)
      UNION ALL SELECT 'hazard',date(h.created_at,'localtime'),h.title,'시험 신고',NULL FROM hazard_reports h WHERE h.worker_id=(SELECT worker FROM ctx) AND h.site_id=(SELECT site FROM ctx)
      UNION ALL SELECT 'risk',a.date,d.title,'시험 활동의 선택 명단',d.id FROM risk_activities a JOIN documents d ON d.id=a.document_id WHERE d.site_id=(SELECT site FROM ctx) AND d.type='risk' AND EXISTS(SELECT 1 FROM json_each(a.worker_snapshot) w WHERE json_extract(w.value,'$.id')=(SELECT worker FROM ctx))
      UNION ALL SELECT 'work_plan',d.date,d.title,'계획서에 지정된 작업자',d.id FROM documents d WHERE d.site_id=(SELECT site FROM ctx) AND d.type='work_plan' AND d.status='approved' AND (EXISTS(SELECT 1 FROM json_each(d.details,'$.workers') w WHERE json_extract(w.value,'$.workerId')=(SELECT worker FROM ctx)) OR EXISTS(SELECT 1 FROM json_each(d.details,'$.equipmentAssignments') w WHERE json_extract(w.value,'$.workerId')=(SELECT worker FROM ctx)))
      UNION ALL SELECT 'instruction',d.date,d.title,'지정된 시험 수신자',d.id FROM documents d WHERE d.site_id=(SELECT site FROM ctx) AND d.type='instruction' AND d.status='approved' AND json_extract(d.details,'$.recipientId')=(SELECT worker FROM ctx)
    ) SELECT kind,date,title,detail,document_id,CASE WHEN kind='checklist' THEN EXISTS(SELECT 1 FROM worker_self_checks c WHERE c.worker_id=(SELECT worker FROM ctx) AND c.date=activity.date AND c.signature IS NOT NULL) ELSE 0 END AS has_signature FROM activity WHERE kind IN (${kinds.map(()=>'?').join(',')}) ORDER BY date DESC,kind,title,document_id DESC LIMIT 101 OFFSET ?`;
    const rows=this.db.prepare(query).all(siteId,workerId,...kinds,offset),hasMore=rows.length>100;
    return {items:rows.slice(0,100),nextOffset:hasMore?offset+100:null};
  }
  dailyTrainingReport(siteId,from,to){
    from=dateValue(from);to=dateValue(to);if(from>to)throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    return this.db.prepare("SELECT w.id,w.name,w.company,w.category,NULLIF(json_extract(j.profile,'$.birthDate'),'') AS birth_date,c.kind,COUNT(*) AS count,SUM(c.signature IS NOT NULL) AS signed_count,json_group_array(c.date) AS dates FROM worker_daily_training c JOIN workers w ON w.id=c.worker_id LEFT JOIN join_acknowledgements j ON j.worker_id=w.id WHERE w.site_id=? AND c.date BETWEEN ? AND ? GROUP BY w.id,c.kind ORDER BY w.name,w.id,c.kind").all(siteId,from,to).map(row=>({...row,dates:JSON.parse(row.dates).sort()}));
  }
  educationReport(siteId,from,to){
    from=dateValue(from);to=dateValue(to);if(from>to)throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    return this.db.prepare("SELECT w.id,w.name,w.company,w.category,NULLIF(json_extract(j.profile,'$.birthDate'),'') AS birth_date,d.type,COALESCE(NULLIF(json_extract(d.details,'$.kind'),''),'unspecified') AS kind,COUNT(*) AS count,json_group_array(json_object('id',d.id,'date',d.date,'title',d.title)) AS documents FROM worker_training_checks c JOIN workers w ON w.id=c.worker_id LEFT JOIN join_acknowledgements j ON j.worker_id=w.id JOIN documents d ON d.id=c.document_id AND d.site_id=w.site_id WHERE w.site_id=? AND d.date BETWEEN ? AND ? AND d.type IN ('tbm','education') AND d.status='approved' GROUP BY w.id,d.type,kind ORDER BY w.name,w.id,d.type,kind").all(Number(siteId),from,to).map(row=>({...row,documents:JSON.parse(row.documents)}));
  }
  trainingTargets(documentId) {
    const doc=this.document(documentId);
    if(!doc || !['tbm','education'].includes(doc.type))throw new Error('교육 문서를 확인해 주세요.');
    const configured=!!this.db.prepare('SELECT 1 FROM training_target_config WHERE document_id=?').get(Number(documentId));
    const workers=this.db.prepare('SELECT w.id,w.name,w.company,COALESCE(a.present,0) AS present,a.company_snapshot AS attendance_company,a.occupation_snapshot AS attendance_occupation,EXISTS(SELECT 1 FROM training_targets t WHERE t.document_id=? AND t.worker_id=w.id) AS selected,EXISTS(SELECT 1 FROM worker_daily_training c WHERE c.worker_id=w.id AND c.date=? AND c.kind=?) AS daily_confirmed,EXISTS(SELECT 1 FROM worker_daily_training c WHERE c.worker_id=w.id AND c.date=? AND c.kind=? AND c.signature IS NOT NULL) AS daily_has_signature FROM workers w LEFT JOIN attendance a ON a.worker_id=w.id AND a.date=? WHERE w.site_id=? ORDER BY w.name,w.id').all(Number(documentId),doc.date,doc.type,doc.date,doc.type,doc.date,doc.site_id);
    return {configured,workers,signedWorkers:workers.filter(w=>w.daily_has_signature&&(!configured||w.selected))};
  }
  setTrainingTargets(documentId,workerIds) {
    const doc=this.document(documentId);
    if(!doc || !['tbm','education'].includes(doc.type) || !['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 교육 문서를 확인해 주세요.');
    if(!Array.isArray(workerIds) || workerIds.length>1000 || workerIds.some(id=>!Number.isSafeInteger(id) || id<1) || new Set(workerIds).size!==workerIds.length)throw new Error('교육 대상자를 확인해 주세요.');
    const exists=this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?');
    if(workerIds.some(id=>!exists.get(id,doc.site_id)))throw new Error('같은 현장의 교육 대상자를 선택해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT OR IGNORE INTO training_target_config(document_id) VALUES(?)').run(Number(documentId));
      this.db.prepare('DELETE FROM training_targets WHERE document_id=?').run(Number(documentId));
      const insert=this.db.prepare('INSERT INTO training_targets(document_id,worker_id) VALUES(?,?)');
      for(const id of workerIds)insert.run(Number(documentId),id);
      if(doc.type==='tbm')this.db.prepare('DELETE FROM tbm_signatures WHERE document_id=?').run(Number(documentId));
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  workerSelfCheck(workerId,date) {
    return this.db.prepare('SELECT date,created_at,signature IS NOT NULL AS has_signature FROM worker_self_checks WHERE worker_id=? AND date=?').get(Number(workerId),dateValue(date)) || null;
  }
  siteSelfChecks(siteId,date) {
    date=dateValue(date);
    return this.db.prepare('SELECT w.id,w.name,w.company,c.created_at,c.signature IS NOT NULL AS has_signature,c.answers FROM workers w LEFT JOIN worker_self_checks c ON c.worker_id=w.id AND c.date=? WHERE w.site_id=? ORDER BY w.name,w.id').all(date,Number(siteId)).map(row=>({...row,answers:row.answers?JSON.parse(row.answers):null}));
  }
  selfCheckSignature(siteId,workerId,date) {
    date=dateValue(date);
    return this.db.prepare('SELECT c.signature FROM worker_self_checks c JOIN workers w ON w.id=c.worker_id WHERE w.site_id=? AND w.id=? AND c.date=? AND c.signature IS NOT NULL').get(Number(siteId),Number(workerId),date)?.signature || null;
  }
  createWorkStop(workerId,input) {
    if(typeof input.anonymous!=='boolean')throw new Error('실명 또는 익명을 선택해 주세요.');
    const worker=this.db.prepare('SELECT id,site_id FROM workers WHERE id=?').get(Number(workerId));
    if(!worker)throw new Error('근로자를 확인해 주세요.');
    const place=text(input.place,'장소'),reason=text(input.reason,'사유',2000);
    let photo=null;
    if(input.photo){
      if(typeof input.photo!=='string' || input.photo.length>2800000)throw new Error('사진은 2MB 이하여야 합니다.');
      const match=input.photo.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if(!match)throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
      photo=Buffer.from(match[2],'base64');
      if(photo.length>2*1024*1024 || photo.toString('base64')!==match[2])throw new Error('사진 형식 또는 크기를 확인해 주세요.');
      if(match[1]==='png' && !photo.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || match[1]==='jpeg' && !photo.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('사진 형식을 확인해 주세요.');
    }
    this.db.prepare('INSERT INTO work_stops(site_id,worker_id,place,reason,photo) VALUES(?,?,?,?,?)').run(worker.site_id,input.anonymous?null:worker.id,place,reason,photo);
  }
  workStops(siteId,query='') {
    if(typeof query!=='string'||query.length>200)throw new Error('검색어를 확인해 주세요.');
    return this.db.prepare("SELECT s.id,s.place,s.reason,s.created_at,s.response,s.photo IS NOT NULL AS has_photo,CASE WHEN s.worker_id IS NULL THEN '익명' ELSE w.name END AS requester FROM work_stops s LEFT JOIN workers w ON w.id=s.worker_id WHERE s.site_id=? AND (instr(s.place,?)>0 OR instr(s.reason,?)>0 OR (s.worker_id IS NOT NULL AND instr(w.name,?)>0)) ORDER BY s.id DESC").all(Number(siteId),query,query,query);
  }
  updateWorkStopResponse(siteId,id,input){
    if(!input||typeof input!=='object'||Array.isArray(input)||!(input.previousResponse===null||typeof input.previousResponse==='string'))throw new Error('기존 조치 내용을 확인해 주세요.');
    const response=text(input.response,'조치 내용',2000),result=this.db.prepare('UPDATE work_stops SET response=? WHERE site_id=? AND id=? AND response IS ?').run(response,Number(siteId),Number(id),input.previousResponse);
    if(!result.changes){if(this.db.prepare('SELECT 1 FROM work_stops WHERE site_id=? AND id=?').get(Number(siteId),Number(id)))throw new Error('다른 변경이 있습니다. 다시 조회해 주세요.');throw new Error('선택한 현장의 요청을 확인해 주세요.');}
  }
  deleteWorkStop(siteId,id,input){
    if(!input||typeof input!=='object'||Array.isArray(input)||!(input.previousResponse===null||typeof input.previousResponse==='string'))throw new Error('기존 조치 내용을 확인해 주세요.');
    const result=this.db.prepare('DELETE FROM work_stops WHERE site_id=? AND id=? AND response IS ?').run(Number(siteId),Number(id),input.previousResponse);
    if(!result.changes){if(this.db.prepare('SELECT 1 FROM work_stops WHERE site_id=? AND id=?').get(Number(siteId),Number(id)))throw new Error('다른 변경이 있습니다. 다시 조회해 주세요.');throw new Error('선택한 현장의 요청을 확인해 주세요.');}
  }
  workStopPhoto(siteId,id) {return this.db.prepare('SELECT photo FROM work_stops WHERE site_id=? AND id=? AND photo IS NOT NULL').get(Number(siteId),Number(id))?.photo || null;}
  createHazardReport(siteId,input,workerId=null){
    if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(Number(siteId)))throw new Error('현장을 확인해 주세요.');
    const title=text(input.title,'제목'),body=text(input.body,'내용',2000),reporter=text(input.reporter,'가상 신고자'),photo=photoBytes(input.photo);
    return this.db.prepare('INSERT INTO hazard_reports(site_id,title,body,reporter,photo,worker_id) VALUES(?,?,?,?,?,?)').run(Number(siteId),title,body,reporter,photo,workerId).lastInsertRowid;
  }
  createWorkerHazardReport(workerId,input){const worker=this.db.prepare('SELECT id,site_id,name FROM workers WHERE id=?').get(Number(workerId));if(!worker)throw new Error('근로자를 확인해 주세요.');return this.createHazardReport(worker.site_id,{...input,reporter:worker.name},worker.id);}
  workerHazardReports(workerId){return this.db.prepare('SELECT id,title,body,status,response,created_at,photo IS NOT NULL AS has_photo FROM hazard_reports WHERE worker_id=? ORDER BY id DESC').all(Number(workerId));}
  workerHazardPhoto(workerId,id){return this.db.prepare('SELECT photo FROM hazard_reports WHERE worker_id=? AND id=? AND photo IS NOT NULL').get(Number(workerId),Number(id))?.photo||null;}
  hazardReports(siteId,query=''){if(typeof query!=='string'||query.length>200)throw new Error('검색어를 확인해 주세요.');return this.db.prepare('SELECT id,title,body,reporter,status,response,created_at,photo IS NOT NULL AS has_photo FROM hazard_reports WHERE site_id=? AND (instr(title,?)>0 OR instr(body,?)>0) ORDER BY id DESC').all(Number(siteId),query,query);}
  updateHazardReport(siteId,id,input){
    if(!['received','reviewing','resolved'].includes(input.status)||typeof input.response!=='string'||input.response.length>2000||input.status==='resolved'&&!input.response.trim())throw new Error('시험 처리 상태와 조치 내용을 확인해 주세요.');
    if(!this.db.prepare('UPDATE hazard_reports SET status=?,response=? WHERE site_id=? AND id=?').run(input.status,input.response.trim(),Number(siteId),Number(id)).changes)throw new Error('선택한 현장의 신고를 확인해 주세요.');
  }
  hazardReportPhoto(siteId,id){return this.db.prepare('SELECT photo FROM hazard_reports WHERE site_id=? AND id=? AND photo IS NOT NULL').get(Number(siteId),Number(id))?.photo||null;}
  createWorkerSelfCheck(workerId,date,answers,signature) {
    date=dateValue(date);
    if(!answers || typeof answers!=='object' || Array.isArray(answers) || !['equipment','sober','exercise','briefing'].every(key=>answers[key]===true))throw new Error('자가점검 네 항목을 모두 확인해 주세요.');
    const bytes=signatureBytes(signature);
    this.db.prepare('INSERT OR IGNORE INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(Number(workerId),date,bytes,JSON.stringify(Object.fromEntries(['equipment','sober','exercise','briefing'].map(key=>[key,answers[key]]))));
    return this.workerSelfCheck(workerId,date);
  }
  workerPermissions(siteId,workerId){
    if(!this.db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(Number(workerId),Number(siteId)))throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    return this.db.prepare('SELECT permission FROM worker_permissions WHERE worker_id=? ORDER BY permission').all(Number(workerId)).map(row=>row.permission);
  }
  setWorkerPermissions(siteId,workerId,permissions){
    this.workerPermissions(siteId,workerId);if(!Array.isArray(permissions)||permissions.some(value=>!['attendance','risk','work_plan'].includes(value))||new Set(permissions).size!==permissions.length)throw new Error('시험 권한을 확인해 주세요.');
    if(permissions.length&&!this.db.prepare('SELECT 1 FROM worker_accounts WHERE site_id=? AND worker_id=?').get(Number(siteId),Number(workerId)))throw new Error('시험 계정이 있는 출입자를 선택해 주세요.');
    this.db.exec('SAVEPOINT permission_update');try{this.db.prepare('DELETE FROM worker_permissions WHERE worker_id=?').run(Number(workerId));for(const permission of permissions)this.db.prepare('INSERT INTO worker_permissions(worker_id,permission) VALUES(?,?)').run(Number(workerId),permission);this.db.exec('RELEASE permission_update');}catch(error){this.db.exec('ROLLBACK TO permission_update');this.db.exec('RELEASE permission_update');throw error;}
    return this.workerPermissions(siteId,workerId);
  }
  delegatedAttendance(siteId,actorId,date){
    if(!this.workerPermissions(siteId,actorId).includes('attendance'))throw new Error('출역 관리 시험 권한이 필요합니다.');
    return this.attendance(siteId,date).map(({id,name,category,company,occupation,present})=>({id,name,category,company,occupation,present}));
  }
  setDelegatedAttendance(siteId,actorId,input,onAuthorize=null){
    const date=dateValue(input.date);
    this.db.exec('BEGIN IMMEDIATE');try{if(onAuthorize)onAuthorize();if(!this.workerPermissions(siteId,actorId).includes('attendance'))throw Object.assign(new Error('출역 관리 시험 권한이 필요합니다.'),{sessionStatus:403});const actor=this.db.prepare('SELECT name FROM workers WHERE id=? AND site_id=?').get(Number(actorId),Number(siteId)),target=this.db.prepare('SELECT name FROM workers WHERE id=? AND site_id=?').get(Number(input.workerId),Number(siteId));if(!target)throw new Error('같은 현장의 출입자를 확인해 주세요.');this.setAttendance({siteId,workerId:input.workerId,date,present:input.present});this.db.prepare("UPDATE attendance SET source='delegated' WHERE worker_id=? AND date=?").run(Number(input.workerId),date);this.db.prepare('INSERT INTO delegated_attendance_events(site_id,actor_id,actor_name,worker_id,worker_name,date,present) VALUES(?,?,?,?,?,?,?)').run(Number(siteId),Number(actorId),actor.name,Number(input.workerId),target.name,date,input.present?1:0);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  delegatedAttendanceEvents(siteId,date){date=dateValue(date);return this.db.prepare('SELECT id,actor_name,worker_name,present,created_at FROM delegated_attendance_events WHERE site_id=? AND date=? ORDER BY id DESC').all(Number(siteId),date);}
  workerDocuments(siteId,workerId){
    const permissions=this.workerPermissions(siteId,workerId).filter(value=>['risk','work_plan'].includes(value));
    return this.db.prepare('SELECT d.* FROM documents d JOIN worker_authored_documents a ON a.document_id=d.id WHERE d.site_id=? AND a.worker_id=? ORDER BY d.date DESC,d.id DESC').all(Number(siteId),Number(workerId)).filter(doc=>permissions.includes(doc.type));
  }
  workerDocument(siteId,workerId,id){const doc=this.workerDocuments(siteId,workerId).find(item=>item.id===Number(id));if(!doc)throw new Error('권한이 있는 본인 작성 문서를 확인해 주세요.');return doc;}
  createWorkerDocument(siteId,workerId,input){
    if(!['risk','work_plan'].includes(input.type)||!this.workerPermissions(siteId,workerId).includes(input.type))throw new Error('문서 작성 시험 권한이 필요합니다.');
    this.db.exec('BEGIN IMMEDIATE');try{const doc=this.createDocument({...input,siteId:Number(siteId)});this.db.prepare('INSERT INTO worker_authored_documents(document_id,worker_id) VALUES(?,?)').run(doc.id,Number(workerId));this.db.exec('COMMIT');return doc;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  updateWorkerDocument(siteId,workerId,id,input){const doc=this.workerDocument(siteId,workerId,id);return this.updateDocument(doc.id,{...input,siteId:Number(siteId),type:doc.type});}
  transitionWorkerDocument(siteId,workerId,id,action){const doc=this.workerDocument(siteId,workerId,id);if(!['submit','withdraw','revise'].includes(action))throw new Error('허용된 문서 상태 변경을 확인해 주세요.');return this.transition(doc.id,action);}
  workerDocumentOptions(siteId,workerId,type){
    if(!['risk','work_plan'].includes(type)||!this.workerPermissions(siteId,workerId).includes(type))throw new Error('문서 작성 시험 권한이 필요합니다.');
    const companies=this.companies(siteId).map(({id,name,trade})=>({id,name,trade}));if(type==='risk')return {companies};
    return {companies,equipment:this.equipment(siteId).map(({id,kind,model,registration})=>({id,kind,model,registration})),places:this.workPlaces(siteId).map(({id,name})=>({id,name})),rigging:this.rigging(siteId).map(({id,category,kind,name})=>({id,category,kind,name})),workers:this.workers(siteId).map(({id,name,company})=>({id,name,company}))};
  }
  setAttendance(input) {
    const date = dateValue(input.date);
    if (typeof input.present !== 'boolean') throw new Error('출역 상태를 확인해 주세요.');
    const worker = this.db.prepare('SELECT id,company,occupation,category FROM workers WHERE id=? AND site_id=?').get(Number(input.workerId),Number(input.siteId));
    if (!worker) throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    this.db.exec('SAVEPOINT attendance_update');try{
    const previous=this.db.prepare('SELECT present FROM attendance WHERE worker_id=? AND date=?').get(worker.id,date);
    this.db.prepare("INSERT INTO attendance(worker_id,date,present,company_snapshot,occupation_snapshot,category_snapshot,source) VALUES(?,?,?,?,?,?,'manual') ON CONFLICT(worker_id,date) DO UPDATE SET company_snapshot=CASE WHEN attendance.present=0 AND excluded.present=1 THEN excluded.company_snapshot ELSE attendance.company_snapshot END,occupation_snapshot=CASE WHEN attendance.present=0 AND excluded.present=1 THEN excluded.occupation_snapshot ELSE attendance.occupation_snapshot END,category_snapshot=CASE WHEN attendance.present=0 AND excluded.present=1 THEN excluded.category_snapshot ELSE attendance.category_snapshot END,present=excluded.present,source='manual',updated_at=CURRENT_TIMESTAMP").run(worker.id,date,input.present?1:0,input.present?worker.company:null,input.present?worker.occupation:null,input.present?worker.category:null);
    if(input.present&&!previous?.present)this.applyMealDefaults(worker.id,date);this.db.exec('RELEASE attendance_update');}catch(error){this.db.exec('ROLLBACK TO attendance_update');this.db.exec('RELEASE attendance_update');throw error;}
  }
  setAttendanceUnits(input){
    const date=dateValue(input.date),value=input.units;if(typeof value!=='string'||!/^$|^\d(?:\.\d{1,2})?$/.test(value))throw new Error('시험 공수는 0부터 9.99까지 입력해 주세요.');
    const [whole,fraction='']=value.split('.'),units=value===''?null:Number(whole)*100+Number(fraction.padEnd(2,'0'));
    const result=this.db.prepare('UPDATE attendance SET units_hundredths=?,updated_at=CURRENT_TIMESTAMP WHERE worker_id=? AND date=? AND present=1 AND EXISTS(SELECT 1 FROM workers WHERE workers.id=attendance.worker_id AND workers.site_id=?)').run(units,Number(input.workerId),date,Number(input.siteId));
    if(!result.changes)throw new Error('같은 현장의 출역 기록을 확인해 주세요.');
  }
  setAttendanceDailyRate(input){
    const date=dateValue(input.date),value=dailyRateValue(input.dailyRate);
    const result=this.db.prepare('UPDATE attendance SET daily_rate=?,salary_kind=NULL,salary_amount=NULL,updated_at=CURRENT_TIMESTAMP WHERE worker_id=? AND date=? AND present=1 AND EXISTS(SELECT 1 FROM workers WHERE workers.id=attendance.worker_id AND workers.site_id=?)').run(value,Number(input.workerId),date,Number(input.siteId));
    if(!result.changes)throw new Error('같은 현장의 출역 기록을 확인해 주세요.');
  }
  setAttendanceSalary(input){
    const date=dateValue(input.date),value=dailyRateValue(input.amount);
    if(!['monthly','yearly','other'].includes(input.kind)||value===null)throw new Error('시험 급여 종류와 금액을 확인해 주세요.');
    const result=this.db.prepare('UPDATE attendance SET salary_kind=?,salary_amount=?,updated_at=CURRENT_TIMESTAMP WHERE worker_id=? AND date=? AND present=1 AND EXISTS(SELECT 1 FROM workers WHERE workers.id=attendance.worker_id AND workers.site_id=?)').run(input.kind,value,Number(input.workerId),date,Number(input.siteId));
    if(!result.changes)throw new Error('같은 현장의 출역 기록을 확인해 주세요.');
  }
  updateMonthlyAttendanceDetails(input){
    const month=monthValue(input.month),fields=['category','company','occupation','dailyRate'].filter(key=>input[key]!==undefined);
    const salaryRequested=input.salaryKind!==undefined||input.salaryAmount!==undefined;
    if(salaryRequested&&fields.includes('dailyRate'))throw new Error('일당과 다른 급여를 동시에 변경할 수 없습니다.');
    let salaryAmount;if(salaryRequested){if(!['monthly','yearly','other'].includes(input.salaryKind)||typeof input.salaryAmount!=='string'||!/^\d{1,9}$/.test(input.salaryAmount))throw new Error('시험 급여 종류와 금액을 확인해 주세요.');salaryAmount=Number(input.salaryAmount);}
    if(!fields.length&&!salaryRequested)throw new Error('변경할 항목을 선택해 주세요.');
    const values=fields.map(key=>{if(key==='dailyRate'){const value=dailyRateValue(input[key]);if(value===null)throw new Error('변경할 시험 일당을 입력해 주세요.');return value;}return text(input[key],{category:'구분',company:'소속',occupation:'직종'}[key]);});
    const assignments=fields.map(key=>key==='dailyRate'?'daily_rate=?,salary_kind=NULL,salary_amount=NULL':`${key}_snapshot=?`);if(salaryRequested){assignments.push('salary_kind=?,salary_amount=?');values.push(input.salaryKind,salaryAmount);}
    const worker=this.db.prepare('SELECT id FROM workers WHERE id=? AND site_id=?').get(Number(input.workerId),Number(input.siteId));
    if(!worker)throw new Error('선택한 현장의 출입자를 확인해 주세요.');
    const result=this.db.prepare(`UPDATE attendance SET ${assignments.join(',')},updated_at=CURRENT_TIMESTAMP WHERE worker_id=? AND present=1 AND date BETWEEN ? AND ?`).run(...values,worker.id,`${month}-01`,`${month}-31`);
    if(!result.changes)throw new Error('해당 월의 출역 기록이 없습니다.');
    return result.changes;
  }
  workerAccessBlocks(siteId,month){
    month=monthValue(month);siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 확인해 주세요.');
    return this.db.prepare('SELECT date,kind FROM site_worker_blocks WHERE site_id=? AND date BETWEEN ? AND ? ORDER BY date,kind').all(siteId,`${month}-01`,`${month}-31`);
  }
  setWorkerAccessBlock(siteId,date,kind,blocked){
    siteId=Number(siteId);date=dateValue(date);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 확인해 주세요.');
    if(!['holiday','ended'].includes(kind)||typeof blocked!=='boolean')throw new Error('차단 설정을 확인해 주세요.');
    if(blocked)this.db.prepare('INSERT OR IGNORE INTO site_worker_blocks(site_id,date,kind) VALUES(?,?,?)').run(siteId,date,kind);
    else this.db.prepare('DELETE FROM site_worker_blocks WHERE site_id=? AND date=? AND kind=?').run(siteId,date,kind);
  }
  workerAccessBlocked(siteId,date){return !!this.db.prepare('SELECT 1 FROM site_worker_blocks WHERE site_id=? AND date=? LIMIT 1').get(Number(siteId),dateValue(date));}
  recordWorkerLogin(workerId,date,verifiedCredential=null,onLogin=null) {
    date=dateValue(date);
    this.db.exec('BEGIN IMMEDIATE');try{const worker=this.db.prepare('SELECT site_id FROM workers WHERE id=?').get(Number(workerId));if(!worker)throw new Error('근로자를 확인해 주세요.');if(verifiedCredential&&!this.db.prepare('SELECT 1 FROM worker_accounts WHERE worker_id=? AND site_id=? AND password_hash=?').get(Number(workerId),worker.site_id,verifiedCredential)){const error=new Error('가입 링크 또는 로그인 정보를 확인해 주세요.');error.sessionStatus=401;throw error;}if(this.workerAccessBlocked(worker.site_id,date))throw new Error('해당 현장은 오늘 근로자 접속이 차단되었습니다.');const result=this.db.prepare("INSERT OR IGNORE INTO attendance(worker_id,date,present,company_snapshot,occupation_snapshot,category_snapshot,source) SELECT id,?,1,company,occupation,category,'login' FROM workers WHERE id=?").run(date,Number(workerId));if(result.changes)this.applyMealDefaults(workerId,date);if(onLogin)onLogin();this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  attendanceReport(siteId, from, to, group) {
    from=dateValue(from); to=dateValue(to);
    if (from>to) throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    const groups={worker:['workers.id','workers.name','workers.company'],occupation:["COALESCE(attendance.occupation_snapshot,'기록 없음')","COALESCE(attendance.occupation_snapshot,'기록 없음')","''"],company:["COALESCE(attendance.company_snapshot,'기록 없음')","COALESCE(attendance.company_snapshot,'기록 없음')","''"],category:["COALESCE(attendance.category_snapshot,'기록 없음')","COALESCE(attendance.category_snapshot,'기록 없음')","''"]};
    if (!Object.hasOwn(groups,group)) throw new Error('집계 기준을 확인해 주세요.');
    const [key,label,detail]=groups[group];
    return this.db.prepare(`SELECT ${label} AS label, ${detail} AS detail, COUNT(*) AS days, SUM(attendance.units_hundredths) AS units_hundredths, COUNT(*)-COUNT(attendance.units_hundredths) AS units_missing FROM attendance JOIN workers ON workers.id=attendance.worker_id WHERE workers.site_id=? AND attendance.present=1 AND attendance.date BETWEEN ? AND ? GROUP BY ${key} ORDER BY label, detail`).all(Number(siteId),from,to);
  }
  attendanceSitesReport(from,to) {
    from=dateValue(from);to=dateValue(to);if(from>to)throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    return this.sites().map(site=>({id:site.id,name:site.name,categories:this.attendanceReport(site.id,from,to,'category').map(({label,days})=>({label,days}))}));
  }
  createInvitation(siteId,pending=false) {
    if (!this.db.prepare('SELECT id FROM sites WHERE id=?').get(Number(siteId))) throw new Error('현장을 선택해 주세요.');
    this.ensureSiteAccess(siteId);
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    this.db.prepare('INSERT INTO invitations(token_hash,site_id,expires_at,pending) VALUES(?,?,?,?)').run(hash,Number(siteId),expiresAt,pending?1:0);
    return { token, expiresAt };
  }
  revokeInvitations(siteId) {
    this.db.exec('BEGIN IMMEDIATE');try{const count=this.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE site_id=? AND revoked=0 AND pending=0').get(Number(siteId)).n;this.db.prepare('UPDATE invitations SET revoked=1 WHERE site_id=? AND revoked=0').run(Number(siteId));this.db.prepare('DELETE FROM site_registration WHERE site_id=?').run(Number(siteId));this.db.exec('COMMIT');return count;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  activateInvitation(token,authorize){
    const hash=createHash('sha256').update(token).digest('hex');this.db.exec('BEGIN IMMEDIATE');try{authorize();const result=this.db.prepare('UPDATE invitations SET pending=0 WHERE token_hash=? AND pending=1 AND revoked=0 AND expires_at>?').run(hash,Date.now());this.db.exec('COMMIT');return result.changes===1;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  discardPendingInvitation(token){this.db.prepare('DELETE FROM invitations WHERE token_hash=? AND pending=1').run(createHash('sha256').update(token).digest('hex'));}
  invitation(token) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    const hash=createHash('sha256').update(token).digest('hex');
    return this.db.prepare('SELECT sites.id,sites.name,invitations.expires_at FROM invitations JOIN sites ON sites.id=invitations.site_id WHERE token_hash=? AND revoked=0 AND pending=0 AND expires_at>?').get(hash,Date.now()) || null;
  }
  ensureSiteAccess(siteId){
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    this.db.prepare('INSERT OR IGNORE INTO site_access(site_id,access_key) VALUES(?,?)').run(siteId,randomBytes(32).toString('base64url'));
    return this.db.prepare('SELECT access_key FROM site_access WHERE site_id=?').get(siteId).access_key;
  }
  rotateSiteAccess(siteId){
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const key=randomBytes(32).toString('base64url');this.db.prepare('INSERT INTO site_access(site_id,access_key) VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET access_key=excluded.access_key').run(siteId,key);return key;
  }
  replaceSiteAccess(siteId,oldKey,newKey,authorize){
    this.db.exec('BEGIN IMMEDIATE');try{authorize();const result=this.db.prepare('UPDATE site_access SET access_key=? WHERE site_id=? AND access_key=?').run(newKey,Number(siteId),oldKey);this.db.exec('COMMIT');return result.changes===1;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  siteFromAccess(key){
    if(typeof key!=='string'||!/^[\w-]{43}$/.test(key))return null;
    return this.db.prepare('SELECT s.id,s.name FROM site_access a JOIN sites s ON s.id=a.site_id WHERE a.access_key=?').get(key)||null;
  }
  siteAccessKey(siteId){return this.db.prepare('SELECT access_key FROM site_access WHERE site_id=?').get(Number(siteId))?.access_key||null;}
  openSiteRegistration(siteId){
    this.ensureSiteAccess(siteId);const expiresAt=Date.now()+30*24*60*60*1000;
    this.db.prepare('INSERT INTO site_registration(site_id,expires_at) VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET expires_at=excluded.expires_at').run(Number(siteId),expiresAt);return expiresAt;
  }
  siteRegistrationExpiry(siteId){return this.db.prepare('SELECT expires_at FROM site_registration WHERE site_id=? AND expires_at>?').get(Number(siteId),Date.now())?.expires_at||null;}
  siteRegistrationOpen(siteId){return this.siteRegistrationExpiry(siteId)!==null;}
  join(token,input) {
    const invite=input.siteKey?this.siteFromAccess(input.siteKey):this.invitation(token);
    if(input.siteKey&&invite&&!this.siteRegistrationOpen(invite.id))throw new Error('이 현장의 시험 가입이 중지되었거나 만료되었습니다.');
    if (!invite) throw new Error('유효하지 않거나 만료된 가입 링크입니다.');
    if(input.acknowledged!==true)throw new Error('시험 안내를 확인해 주세요.');
    const equipment=input.equipment??[];
    if(!Array.isArray(equipment)||new Set(equipment).size!==equipment.length||equipment.some(item=>!['안전모','안전화','안전대','보안경','장갑'].includes(item)))throw new Error('시험 보호구를 확인해 주세요.');
    let profile=null;if(input.profile!==undefined){
      if(!input.profile||typeof input.profile!=='object'||Array.isArray(input.profile))throw new Error('시험 인적사항을 확인해 주세요.');
      const keys=['birthDate','phone','emergencyName','emergencyPhone','address','nationality','bloodType','healthStatus','pledge'];
      if(Object.keys(input.profile).some(key=>!keys.includes(key)))throw new Error('시험 인적사항을 확인해 주세요.');
      profile=Object.fromEntries(keys.map(key=>{const value=input.profile[key]??'';if(typeof value!=='string'||value.length>200||/[\x00-\x1f\x7f]/.test(value))throw new Error('시험 인적사항을 확인해 주세요.');return [key,value.trim()];}));
      if(profile.birthDate)profile.birthDate=dateValue(profile.birthDate);
      if([profile.phone,profile.emergencyPhone].some(value=>value&&!/^[0-9+() -]{3,30}$/.test(value)))throw new Error('시험 전화번호를 확인해 주세요.');
      if(!['','A','B','AB','O'].includes(profile.bloodType)||!['','양호','확인 필요'].includes(profile.healthStatus)||!['','확인'].includes(profile.pledge))throw new Error('가상 건강 상태와 서약을 확인해 주세요.');
    }
    const signature=input.signature===undefined?null:signatureBytes(input.signature);
    if(typeof input.loginId!=='string' || !/^[a-zA-Z0-9_]{3,40}$/.test(input.loginId))throw new Error('아이디는 영문, 숫자, 밑줄 3~40자로 입력해 주세요.');
    if(typeof input.password!=='string' || input.password.length<12 || input.password.length>256)throw new Error('암호는 12자 이상 256자 이하여야 합니다.');
    if(this.db.prepare('SELECT 1 FROM worker_accounts WHERE site_id=? AND login_id=?').get(invite.id,input.loginId))throw new Error('이 현장에 이미 사용 중인 아이디입니다.');
    const salt=randomBytes(16),passwordHash=scryptSync(input.password,salt,32);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=input.siteKey?this.siteFromAccess(input.siteKey):this.invitation(token);
      if(!current||current.id!==invite.id)throw new Error('유효하지 않거나 만료된 가입 링크입니다.');
      if(input.siteKey&&!this.siteRegistrationOpen(current.id))throw new Error('이 현장의 시험 가입이 중지되었거나 만료되었습니다.');
      const worker=this.createWorker({...input,siteId:invite.id});
      this.db.prepare('INSERT INTO worker_accounts(worker_id,site_id,login_id,salt,password_hash) VALUES(?,?,?,?,?)').run(worker.id,invite.id,input.loginId,salt,passwordHash);
      this.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,equipment,signature,profile) VALUES(?,?,?,?,?)').run(worker.id,'demo-v1',JSON.stringify(equipment),signature,profile?JSON.stringify(profile):null);
      this.db.exec('COMMIT');return worker;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  joinAcknowledgement(siteId,workerId){
    const row=this.db.prepare('SELECT a.notice_version,a.created_at,a.equipment,a.profile,a.signature IS NOT NULL AS has_signature FROM join_acknowledgements a JOIN workers w ON w.id=a.worker_id WHERE w.site_id=? AND w.id=?').get(Number(siteId),Number(workerId));
    return row?{...row,equipment:JSON.parse(row.equipment),profile:row.profile?JSON.parse(row.profile):null}:null;
  }
  joinSignature(siteId,workerId){return this.db.prepare('SELECT a.signature FROM join_acknowledgements a JOIN workers w ON w.id=a.worker_id WHERE w.site_id=? AND w.id=? AND a.signature IS NOT NULL').get(Number(siteId),Number(workerId))?.signature||null;}
  resetWorkerPassword(siteId,workerId,password) {
    if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('암호는 12자 이상 256자 이하여야 합니다.');
    const account=this.db.prepare('SELECT login_id FROM worker_accounts WHERE site_id=? AND worker_id=?').get(Number(siteId),Number(workerId));if(!account)throw new Error('선택한 현장의 시험 계정을 확인해 주세요.');
    const salt=randomBytes(16),hash=scryptSync(password,salt,32);this.db.prepare('UPDATE worker_accounts SET salt=?,password_hash=? WHERE site_id=? AND worker_id=?').run(salt,hash,Number(siteId),Number(workerId));return account.login_id;
  }
  authenticateWorker(token,loginId,password,siteKey=null,withCredential=false) {
    const site=siteKey?this.siteFromAccess(siteKey):this.invitation(token);
    if(!site || typeof loginId!=='string' || !/^[a-zA-Z0-9_]{3,40}$/.test(loginId) || typeof password!=='string' || password.length>256)return null;
    const account=this.db.prepare('SELECT worker_id,salt,password_hash FROM worker_accounts WHERE site_id=? AND login_id=?').get(site.id,loginId);
    if(!account)return null;
    const hash=scryptSync(password,account.salt,32);
    if(!timingSafeEqual(hash,account.password_hash))return null;
    const worker=this.db.prepare('SELECT workers.id,workers.name,workers.site_id,sites.name AS site_name FROM workers JOIN sites ON sites.id=workers.site_id WHERE workers.id=?').get(account.worker_id);return withCredential&&worker?{worker,credentialHash:Buffer.from(account.password_hash)}:worker;
  }
  documents(siteId, type = '', query = '', from = '', to = '') {
    if(from)from=dateValue(from);if(to)to=dateValue(to);
    if(from && to && from>to)throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    return this.db.prepare("SELECT documents.*,EXISTS(SELECT 1 FROM approval_steps WHERE document_id=documents.id) AS has_approval_line,COALESCE((SELECT source_document_id FROM work_plan_copies WHERE document_id=documents.id),(SELECT source_document_id FROM office_document_copies WHERE document_id=documents.id)) AS copied_from FROM documents WHERE (site_id=? OR (type='basic' AND status='approved' AND json_extract(details,'$.shared')=1)) AND (?='' OR type=?) AND (title LIKE ? OR body LIKE ? OR details LIKE ?) AND (?='' OR date>=?) AND (?='' OR date<=?) ORDER BY date DESC,id DESC").all(siteId,type,type,...Array(3).fill(`%${query}%`),from,from,to,to);
  }
  previousDailyReport(siteId, before) {
    before=dateValue(before);
    return this.db.prepare("SELECT date,body,details FROM documents WHERE site_id=? AND type='daily_report' AND date<? ORDER BY date DESC,id DESC LIMIT 1").get(Number(siteId),before) || null;
  }
  previousJointInspection(siteId,before) {
    before=dateValue(before);
    return this.db.prepare("SELECT date,json_extract(details,'$.items') AS items FROM documents WHERE site_id=? AND type='joint_inspection' AND date<? ORDER BY date DESC,id DESC LIMIT 1").get(Number(siteId),before) || null;
  }
  previousInspections(siteId,before,excludeId) {
    before=dateValue(before);
    return this.db.prepare("SELECT id,title,date,details FROM documents WHERE site_id=? AND type='inspection' AND date<? AND id<>? ORDER BY date DESC,id DESC LIMIT 20").all(Number(siteId),before,Number(excludeId)||0);
  }
  previousRiskAssessments(siteId,before,kind,scale,excludeId) {
    before=dateValue(before);
    if(!['initial','regular','occasional','continuous'].includes(kind) || !['three-level','3x3','5x4'].includes(scale))throw new Error('평가 종류와 척도를 선택해 주세요.');
    return this.db.prepare("SELECT id,title,date,details FROM documents WHERE site_id=? AND type='risk' AND status IN ('pending','approved') AND date<=? AND id<>? AND json_extract(details,'$.kind')=? AND json_extract(details,'$.scale')=? ORDER BY date DESC,id DESC LIMIT 20").all(Number(siteId),before,Number(excludeId)||0,kind,scale);
  }
  dailySourceDocuments(siteId, date) {
    date=dateValue(date);
    return this.db.prepare("SELECT id,type,title,date,body,status FROM documents WHERE site_id=? AND date=? AND type IN ('tbm','education') ORDER BY id DESC").all(Number(siteId),date);
  }
  safetyLogSources(siteId,date) {
    date=dateValue(date);
    const documents=this.db.prepare("SELECT id,type,title,body,details,status FROM documents WHERE site_id=? AND date=? AND type IN ('notice','tbm','education','inspection','patrol','daily_report') ORDER BY id DESC").all(Number(siteId),date);
    return {present:this.attendance(siteId,date).filter(row=>row.present).length,documents};
  }
  weeklyActivity(siteId,start){
    start=dateValue(start);siteId=Number(siteId);if(!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 선택해 주세요.');
    const day=new Date(`${start}T00:00:00Z`),dates=Array.from({length:7},(_,i)=>{const value=new Date(day.getTime()+i*86400000).toISOString().slice(0,10);return dateValue(value);}),end=dates[6],rows=dates.map(date=>({date,attendance:0,attendanceCategories:[],attendanceOccupations:[],documents:{},noticeReads:0,trainingChecks:0,trainingByType:{tbm:0,education:0},workerChecks:0,managerChecks:0,managerDaysOff:0,hazardReports:0})),byDate=new Map(rows.map(row=>[row.date,row]));
    for(const row of this.db.prepare('SELECT a.date,COUNT(*) AS n FROM attendance a JOIN workers w ON w.id=a.worker_id WHERE w.site_id=? AND a.present=1 AND a.date BETWEEN ? AND ? GROUP BY a.date').all(siteId,start,end))byDate.get(row.date).attendance=row.n;
    for(const row of this.db.prepare("SELECT a.date,COALESCE(a.category_snapshot,'기록 없음') AS category,COALESCE(a.occupation_snapshot,'기록 없음') AS occupation,COUNT(*) AS n FROM attendance a JOIN workers w ON w.id=a.worker_id WHERE w.site_id=? AND a.present=1 AND a.date BETWEEN ? AND ? GROUP BY a.date,category,occupation").all(siteId,start,end)){
      const day=byDate.get(row.date);
      for(const [list,label] of [[day.attendanceCategories,row.category],[day.attendanceOccupations,row.occupation]]){let item=list.find(entry=>entry.label===label);if(!item)list.push(item={label,days:0});item.days+=row.n;}
    }
    for(const row of this.db.prepare('SELECT c.date,COUNT(*) AS n FROM worker_self_checks c JOIN workers w ON w.id=c.worker_id WHERE w.site_id=? AND c.date BETWEEN ? AND ? GROUP BY c.date').all(siteId,start,end))byDate.get(row.date).workerChecks=row.n;
    for(const row of this.db.prepare('SELECT date,COUNT(*) AS n FROM manager_self_checks WHERE site_id=? AND date BETWEEN ? AND ? GROUP BY date').all(siteId,start,end))byDate.get(row.date).managerChecks=row.n;
    for(const row of this.db.prepare('SELECT date,COUNT(*) AS n FROM manager_days_off WHERE site_id=? AND date BETWEEN ? AND ? GROUP BY date').all(siteId,start,end))byDate.get(row.date).managerDaysOff=row.n;
    for(const row of this.db.prepare("SELECT date(created_at,'localtime') AS day,COUNT(*) AS n FROM hazard_reports WHERE site_id=? AND date(created_at,'localtime') BETWEEN ? AND ? GROUP BY day").all(siteId,start,end))byDate.get(row.day).hazardReports=row.n;
    for(const row of this.db.prepare("SELECT date,type,COUNT(*) AS n FROM documents WHERE site_id=? AND date BETWEEN ? AND ? AND type<>'office' GROUP BY date,type").all(siteId,start,end))byDate.get(row.date).documents[row.type]=row.n;
    for(const row of this.db.prepare("SELECT d.date,COUNT(*) AS n FROM worker_notice_reads c JOIN documents d ON d.id=c.document_id JOIN workers w ON w.id=c.worker_id AND w.site_id=d.site_id WHERE d.site_id=? AND d.date BETWEEN ? AND ? AND d.type='notice' AND d.status='approved' GROUP BY d.date").all(siteId,start,end))byDate.get(row.date).noticeReads=row.n;
    for(const row of this.db.prepare("SELECT d.date,d.type,COUNT(*) AS n FROM worker_training_checks c JOIN documents d ON d.id=c.document_id JOIN workers w ON w.id=c.worker_id AND w.site_id=d.site_id WHERE d.site_id=? AND d.date BETWEEN ? AND ? AND d.type IN ('tbm','education') AND d.status='approved' GROUP BY d.date,d.type").all(siteId,start,end)){const day=byDate.get(row.date);day.trainingByType[row.type]=row.n;day.trainingChecks+=row.n;}
    return rows;
  }
  reviewers(siteId){return this.db.prepare('SELECT id,site_id,login_id,name,active FROM reviewers WHERE site_id=? ORDER BY name,id').all(Number(siteId));}
  reviewer(id){return this.db.prepare('SELECT id,site_id,name FROM reviewers WHERE id=? AND active=1').get(Number(id))||null;}
  createReviewer(input){
    const siteId=Number(input.siteId),name=text(input.name,'결재자 이름');
    if(!Number.isSafeInteger(siteId)||!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(siteId))throw new Error('현장을 확인해 주세요.');
    if(typeof input.loginId!=='string'||!/^[A-Za-z0-9_]{3,40}$/.test(input.loginId))throw new Error('시험 아이디를 확인해 주세요.');
    if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw new Error('시험 암호는 12자 이상 256자 이하여야 합니다.');
    if(this.db.prepare('SELECT 1 FROM reviewers WHERE login_id=?').get(input.loginId))throw new Error('이미 사용 중인 시험 아이디입니다.');
    const salt=randomBytes(16),hash=scryptSync(input.password,salt,32),id=this.db.prepare('INSERT INTO reviewers(site_id,login_id,name,salt,password_hash,auth_version) VALUES(?,?,?,?,?,lower(hex(randomblob(16))))').run(siteId,input.loginId,name,salt,hash).lastInsertRowid;
    return this.db.prepare('SELECT id,site_id,login_id,name,active FROM reviewers WHERE id=?').get(id);
  }
  updateReviewer(siteId,id,input){
    const row=this.db.prepare('SELECT id FROM reviewers WHERE id=? AND site_id=?').get(Number(id),Number(siteId));if(!row)throw new Error('선택한 현장의 시험 결재자를 확인해 주세요.');
    if(input.active!==undefined&&typeof input.active!=='boolean')throw new Error('계정 상태를 확인해 주세요.');
    if(input.password!==undefined&&(typeof input.password!=='string'||input.password.length<12||input.password.length>256))throw new Error('시험 암호는 12자 이상 256자 이하여야 합니다.');
    if(input.active===undefined&&input.password===undefined)throw new Error('변경할 내용을 확인해 주세요.');
    this.db.exec('SAVEPOINT update_reviewer');try{if(input.password!==undefined){const salt=randomBytes(16),hash=scryptSync(input.password,salt,32);this.db.prepare('UPDATE reviewers SET salt=?,password_hash=? WHERE id=?').run(salt,hash,row.id);}if(input.active!==undefined)this.db.prepare('UPDATE reviewers SET active=? WHERE id=?').run(input.active?1:0,row.id);if(input.password!==undefined||input.active===false){this.db.prepare('UPDATE reviewers SET auth_version=lower(hex(randomblob(16))) WHERE id=?').run(row.id);this.db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(row.id);}this.db.exec('RELEASE update_reviewer');}catch(error){this.db.exec('ROLLBACK TO update_reviewer');this.db.exec('RELEASE update_reviewer');throw error;}
    return this.db.prepare('SELECT id,site_id,login_id,name,active FROM reviewers WHERE id=?').get(row.id);
  }
  authenticateReviewer(loginId,password,withCredential=false){
    const row=typeof loginId==='string'&&/^[A-Za-z0-9_]{3,40}$/.test(loginId)?this.db.prepare('SELECT * FROM reviewers WHERE login_id=?').get(loginId):null;
    const salt=row?.salt||Buffer.alloc(16),candidate=typeof password==='string'&&password.length<=256?password:'',hash=scryptSync(candidate,salt,32),expected=row?.password_hash||Buffer.alloc(32);
    if(!row||!row.active||!timingSafeEqual(hash,expected))return null;const reviewer={id:row.id,site_id:row.site_id,name:row.name};return withCredential?{reviewer,credentialHash:Buffer.from(row.password_hash),authVersion:row.auth_version}:reviewer;
  }
  approvalLine(id){return this.db.prepare('SELECT s.position,s.reviewer_id,s.state,r.name,r.active FROM approval_steps s JOIN reviewers r ON r.id=s.reviewer_id WHERE s.document_id=? ORDER BY s.position').all(Number(id));}
  previousApprovalLine(id){
    const doc=this.document(id);if(!doc||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 문서를 확인해 주세요.');
    const previous=this.db.prepare('SELECT d.id,d.title,d.date FROM documents d WHERE d.site_id=? AND d.type=? AND d.id<? AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.document_id=d.id) ORDER BY d.id DESC LIMIT 1').get(doc.site_id,doc.type,doc.id);
    return previous?{document:previous,reviewers:this.approvalLine(previous.id)}:null;
  }
  setApprovalLine(id,ids){
    const doc=this.document(id);if(!doc||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 문서를 확인해 주세요.');
    if(!Array.isArray(ids)||ids.length>4||ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length)throw new Error('결재자를 확인해 주세요.');
    const exists=this.db.prepare('SELECT 1 FROM reviewers WHERE id=? AND site_id=? AND active=1');if(ids.some(id=>!exists.get(id,doc.site_id)))throw new Error('같은 현장의 활성 결재자를 선택해 주세요.');
    this.db.exec('SAVEPOINT set_approval_line');try{this.db.prepare('DELETE FROM approval_steps WHERE document_id=?').run(Number(id));const add=this.db.prepare('INSERT INTO approval_steps(document_id,position,reviewer_id) VALUES(?,?,?)');ids.forEach((reviewerId,index)=>add.run(Number(id),index+1,reviewerId));if(doc.type==='office')this.db.prepare('DELETE FROM meeting_signatures WHERE document_id=?').run(Number(id));this.db.exec('RELEASE set_approval_line');}catch(error){this.db.exec('ROLLBACK TO set_approval_line');this.db.exec('RELEASE set_approval_line');throw error;}
    return this.approvalLine(id);
  }
  reviewerDocuments(reviewerId){return this.db.prepare("SELECT d.id,d.site_id,d.type,d.title,d.date FROM documents d JOIN approval_steps s ON s.document_id=d.id JOIN reviewers r ON r.id=s.reviewer_id AND r.site_id=d.site_id WHERE r.id=? AND r.active=1 AND d.status='pending' AND s.state='pending' AND NOT EXISTS (SELECT 1 FROM approval_steps prior WHERE prior.document_id=d.id AND prior.position<s.position AND prior.state<>'approved') ORDER BY d.date DESC,d.id DESC").all(Number(reviewerId));}
  reviewerDocument(reviewerId,id){return this.reviewerDocuments(reviewerId).some(doc=>doc.id===Number(id))?this.document(id):null;}
  officeReferences(id){const doc=this.document(id);if(!doc||doc.type!=='office')throw new Error('업무 문서를 확인해 주세요.');return this.db.prepare('SELECT r.id,r.name,r.active FROM office_reference_recipients o JOIN reviewers r ON r.id=o.reviewer_id WHERE o.document_id=? ORDER BY r.name,r.id').all(Number(id));}
  setOfficeReferences(id,ids){
    if(!Array.isArray(ids)||ids.length>100||ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length)throw new Error('참조자를 확인해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');try{const doc=this.document(id);if(!doc||doc.type!=='office'||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 업무 문서를 확인해 주세요.');const exists=this.db.prepare('SELECT 1 FROM reviewers WHERE id=? AND site_id=? AND active=1');if(ids.some(reviewer=>!exists.get(reviewer,doc.site_id)))throw new Error('같은 현장의 활성 참조자를 선택해 주세요.');this.db.prepare('DELETE FROM office_reference_recipients WHERE document_id=?').run(Number(id));const add=this.db.prepare('INSERT INTO office_reference_recipients(document_id,reviewer_id) VALUES(?,?)');for(const reviewer of ids)add.run(Number(id),reviewer);this.db.prepare('DELETE FROM meeting_signatures WHERE document_id=?').run(Number(id));this.db.exec('COMMIT');return this.officeReferences(id);}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  officeReferenceDocuments(reviewerId){return this.db.prepare("SELECT d.id,d.site_id,d.type,json_extract(a.document_json,'$.title') AS title,json_extract(a.document_json,'$.date') AS date,d.status FROM documents d JOIN office_reference_recipients o ON o.document_id=d.id JOIN reviewers r ON r.id=o.reviewer_id AND r.site_id=d.site_id JOIN office_reference_cycle_recipients c ON c.cycle_id=d.approval_cycle_id AND c.reviewer_id=r.id JOIN approval_cycles a ON a.id=c.cycle_id AND a.document_id=d.id WHERE r.id=? AND r.active=1 AND d.type='office' AND d.status IN ('pending','approved','rejected') ORDER BY date DESC,d.id DESC").all(Number(reviewerId));}
  officeReferenceDocument(reviewerId,id){return this.officeReferenceDocuments(reviewerId).some(doc=>doc.id===Number(id))?this.document(id):null;}
  priorReviewerEvents(doc,reviewerId){
    if(!doc.approval_cycle_id)return [];
    return this.db.prepare("SELECT e.id,e.reviewer_name,e.opinion,e.created_at,e.signature IS NOT NULL AS has_signature FROM events e JOIN approval_steps prior ON prior.document_id=e.document_id AND prior.reviewer_id=e.reviewer_id AND prior.state='approved' JOIN approval_steps current ON current.document_id=e.document_id AND current.reviewer_id=? AND current.state='pending' AND prior.position<current.position WHERE e.document_id=? AND e.approval_cycle_id=? AND e.action='approve' ORDER BY prior.position,e.id").all(Number(reviewerId),doc.id,doc.approval_cycle_id);
  }
  liveReviewerLinks(doc){
    if(doc.type==='risk')return {type:'risk',activities:this.riskActivities(doc.id).map(activity=>({...activity,worker_snapshot:JSON.parse(activity.worker_snapshot||'[]'),files:this.riskActivityPhotos(doc.id,activity.id)}))};
    if(doc.type==='permit')return {type:'permit',checks:this.permitChecks(doc.id),extensions:this.permitExtensions(doc.id)};
    if(doc.type==='joint_inspection')return {type:'joint',authorSignature:!!this.jointSignature(doc.id)};
    if(doc.type==='office'){const referenceId=JSON.parse(doc.details||'{}').referenceId||0,reference=referenceId?this.officeReference(doc.site_id,referenceId):null;if(referenceId&&!reference)throw new Error('연결된 품의서가 변경되었습니다. 다시 확인해 주세요.');return {type:'office',authorSignature:!!this.meetingSignature(doc.id),referenceRecipients:this.officeReferences(doc.id),reference:reference?{id:reference.id,title:reference.title,date:reference.date,body:reference.body,files:this.attachments(reference.id)}:null};}
    if(['work_council','safety_meeting'].includes(doc.type))return {type:'meeting',authorSignature:!!this.meetingSignature(doc.id)};
    if(['tbm','education'].includes(doc.type)){const targets=this.trainingTargets(doc.id);return {type:'training',authorSignature:doc.type==='tbm'&&!!this.tbmSignature(doc.id),configured:targets.configured,workers:targets.workers.filter(worker=>!targets.configured||worker.selected),signedWorkers:targets.signedWorkers,checks:this.trainingChecks(doc.id)};}
    if(doc.type!=='work_plan')return null;const details=JSON.parse(doc.details||'{}'),equipmentIds=details.equipmentIds||[],riggingIds=details.riggingIds||[],snapshots=Array.isArray(details.equipmentSnapshot)?details.equipmentSnapshot:null;
    const equipment=this.equipment(doc.site_id).filter(item=>equipmentIds.includes(item.id)).map(item=>{const snapshot=snapshots?.find(row=>row.id===item.id);return {info:snapshot||item,snapshot:!!snapshot,files:this.equipmentAttachments(doc.site_id,item.id)};});
    const rigging=this.rigging(doc.site_id).filter(item=>riggingIds.includes(item.id)).map(item=>({info:{...item,details:JSON.parse(item.details)},files:this.riggingPhotos(doc.site_id,item.id)}));
    const place=this.workPlaces(doc.site_id).find(item=>item.id===details.workPlaceId);
    return {type:'plan',equipment,rigging,place:place?{info:{...place,details:JSON.parse(place.details)},files:this.workPlacePhotos(doc.site_id,place.id)}:null,checks:this.equipmentChecks(doc.id).map(check=>({...check,items:JSON.parse(check.items),equipment_snapshot:check.equipment_snapshot?JSON.parse(check.equipment_snapshot):null}))};
  }
  liveReviewerLinkedFile(doc,kind,parentId,fileId){
    if(kind==='risk'&&doc.type==='risk')return this.riskActivityPhoto(doc.id,parentId,fileId);
    if(kind==='office-reference'&&doc.type==='office'){const ref=JSON.parse(doc.details||'{}').referenceId,file=ref===Number(parentId)&&this.officeReference(doc.site_id,ref)&&this.attachment(fileId);return file&&file.document_id===ref?file:null;}
    if(doc.type!=='work_plan')return null;const details=JSON.parse(doc.details||'{}'),parent=Number(parentId);
    if(kind==='equipment'&&(details.equipmentIds||[]).includes(parent))return this.equipmentAttachment(doc.site_id,parent,fileId);
    if(kind==='rigging'&&(details.riggingIds||[]).includes(parent))return this.riggingPhoto(doc.site_id,parent,fileId);
    if(kind==='place'&&details.workPlaceId===parent)return this.workPlacePhoto(doc.site_id,parent,fileId);
    return null;
  }
  liveReviewerLinkedSignature(doc,kind,id){
    if(kind==='risk-activity'&&doc.type==='risk')return this.riskActivitySignature(doc.id,id)?.signature||null;
    if(kind==='permit'&&doc.type==='permit')return this.permitExtensionSignature(doc.id,id);
    if(kind==='training'&&['tbm','education'].includes(doc.type))return this.documentTrainingSignature(doc.id,id);
    if(kind==='author'&&doc.type==='tbm'&&Number(id)===0)return this.tbmSignature(doc.id)?.signature||null;
    if(kind==='author'&&doc.type==='joint_inspection'&&Number(id)===0)return this.jointSignature(doc.id)?.signature||null;
    if(kind==='author'&&['work_council','safety_meeting','office'].includes(doc.type)&&Number(id)===0)return this.meetingSignature(doc.id)?.signature||null;
    if(kind==='equipment-check'&&doc.type==='work_plan')return this.equipmentCheckSignature(doc.id,id);
    return null;
  }
  captureApprovalCycle(doc){
    const linked=this.liveReviewerLinks(doc),attachments=this.attachments(doc.id),cycle=this.db.prepare('INSERT INTO approval_cycles(document_id,document_json,attachments_json,linked_json) VALUES(?,?,?,?)').run(doc.id,JSON.stringify(doc),JSON.stringify(attachments),JSON.stringify(linked)).lastInsertRowid;
    if(linked?.type==='office'){const add=this.db.prepare('INSERT INTO office_reference_cycle_recipients(cycle_id,reviewer_id) VALUES(?,?)');for(const person of linked.referenceRecipients)add.run(cycle,person.id);}
    const insert=this.db.prepare('INSERT INTO approval_cycle_files(cycle_id,kind,parent_id,file_id,name,data) VALUES(?,?,?,?,?,?)');
    const save=(kind,parentId,fileId,file)=>{if(!file||!file.data)throw new Error('결재 자료를 보존할 수 없습니다.');insert.run(cycle,kind,Number(parentId),Number(fileId),file.name||'signature.png',file.data);};
    for(const file of attachments)save('document',0,file.id,this.attachment(file.id));
    if(linked?.type==='plan'){
      for(const item of linked.equipment)for(const file of item.files)save('equipment',item.info.id,file.id,this.liveReviewerLinkedFile(doc,'equipment',item.info.id,file.id));
      for(const item of linked.rigging)for(const file of item.files)save('rigging',item.info.id,file.id,this.liveReviewerLinkedFile(doc,'rigging',item.info.id,file.id));
      if(linked.place)for(const file of linked.place.files)save('place',linked.place.info.id,file.id,this.liveReviewerLinkedFile(doc,'place',linked.place.info.id,file.id));
      for(const check of linked.checks)if(check.has_signature)save('equipment-check-signature',check.id,0,{data:this.liveReviewerLinkedSignature(doc,'equipment-check',check.id)});
    }
    if(linked?.type==='risk')for(const activity of linked.activities){for(const file of activity.files)save('risk',activity.id,file.id,this.liveReviewerLinkedFile(doc,'risk',activity.id,file.id));if(activity.has_signature)save('risk-activity-signature',activity.id,0,{data:this.liveReviewerLinkedSignature(doc,'risk-activity',activity.id)});}
    if(linked?.type==='permit')for(const extension of linked.extensions)save('permit-signature',extension.id,0,{data:this.liveReviewerLinkedSignature(doc,'permit',extension.id)});
    if(linked?.type==='training')for(const worker of linked.signedWorkers)save('training-signature',worker.id,0,{data:this.liveReviewerLinkedSignature(doc,'training',worker.id)});
    if(linked?.type==='office'&&linked.reference)for(const file of linked.reference.files)save('office-reference',linked.reference.id,file.id,this.liveReviewerLinkedFile(doc,'office-reference',linked.reference.id,file.id));
    if(['training','joint','meeting','office'].includes(linked?.type)&&linked.authorSignature)save('author-signature',0,0,{data:this.liveReviewerLinkedSignature(doc,'author',0)});
    this.db.prepare('UPDATE documents SET approval_cycle_id=? WHERE id=?').run(cycle,doc.id);return cycle;
  }
  approvalCycle(documentId,cycleId){const row=this.db.prepare('SELECT id,document_id,document_json,attachments_json,linked_json,created_at FROM approval_cycles WHERE id=? AND document_id=?').get(Number(cycleId),Number(documentId));return row?{id:row.id,documentId:row.document_id,createdAt:row.created_at,document:JSON.parse(row.document_json),attachments:JSON.parse(row.attachments_json),linked:JSON.parse(row.linked_json)}:null;}
  approvalCycleFile(documentId,cycleId,kind,parentId,fileId){return this.db.prepare('SELECT f.name,f.data FROM approval_cycle_files f JOIN approval_cycles c ON c.id=f.cycle_id WHERE c.document_id=? AND c.id=? AND f.kind=? AND f.parent_id=? AND f.file_id=?').get(Number(documentId),Number(cycleId),kind,Number(parentId),Number(fileId))||null;}
  reviewerPayload(doc){const cycle=doc.approval_cycle_id&&this.approvalCycle(doc.id,doc.approval_cycle_id);return cycle?{document:{...cycle.document,status:doc.status,approval_cycle_id:cycle.id},attachments:cycle.attachments,linked:cycle.linked,frozen:true}:{document:doc,attachments:this.attachments(doc.id),linked:this.liveReviewerLinks(doc),frozen:false};}
  reviewerLinkedFile(doc,kind,parentId,fileId){return doc.approval_cycle_id?this.approvalCycleFile(doc.id,doc.approval_cycle_id,kind,parentId,fileId):this.liveReviewerLinkedFile(doc,kind,parentId,fileId);}
  reviewerLinkedSignature(doc,kind,id){return doc.approval_cycle_id?this.approvalCycleFile(doc.id,doc.approval_cycle_id,`${kind}-signature`,id,0)?.data||null:this.liveReviewerLinkedSignature(doc,kind,id);}
  reviewerAttachment(doc,fileId){return doc.approval_cycle_id?this.approvalCycleFile(doc.id,doc.approval_cycle_id,'document',0,fileId):this.attachment(fileId);}
  createDocument(input) {
    const d = recordInput(input);
    if (!this.db.prepare('SELECT id FROM sites WHERE id=?').get(d.siteId)) throw new Error('현장을 선택해 주세요.');
    this.validateBasicCategory(d);
    this.validatePlanEquipment(d);
    this.validateSafetyMeeting(d);
    this.validateInstructionRecipient(d);
    this.validateRiskContractors(d);
    this.validateOfficeReference(d);
    if(d.type==='safety_log')d.details.attendanceSnapshot={present:this.attendance(d.siteId,d.date).filter(row=>row.present).length,capturedAt:new Date().toISOString()};
    const id = this.db.prepare('INSERT INTO documents(site_id,type,title,date,body,details) VALUES(?,?,?,?,?,?)').run(d.siteId,d.type,d.title,d.date,d.body,JSON.stringify(d.details)).lastInsertRowid;
    return this.document(id);
  }
  document(id) { const doc=this.db.prepare('SELECT documents.*,COALESCE((SELECT source_document_id FROM work_plan_copies WHERE document_id=documents.id),(SELECT source_document_id FROM office_document_copies WHERE document_id=documents.id)) AS copied_from,(SELECT version FROM basic_document_versions WHERE document_id=documents.id) AS basic_version FROM documents WHERE id=?').get(Number(id));if(doc&&doc.type!=='basic')delete doc.basic_version;return doc; }
  officeReference(siteId,id){const ref=this.document(id);return ref&&ref.site_id===Number(siteId)&&ref.type==='office'&&JSON.parse(ref.details).kind==='품의서'?ref:null;}
  validateOfficeReference(doc){if(doc.type==='office'&&doc.details.referenceId&&!this.officeReference(doc.siteId,doc.details.referenceId))throw new Error('같은 현장의 품의서를 선택해 주세요.');}
  copyOfficeDocument(id,input){
    this.db.exec('BEGIN IMMEDIATE');try{const source=this.document(id);if(!source||source.type!=='office'||source.site_id!==Number(input.siteId))throw new Error('같은 현장의 업무 문서를 확인해 주세요.');const copy=this.createDocument({siteId:source.site_id,type:'office',title:input.title,date:input.date,body:source.body,details:JSON.parse(source.details)});this.db.prepare('INSERT INTO office_document_copies(document_id,source_document_id) VALUES(?,?)').run(copy.id,source.id);this.db.exec('COMMIT');return this.document(copy.id);}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  copyWorkPlan(id,input){
    const source=this.document(id);if(!source||source.type!=='work_plan'||source.site_id!==Number(input.siteId))throw new Error('같은 현장의 작업계획서를 확인해 주세요.');
    this.db.exec('SAVEPOINT copy_work_plan');try{const copy=this.createDocument({siteId:source.site_id,type:'work_plan',title:input.title,date:input.date,body:source.body,details:JSON.parse(source.details)});this.db.prepare('INSERT INTO work_plan_copies(document_id,source_document_id) VALUES(?,?)').run(copy.id,source.id);this.db.exec('RELEASE copy_work_plan');return this.document(copy.id);}catch(error){this.db.exec('ROLLBACK TO copy_work_plan');this.db.exec('RELEASE copy_work_plan');throw error;}
  }
  permitChecks(documentId){const doc=this.document(documentId);if(!doc||doc.type!=='permit')throw new Error('시험 작업허가서를 확인해 주세요.');return this.db.prepare('SELECT * FROM permit_checks WHERE document_id=? ORDER BY date DESC,id DESC').all(Number(documentId)).map(row=>({...row,items:JSON.parse(row.items)}));}
  savePermitCheck(documentId,input,id=null){
    this.permitChecks(documentId);const date=dateValue(input.date);if(!Array.isArray(input.items)||input.items.length<1||input.items.length>20)throw new Error('점검 항목은 1개부터 20개까지 입력해 주세요.');
    const items=input.items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item)||!['pass','fail'].includes(item.result)||typeof item.action!=='string'||item.action.length>1000)throw new Error('점검 결과를 확인해 주세요.');const name=text(item.name,'점검 항목',500),action=item.action.trim();if(item.result==='pass'&&action)throw new Error('적정 항목의 조치 내용을 비워 주세요.');return {name,result:item.result,action};});
    if(id!==null){if(!this.db.prepare('UPDATE permit_checks SET date=?,items=? WHERE id=? AND document_id=?').run(date,JSON.stringify(items),Number(id),Number(documentId)).changes)throw new Error('시험 점검을 찾을 수 없습니다.');return Number(id);}
    return this.db.prepare('INSERT INTO permit_checks(document_id,date,items) VALUES(?,?,?)').run(Number(documentId),date,JSON.stringify(items)).lastInsertRowid;
  }
  deletePermitCheck(documentId,id){this.permitChecks(documentId);if(!this.db.prepare('DELETE FROM permit_checks WHERE id=? AND document_id=?').run(Number(id),Number(documentId)).changes)throw new Error('시험 점검을 찾을 수 없습니다.');}
  permitExtensions(documentId){const doc=this.document(documentId);if(!doc||doc.type!=='permit')throw new Error('시험 작업허가서를 확인해 주세요.');return this.db.prepare('SELECT id,date_from,date_to,time_from,time_to,created_at FROM permit_extensions WHERE document_id=? ORDER BY date_from DESC,id DESC').all(Number(documentId));}
  permitExtensionSignature(documentId,id){this.permitExtensions(documentId);return this.db.prepare('SELECT signature FROM permit_extensions WHERE id=? AND document_id=?').get(Number(id),Number(documentId))?.signature||null;}
  savePermitExtension(documentId,input,id=null){
    this.permitExtensions(documentId);const from=dateValue(input.dateFrom),to=dateValue(input.dateTo),timeFrom=input.timeFrom??'',timeTo=input.timeTo??'',valid=time=>typeof time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
    if(from>to||typeof timeFrom!=='string'||typeof timeTo!=='string'||(timeFrom||timeTo)&&(!valid(timeFrom)||!valid(timeTo)||from===to&&timeFrom>timeTo))throw new Error('연장 기간과 시간을 확인해 주세요.');
    const signature=signatureBytes(input.signature);
    if(id!==null){if(!this.db.prepare('UPDATE permit_extensions SET date_from=?,date_to=?,time_from=?,time_to=?,signature=? WHERE id=? AND document_id=?').run(from,to,timeFrom,timeTo,signature,Number(id),Number(documentId)).changes)throw new Error('시험 연장 기록을 찾을 수 없습니다.');return Number(id);}
    return this.db.prepare('INSERT INTO permit_extensions(document_id,date_from,date_to,time_from,time_to,signature) VALUES(?,?,?,?,?,?)').run(Number(documentId),from,to,timeFrom,timeTo,signature).lastInsertRowid;
  }
  deletePermitExtension(documentId,id){this.permitExtensions(documentId);if(!this.db.prepare('DELETE FROM permit_extensions WHERE id=? AND document_id=?').run(Number(id),Number(documentId)).changes)throw new Error('시험 연장 기록을 찾을 수 없습니다.');}
  riskActivities(documentId){const doc=this.document(documentId);if(!doc||doc.type!=='risk')throw new Error('위험성평가를 확인해 주세요.');return this.db.prepare('SELECT a.*,EXISTS(SELECT 1 FROM risk_activity_signatures s WHERE s.activity_id=a.id) AS has_signature FROM risk_activities a WHERE a.document_id=? ORDER BY a.date DESC,a.id DESC').all(Number(documentId));}
  riskActivitySignature(documentId,id){return this.db.prepare('SELECT s.signature,s.created_at FROM risk_activity_signatures s JOIN risk_activities a ON a.id=s.activity_id JOIN documents d ON d.id=a.document_id WHERE d.id=? AND d.type=\'risk\' AND a.id=?').get(Number(documentId),Number(id))||null;}
  saveRiskActivitySignature(documentId,id,signature){const activity=this.db.prepare("SELECT a.* FROM risk_activities a JOIN documents d ON d.id=a.document_id WHERE d.id=? AND d.type='risk' AND a.id=? AND a.kind='weekly' AND a.entry_mode='manual'").get(Number(documentId),Number(id));if(!activity||!activity.period_from||!activity.period_to||!activity.place||!activity.host||!activity.content||!JSON.parse(activity.worker_snapshot).length)throw new Error('직접 작성한 주간 점검의 필수 내용을 확인해 주세요.');const bytes=signatureBytes(signature);this.db.prepare('INSERT INTO risk_activity_signatures(activity_id,signature) VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET signature=excluded.signature,created_at=CURRENT_TIMESTAMP').run(activity.id,bytes);}
  saveRiskActivity(documentId,input,id=null){
    this.riskActivities(documentId);
    if(!['meeting','weekly','education','other'].includes(input.kind))throw new Error('시험 활동 종류를 확인해 주세요.');
    const date=dateValue(input.date),fields={};for(const key of ['place','host','participants','content']){if(typeof input[key]!=='string'||input[key].length>2000)throw new Error('시험 활동 내용을 확인해 주세요.');fields[key]=input[key].trim();}
    const from=input.periodFrom||'',to=input.periodTo||'',mode=input.entryMode||'manual';if(!['manual','scan'].includes(mode)||mode==='scan'&&input.kind!=='weekly')throw new Error('회의록 작성 방식을 확인해 주세요.');
    if((from||to)&&(!from||!to||dateValue(from)>dateValue(to)))throw new Error('관리기간을 확인해 주세요.');
    const current=id===null?null:this.db.prepare('SELECT worker_snapshot,kind,classification,date FROM risk_activities WHERE id=? AND document_id=?').get(Number(id),Number(documentId));if(id!==null&&!current)throw new Error('시험 활동을 찾을 수 없습니다.');
    const classification=input.classification??current?.classification??'';if(typeof classification!=='string'||classification.length>200||(input.kind==='other'&&!classification.trim()&&!(current?.kind==='other'&&!current.classification)))throw new Error('기타 자료 구분을 확인해 주세요.');
    if(current&&(input.kind!=='weekly'||mode!=='scan')&&this.db.prepare("SELECT 1 FROM risk_activity_photos WHERE activity_id=? AND purpose='minutes' LIMIT 1").get(Number(id)))throw new Error('회의록 첨부를 삭제한 뒤 작성 방식을 변경해 주세요.');
    if(current&&input.kind!=='other'&&this.db.prepare("SELECT 1 FROM risk_activity_photos WHERE activity_id=? AND purpose='material' LIMIT 1").get(Number(id)))throw new Error('기타 자료 첨부를 삭제한 뒤 종류를 변경해 주세요.');
    if(input.kind==='weekly'&&current&&current.date!==date&&input.workerIds===undefined&&JSON.parse(current.worker_snapshot).length)throw new Error('회의 날짜가 변경되어 참석자를 다시 선택해 주세요.');
    let workers=current?.worker_snapshot||'[]';
    if(input.workerIds!==undefined){if(!Array.isArray(input.workerIds)||input.workerIds.length>100||input.workerIds.some(value=>!Number.isSafeInteger(value)||value<1)||new Set(input.workerIds).size!==input.workerIds.length)throw new Error('참석자를 확인해 주세요.');
      const doc=this.document(documentId),lookup=this.db.prepare('SELECT id,name,company FROM workers WHERE id=? AND site_id=?'),previous=current&&current.date!==date?[]:JSON.parse(workers);workers=JSON.stringify(input.workerIds.map(workerId=>{const worker=lookup.get(workerId,doc.site_id);if(!worker)throw new Error('같은 현장의 참석자를 선택해 주세요.');return previous.find(item=>item.id===workerId)||worker;}));}
    if(input.kind==='weekly'&&(!from||!to))throw new Error('주간 점검의 관리기간을 입력해 주세요.');
    if(input.kind==='weekly'&&mode==='manual'&&(!fields.place||!fields.host||!fields.content||!JSON.parse(workers).length))throw new Error('주간 점검의 장소·주관·참석자·내용을 확인해 주세요.');
    if(id!==null){this.db.exec('SAVEPOINT update_risk_activity');try{this.db.prepare('UPDATE risk_activities SET kind=?,date=?,place=?,host=?,participants=?,content=?,period_from=?,period_to=?,entry_mode=?,worker_snapshot=?,classification=? WHERE id=? AND document_id=?').run(input.kind,date,fields.place,fields.host,fields.participants,fields.content,from,to,mode,workers,input.kind==='other'?classification.trim():'',Number(id),Number(documentId));this.db.prepare('DELETE FROM risk_activity_signatures WHERE activity_id=?').run(Number(id));this.db.exec('RELEASE update_risk_activity');return Number(id);}catch(error){this.db.exec('ROLLBACK TO update_risk_activity');this.db.exec('RELEASE update_risk_activity');throw error;}}
    return this.db.prepare('INSERT INTO risk_activities(document_id,kind,date,place,host,participants,content,period_from,period_to,entry_mode,worker_snapshot,classification) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(Number(documentId),input.kind,date,fields.place,fields.host,fields.participants,fields.content,from,to,mode,workers,input.kind==='other'?classification.trim():'').lastInsertRowid;
  }
  deleteRiskActivity(documentId,id){this.riskActivities(documentId);if(!this.db.prepare('DELETE FROM risk_activities WHERE id=? AND document_id=?').run(Number(id),Number(documentId)).changes)throw new Error('시험 활동을 찾을 수 없습니다.');}
  riskActivityPhotos(documentId,id){if(!this.db.prepare('SELECT 1 FROM risk_activities WHERE id=? AND document_id=?').get(Number(id),Number(documentId)))throw new Error('시험 활동을 찾을 수 없습니다.');return this.db.prepare("SELECT id,name,purpose,length(data) AS size,CASE WHEN substr(data,1,8)=X'89504E470D0A1A0A' THEN 'image/png' WHEN substr(data,1,3)=X'FFD8FF' THEN 'image/jpeg' ELSE NULL END AS image_type FROM risk_activity_photos WHERE activity_id=? ORDER BY id").all(Number(id));}
  addRiskActivityPhoto(documentId,id,name,data,purpose='photo'){
    const photos=this.riskActivityPhotos(documentId,id);if(photos.length>=20)throw new Error('시험 사진은 20개까지 가능합니다.');
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const activity=this.db.prepare('SELECT kind,entry_mode FROM risk_activities WHERE id=? AND document_id=?').get(Number(id),Number(documentId));if(!['photo','minutes','material'].includes(purpose)||purpose==='minutes'&&(activity.kind!=='weekly'||activity.entry_mode!=='scan')||purpose==='material'&&activity.kind!=='other')throw new Error('첨부 구분을 확인해 주세요.');
    const bytes=Buffer.from(data),image=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));if(purpose!=='material'&&!image&&!(purpose==='minutes'&&bytes.subarray(0,5).toString()==='%PDF-'))throw new Error('PNG 또는 JPEG 사진이나 허용된 PDF 회의록을 선택해 주세요.');
    this.db.exec('SAVEPOINT add_risk_activity_file');try{const fileId=this.db.prepare('INSERT INTO risk_activity_photos(activity_id,name,data,purpose) VALUES(?,?,?,?)').run(Number(id),name,bytes,purpose).lastInsertRowid;this.db.prepare('DELETE FROM risk_activity_signatures WHERE activity_id=?').run(Number(id));this.db.exec('RELEASE add_risk_activity_file');return fileId;}catch(error){this.db.exec('ROLLBACK TO add_risk_activity_file');this.db.exec('RELEASE add_risk_activity_file');throw error;}
  }
  riskActivityPhoto(documentId,id,photoId){return this.db.prepare('SELECT p.* FROM risk_activity_photos p JOIN risk_activities a ON a.id=p.activity_id WHERE a.document_id=? AND a.id=? AND p.id=?').get(Number(documentId),Number(id),Number(photoId))||null;}
  deleteRiskActivityPhoto(documentId,id,photoId){if(!this.riskActivityPhoto(documentId,id,photoId))throw new Error('시험 사진을 찾을 수 없습니다.');this.db.exec('SAVEPOINT delete_risk_activity_file');try{this.db.prepare('DELETE FROM risk_activity_photos WHERE id=?').run(Number(photoId));this.db.prepare('DELETE FROM risk_activity_signatures WHERE activity_id=?').run(Number(id));this.db.exec('RELEASE delete_risk_activity_file');}catch(error){this.db.exec('ROLLBACK TO delete_risk_activity_file');this.db.exec('RELEASE delete_risk_activity_file');throw error;}}
  instructionResult(id){const doc=this.document(id);if(!doc||doc.type!=='instruction')throw new Error('작업지시서를 확인해 주세요.');return this.db.prepare('SELECT date,actor,content,created_at,source,signature IS NOT NULL AS has_signature FROM instruction_results WHERE document_id=?').get(Number(id))||null;}
  instructionSignature(id){return this.db.prepare('SELECT signature FROM instruction_results WHERE document_id=? AND signature IS NOT NULL').get(Number(id))?.signature || null;}
  addInstructionResult(id,input,source='manager'){
    const existing=this.instructionResult(id),doc=this.document(id);if(existing)throw new Error('시험 조치 기록이 이미 있습니다.');
    if(doc.status!=='approved')throw new Error('승인된 시험 지시서에만 조치 기록을 추가할 수 있습니다.');
    const date=dateValue(input.date),actor=text(input.actor,'가상 담당자'),content=text(input.content,'시험 조치 내용',2000);
    if(!['manager','worker'].includes(source))throw new Error('시험 기록 출처를 확인해 주세요.');
    const signature=source==='worker'&&input.signature ? signatureBytes(input.signature) : null;
    this.db.prepare('INSERT INTO instruction_results(document_id,date,actor,content,source,signature) VALUES(?,?,?,?,?,?)').run(Number(id),date,actor,content,source,signature);return this.instructionResult(id);
  }
  workerInstructions(workerId){
    const worker=this.db.prepare('SELECT id,site_id FROM workers WHERE id=?').get(Number(workerId));if(!worker)throw new Error('근로자를 확인해 주세요.');
    return this.db.prepare("SELECT d.id,d.title,d.date,d.body,r.date AS result_date,r.content AS result_content,r.source AS result_source FROM documents d LEFT JOIN instruction_results r ON r.document_id=d.id WHERE d.site_id=? AND d.type='instruction' AND d.status='approved' AND json_extract(d.details,'$.recipientId')=? ORDER BY d.id DESC").all(worker.site_id,worker.id);
  }
  workerInstructionAttachments(workerId,id){
    const doc=this.document(id),worker=this.db.prepare('SELECT site_id FROM workers WHERE id=?').get(Number(workerId));
    if(!doc||!worker||doc.site_id!==worker.site_id||doc.type!=='instruction'||doc.status!=='approved'||JSON.parse(doc.details).recipientId!==Number(workerId))throw new Error('지정된 시험 지시서를 확인해 주세요.');
    return this.attachments(id);
  }
  respondInstruction(workerId,id,input){
    const worker=this.db.prepare('SELECT id,name,site_id FROM workers WHERE id=?').get(Number(workerId)),doc=this.document(id);
    if(!worker||!doc||doc.site_id!==worker.site_id||doc.type!=='instruction'||doc.status!=='approved'||JSON.parse(doc.details).recipientId!==worker.id)throw new Error('지정된 시험 지시서를 확인해 주세요.');
    return this.addInstructionResult(id,{date:input.date,actor:worker.name,content:input.content,signature:input.signature},'worker');
  }
  workerInstructionPhotos(workerId,id){
    const doc=this.document(id),worker=this.db.prepare('SELECT site_id FROM workers WHERE id=?').get(Number(workerId));
    if(!doc||!worker||doc.site_id!==worker.site_id||doc.type!=='instruction'||doc.status!=='approved'||JSON.parse(doc.details).recipientId!==Number(workerId)||this.instructionResult(id)?.source!=='worker')throw new Error('본인의 시험 조치 기록을 확인해 주세요.');
    return this.instructionPhotos(id);
  }
  addWorkerInstructionPhoto(workerId,id,phase,name,data){this.workerInstructionPhotos(workerId,id);return this.addInstructionPhoto(id,phase,name,data);}
  instructionPhotos(id){if(!this.instructionResult(id))throw new Error('시험 조치 기록을 먼저 저장해 주세요.');return this.db.prepare('SELECT id,phase,name,length(data) AS size FROM instruction_photos WHERE document_id=? ORDER BY id').all(Number(id));}
  addInstructionPhoto(id,phase,name,data){
    const existing=this.instructionPhotos(id);if(!['before','after'].includes(phase))throw new Error('사진 구분을 확인해 주세요.');
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f\x7f]/.test(name))throw new Error('사진 이름을 확인해 주세요.');
    if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw new Error('사진은 1바이트 이상 2MB 이하여야 합니다.');
    const bytes=Buffer.from(data);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('PNG 또는 JPEG 사진을 선택해 주세요.');
    if(existing.length>=20)throw new Error('시험 사진은 20개까지 가능합니다.');
    return this.db.prepare('INSERT INTO instruction_photos(document_id,phase,name,data) VALUES(?,?,?,?)').run(Number(id),phase,name,bytes).lastInsertRowid;
  }
  instructionPhoto(id,photoId){return this.db.prepare('SELECT * FROM instruction_photos WHERE document_id=? AND id=?').get(Number(id),Number(photoId))||null;}
  deleteInstructionPhoto(id,photoId){if(!this.instructionPhoto(id,photoId))throw new Error('시험 사진을 찾을 수 없습니다.');this.db.prepare('DELETE FROM instruction_photos WHERE document_id=? AND id=?').run(Number(id),Number(photoId));}
  attachments(id) {return this.db.prepare('SELECT id,name,category,length(data) AS size,created_at FROM attachments WHERE document_id=? ORDER BY id').all(Number(id));}
  checklistSignature(id){const doc=this.document(id);if(!doc||doc.type!=='checklist')throw new Error('체크리스트를 확인해 주세요.');return this.db.prepare('SELECT signature,created_at FROM checklist_signatures WHERE document_id=?').get(Number(id))||null;}
  saveChecklistSignature(id,signature){const doc=this.document(id);if(!doc||doc.type!=='checklist'||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 체크리스트를 확인해 주세요.');const bytes=signatureBytes(signature);this.db.prepare('INSERT INTO checklist_signatures(document_id,signature) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature,created_at=CURRENT_TIMESTAMP').run(Number(id),bytes);}
  tbmSignature(id){const doc=this.document(id);if(!doc||doc.type!=='tbm')throw new Error('TBM 문서를 확인해 주세요.');return this.db.prepare('SELECT signature,created_at FROM tbm_signatures WHERE document_id=?').get(Number(id))||null;}
  saveTbmSignature(id,signature){const doc=this.document(id);if(!doc||doc.type!=='tbm'||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 TBM 문서를 확인해 주세요.');const bytes=signatureBytes(signature);this.db.prepare('INSERT INTO tbm_signatures(document_id,signature) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature,created_at=CURRENT_TIMESTAMP').run(Number(id),bytes);}
  jointSignature(id){const doc=this.document(id);if(!doc||doc.type!=='joint_inspection')throw new Error('합동 점검 문서를 확인해 주세요.');return this.db.prepare('SELECT signature,created_at FROM joint_inspection_signatures WHERE document_id=?').get(Number(id))||null;}
  saveJointSignature(id,signature){const doc=this.document(id);if(!doc||doc.type!=='joint_inspection'||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 합동 점검을 확인해 주세요.');const bytes=signatureBytes(signature);this.db.prepare('INSERT INTO joint_inspection_signatures(document_id,signature) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature,created_at=CURRENT_TIMESTAMP').run(Number(id),bytes);}
  meetingSignature(id){const doc=this.document(id);if(!doc||!['work_council','safety_meeting','office'].includes(doc.type))throw new Error('회의 또는 업무 문서를 확인해 주세요.');return this.db.prepare('SELECT signature,created_at FROM meeting_signatures WHERE document_id=?').get(Number(id))||null;}
  saveMeetingSignature(id,signature){const doc=this.document(id);if(!doc||!['work_council','safety_meeting','office'].includes(doc.type)||!['draft','rejected'].includes(doc.status))throw new Error('수정 가능한 회의 또는 업무 문서를 확인해 주세요.');const bytes=signatureBytes(signature);this.db.prepare('INSERT INTO meeting_signatures(document_id,signature) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature,created_at=CURRENT_TIMESTAMP').run(Number(id),bytes);}
  attachment(id) {return this.db.prepare('SELECT * FROM attachments WHERE id=?').get(Number(id));}
  copyNoticeAttachments(id,sourceId){
    const target=this.document(id),source=Number.isSafeInteger(sourceId)&&sourceId>0?this.document(sourceId):null;
    if(!target||target.type!=='notice'||!['draft','rejected'].includes(target.status))throw new Error('수정 가능한 공지를 확인해 주세요.');
    if(!source||source.id===target.id||source.type!=='notice'||source.status!=='approved'||source.site_id!==target.site_id||source.date>=target.date)throw new Error('같은 현장의 이전 게시 공지를 선택해 주세요.');
    const files=this.attachments(source.id),existing=this.attachments(target.id);
    if(!files.length)throw new Error('선택한 공지에 첨부파일이 없습니다.');
    if(existing.length+files.length>20)throw new Error('첨부파일은 문서당 20개까지 가능합니다.');
    this.db.exec('SAVEPOINT copy_notice_attachments');
    try{this.db.prepare("INSERT INTO attachments(document_id,name,data,category) SELECT ?,name,data,'general' FROM attachments WHERE document_id=? ORDER BY id").run(target.id,source.id);this.db.exec('RELEASE copy_notice_attachments');}catch(error){this.db.exec('ROLLBACK TO copy_notice_attachments');this.db.exec('RELEASE copy_notice_attachments');throw error;}
    return {copied:files.length};
  }
  addAttachment(id,name,data,category='general') {
    const doc=this.document(id);
    if (!doc || !['draft','rejected'].includes(doc.status)) throw new Error('임시저장 또는 반려된 문서에만 첨부할 수 있습니다.');
    if (typeof name!=='string' || !name.trim() || name.length>200 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error('파일 이름을 확인해 주세요.');
    if (!(data instanceof Uint8Array) || data.length===0 || data.length>2*1024*1024) throw new Error('파일은 1바이트 이상 2MB 이하여야 합니다.');
    if(!['general','plan_diagram','morning_hazard_photo'].includes(category)||category==='plan_diagram'&&doc.type!=='work_plan'||category==='morning_hazard_photo'&&(doc.type!=='checklist'||JSON.parse(doc.details).kind!=='morning'))throw new Error('첨부 구분을 확인해 주세요.');
    if(['plan_diagram','morning_hazard_photo'].includes(category)){const bytes=Buffer.from(data);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('시험 이미지는 PNG 또는 JPEG를 선택해 주세요.');}
    if (this.attachments(id).length>=20) throw new Error('첨부파일은 문서당 20개까지 가능합니다.');
    this.db.exec('BEGIN IMMEDIATE');try{const attachmentId=this.db.prepare('INSERT INTO attachments(document_id,name,data,category) VALUES(?,?,?,?)').run(Number(id),name,data,category).lastInsertRowid;if(doc.type==='checklist')this.db.prepare('DELETE FROM checklist_signatures WHERE document_id=?').run(Number(id));if(doc.type==='tbm')this.db.prepare('DELETE FROM tbm_signatures WHERE document_id=?').run(Number(id));if(doc.type==='joint_inspection')this.db.prepare('DELETE FROM joint_inspection_signatures WHERE document_id=?').run(Number(id));if(['work_council','safety_meeting','office'].includes(doc.type))this.db.prepare('DELETE FROM meeting_signatures WHERE document_id=?').run(Number(id));this.db.exec('COMMIT');return attachmentId;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  deleteAttachment(id) {
    const attachment=this.attachment(id);
    if(!attachment) throw new Error('첨부파일을 찾을 수 없습니다.');
    const doc=this.document(attachment.document_id);
    if(!doc || !['draft','rejected'].includes(doc.status)) throw new Error('임시저장 또는 반려된 문서의 첨부파일만 삭제할 수 있습니다.');
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM attachments WHERE id=?').run(Number(id));if(doc.type==='checklist')this.db.prepare('DELETE FROM checklist_signatures WHERE document_id=?').run(doc.id);if(doc.type==='tbm')this.db.prepare('DELETE FROM tbm_signatures WHERE document_id=?').run(doc.id);if(doc.type==='joint_inspection')this.db.prepare('DELETE FROM joint_inspection_signatures WHERE document_id=?').run(doc.id);if(['work_council','safety_meeting','office'].includes(doc.type))this.db.prepare('DELETE FROM meeting_signatures WHERE document_id=?').run(doc.id);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  updateDocument(id, input) {
    const current = this.document(id);
    if (!current) throw new Error('문서를 찾을 수 없습니다.');
    if(current.type==='cost' && Array.isArray(JSON.parse(current.details).rows))throw new Error('월간 사용내역서는 보존된 내역을 변경할 수 없습니다. 새 문서를 작성해 주세요.');
    if (current.status !== 'draft' && current.status !== 'rejected') throw new Error('임시저장 또는 반려된 문서만 수정할 수 있습니다.');
    if(current.type==='risk'){const previous=JSON.parse(current.details),rows=Array.isArray(previous.items)?previous.items:[previous],keys=['improvedGrade','improvedLikelihood','improvedSeverity'];if(rows.some(row=>keys.some(key=>row[key]))){const next=input.details,items=next&&Array.isArray(next.items)?next.items:next&&typeof next==='object'?[next]:null;if(!items||items.some(item=>!item||keys.some(key=>item[key]===undefined)))throw new Error('개선 후 위험성 정보를 보존하려면 화면을 새로고침해 주세요.');}}
    if(current.type==='risk'&&JSON.parse(current.details).musculoskeletalItems?.length&&input.details?.musculoskeletalItems===undefined)throw new Error('근골격계 항목을 보존하려면 화면을 새로고침해 주세요.');
    if(current.type==='work_plan'&&(input.details===undefined||input.details&&typeof input.details==='object'&&!Array.isArray(input.details))){const previous=JSON.parse(current.details),details={...input.details};for(const key of ['heavyLoads','equipmentAssignments','safetyMeasures'])if(details[key]===undefined&&previous[key]!==undefined)details[key]=previous[key];input={...input,details};}
    if(current.type==='permit'&&(input.details===undefined||input.details&&typeof input.details==='object'&&!Array.isArray(input.details))){const previous=JSON.parse(current.details),details={...input.details};if(details.safetyMeasures===undefined&&previous.safetyMeasures!==undefined)details.safetyMeasures=previous.safetyMeasures;input={...input,details};}
    if(current.type==='basic'&&JSON.parse(current.details).categoryId>0&&input.details?.categoryId===undefined)throw new Error('기본 서류 분류를 보존하려면 화면을 새로고침해 주세요.');
    if(current.type==='office'&&JSON.parse(current.details).referenceId>0&&input.details?.referenceId===undefined)throw new Error('참조 품의서를 보존하려면 화면을 새로고침해 주세요.');
    const d = recordInput(input);
    if (d.siteId !== current.site_id || d.type !== current.type) throw new Error('문서의 현장과 유형은 변경할 수 없습니다.');
    this.validateBasicCategory(d);
    if(d.type==='checklist'&&d.details.kind!=='morning'&&this.db.prepare("SELECT 1 FROM attachments WHERE document_id=? AND category='morning_hazard_photo' LIMIT 1").get(Number(id)))throw new Error('점검 항목 사진을 삭제한 뒤 점검 종류를 변경해 주세요.');
    this.validatePlanEquipment(d);
    this.validateSafetyMeeting(d,current);
    this.validateInstructionRecipient(d);
    this.validateRiskContractors(d);
    this.validateOfficeReference(d);
    if(d.type==='safety_log'){
      const previous=JSON.parse(current.details).attendanceSnapshot;
      if(current.date===d.date){if(previous)d.details.attendanceSnapshot=previous;}
      else d.details.attendanceSnapshot={present:this.attendance(d.siteId,d.date).filter(row=>row.present).length,capturedAt:new Date().toISOString()};
    }
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE documents SET title=?,date=?,body=?,details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(d.title,d.date,d.body,JSON.stringify(d.details),Number(id));if(d.type==='checklist')this.db.prepare('DELETE FROM checklist_signatures WHERE document_id=?').run(Number(id));if(d.type==='tbm')this.db.prepare('DELETE FROM tbm_signatures WHERE document_id=?').run(Number(id));if(d.type==='joint_inspection')this.db.prepare('DELETE FROM joint_inspection_signatures WHERE document_id=?').run(Number(id));if(['work_council','safety_meeting','office'].includes(d.type))this.db.prepare('DELETE FROM meeting_signatures WHERE document_id=?').run(Number(id));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.document(id);
  }
  updateRiskImprovement(documentId,input){
    const doc=this.document(documentId);
    if(!doc||doc.type!=='risk'||doc.site_id!==Number(input.siteId))throw new Error('같은 현장의 위험성평가를 확인해 주세요.');
    if(doc.status!=='approved')throw new Error('승인된 위험성평가만 개선 정보를 변경할 수 있습니다.');
    const details=JSON.parse(doc.details),items=Array.isArray(details.items)?details.items:[details],batch=input.changes!==undefined,changes=batch?input.changes:[input];
    if(!Array.isArray(changes)||!changes.length||changes.length>items.length)throw new Error('위험요인을 확인해 주세요.');
    const indices=new Set(),validated=changes.map(change=>{
      if(!change||!Number.isSafeInteger(change.index)||change.index<0||change.index>=items.length||indices.has(change.index))throw new Error('위험요인을 확인해 주세요.');indices.add(change.index);
      const values={};for(const key of ['dueDate','completionDate']){if(typeof change[key]!=='string')throw new Error('개선 날짜를 확인해 주세요.');values[key]=change[key]?dateValue(change[key]):'';}
      if(typeof change.responsible!=='string'||change.responsible.length>2000)throw new Error('담당자를 확인해 주세요.');values.responsible=change.responsible.trim();
      if(batch&&(!change.previous||['dueDate','completionDate','responsible'].some(key=>typeof change.previous[key]!=='string'||change.previous[key]!==String(items[change.index][key]||''))))throw new Error('다른 변경이 있어 다시 확인해 주세요.');
      return {index:change.index,values};
    });
    for(const change of validated)Object.assign(items[change.index],change.values);
    this.db.prepare('UPDATE documents SET details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(details),doc.id);
    return this.document(doc.id);
  }
  validateRiskContractors(doc){
    if(doc.type!=='risk')return;
    const find=this.db.prepare('SELECT name FROM companies WHERE id=? AND site_id=?');
    for(const row of [...(Array.isArray(doc.details.items)?doc.details.items:[doc.details]),...(doc.details.musculoskeletalItems||[])])if(row.contractorId){const company=find.get(row.contractorId,doc.siteId);if(!company)throw new Error('같은 현장의 협력사를 선택해 주세요.');row.contractor=company.name;}
  }
  validatePlanEquipment(doc) {
    if(doc.type!=='work_plan')return;
    if(doc.details.workers){const get=this.db.prepare('SELECT name,company FROM workers WHERE id=? AND site_id=?');doc.details.workers=doc.details.workers.map(row=>{const worker=get.get(row.workerId,doc.siteId);if(!worker)throw new Error('같은 현장의 작업자를 선택해 주세요.');return {...row,name:worker.name,company:worker.company};});}
    const exists=this.db.prepare('SELECT 1 FROM equipment WHERE id=? AND site_id=?');
    if((doc.details.equipmentIds||[]).some(id=>!exists.get(id,doc.siteId)))throw new Error('같은 현장의 장비를 선택해 주세요.');
    if(doc.details.equipmentAssignments){const equipment=this.db.prepare('SELECT kind,model,registration FROM equipment WHERE id=? AND site_id=?'),worker=this.db.prepare('SELECT name,company FROM workers WHERE id=? AND site_id=?');doc.details.equipmentAssignments=doc.details.equipmentAssignments.map(row=>{const item=equipment.get(row.equipmentId,doc.siteId),driver=worker.get(row.workerId,doc.siteId);if(!item||!driver||!(doc.details.equipmentIds||[]).includes(row.equipmentId))throw new Error('계획서에 선택된 같은 현장의 장비와 운전원을 확인해 주세요.');return {...row,equipmentLabel:[item.kind,item.model,item.registration].filter(Boolean).join(' · '),driverName:driver.name,driverCompany:driver.company};});}
    if(doc.details.safetyMeasures){const equipment=this.db.prepare('SELECT kind,model,registration FROM equipment WHERE id=? AND site_id=?');doc.details.safetyMeasures=doc.details.safetyMeasures.map(row=>{if(!row.equipmentId)return row;const item=equipment.get(row.equipmentId,doc.siteId);if(!item||!(doc.details.equipmentIds||[]).includes(row.equipmentId))throw new Error('안전대책에 연결할 같은 현장의 선택된 장비를 확인해 주세요.');return {...row,equipmentLabel:[item.kind,item.model,item.registration].filter(Boolean).join(' · ')};});}
    if(doc.details.workPlaceId && !this.db.prepare('SELECT 1 FROM work_places WHERE id=? AND site_id=?').get(doc.details.workPlaceId,doc.siteId))throw new Error('같은 현장의 작업장소를 선택해 주세요.');
    const rigging=this.db.prepare('SELECT 1 FROM rigging WHERE id=? AND site_id=?');
    if((doc.details.riggingIds||[]).some(id=>!rigging.get(id,doc.siteId)))throw new Error('같은 현장의 장구를 선택해 주세요.');
    const riggingName=this.db.prepare('SELECT name FROM rigging WHERE id=? AND site_id=?');
    for(const load of doc.details.heavyLoads||[])if(load.liftMode==='rigging'){const item=riggingName.get(load.riggingId,doc.siteId);if(!item||!(doc.details.riggingIds||[]).includes(load.riggingId))throw new Error('계획서에 선택된 같은 현장의 장구를 사용해 주세요.');load.riggingName=item.name;}
  }
  validateSafetyMeeting(doc,current=null){
    if(!['safety_meeting','work_council','joint_inspection'].includes(doc.type))return;
    const previous=current&&current.date===doc.date?JSON.parse(current.details).workerSnapshot||[]:[],attendance=this.attendance(doc.siteId,doc.date);
    doc.details.workerSnapshot=doc.details.workerIds.map(id=>{const old=previous.find(row=>row.id===id),worker=attendance.find(row=>row.id===id&&row.present);if(old)return old;if(!worker)throw new Error('같은 현장의 해당 날짜 출역자를 선택해 주세요.');return {id:worker.id,name:worker.name,company:worker.company,occupation:worker.occupation};});
    {
      const prior=current?JSON.parse(current.details).managerSnapshot||[]:[],ids=doc.details.managerIds??prior.map(row=>row.id),lookup=this.db.prepare("SELECT id,name,company,occupation FROM workers WHERE id=? AND site_id=? AND category='현장관리자'");
      if(ids.some(id=>doc.details.workerIds.includes(id)))throw new Error('관리자와 근로자를 중복 선택할 수 없습니다.');
      doc.details.managerIds=ids;doc.details.managerSnapshot=ids.map(id=>{const old=prior.find(row=>row.id===id),manager=lookup.get(id,doc.siteId);if(old)return old;if(!manager)throw new Error('같은 현장의 가상 현장관리자를 선택해 주세요.');return manager;});
    }
  }
  validateInstructionRecipient(doc){
    if(doc.type!=='instruction')return;
    if(!doc.details.companyId){if(doc.details.recipientId)throw new Error('수신 협력사를 먼저 선택해 주세요.');return;}
    const company=this.db.prepare('SELECT name,trade FROM companies WHERE id=? AND site_id=?').get(doc.details.companyId,doc.siteId);
    if(!company)throw new Error('같은 현장의 협력사를 선택해 주세요.');
    doc.details.companyName=company.name;doc.details.companyTrade=company.trade;
    if(doc.details.recipientId){const worker=this.db.prepare('SELECT name FROM workers WHERE id=? AND site_id=? AND company=?').get(doc.details.recipientId,doc.siteId,company.name);if(!worker)throw new Error('선택한 현장과 협력사의 담당자를 확인해 주세요.');doc.details.recipient=worker.name;}
  }
  transition(id, action, opinion='', signature=null,reviewerId=null) {
    const doc = this.document(id);
    if (!doc) throw new Error('문서를 찾을 수 없습니다.');
    let next = transitions[doc.status]?.[action];
    if (!next) throw new Error('현재 상태에서 수행할 수 없는 작업입니다.');
    const line=this.approvalLine(id),current=line.find(step=>step.state==='pending');let reviewer=null;
    if(line.length&&['approve','reject'].includes(action)){
      if(!reviewerId||!current||current.reviewer_id!==reviewerId||!current.active)throw new Error('현재 차례의 결재자를 확인해 주세요.');
      if(action==='approve'&&!this.approvalCycle(doc.id,doc.approval_cycle_id))throw new Error('이전 요청의 자료가 보존되지 않았습니다. 관리자에게 요청 취소 후 다시 요청하도록 알려 주세요.');
      reviewer=current;if(action==='approve'&&line.some(step=>step.position>current.position))next='pending';
    }else if(reviewerId)throw new Error('현재 차례의 결재자를 확인해 주세요.');
    if(action==='submit'&&line.some(step=>!step.active))throw new Error('활성 결재자를 확인해 주세요.');
    if(doc.type==='checklist'&&action==='submit'){const details=JSON.parse(doc.details),required={rain:[0,1,2,3,4,5,6],wind:[0,1,2,3,4,5,6,7,8],thaw:Array.from({length:15},(_,i)=>i),heat:Array.from({length:8},(_,i)=>i),cold:Array.from({length:10},(_,i)=>i),wet_season:Array.from({length:6},(_,i)=>i),heavy_rain:Array.from({length:11},(_,i)=>i),electrical:Array.from({length:12},(_,i)=>i),fire:Array.from({length:5},(_,i)=>i),formwork:Array.from({length:7},(_,i)=>i),falling:Array.from({length:8},(_,i)=>i),confined:Array.from({length:4},(_,i)=>i),excavation:Array.from({length:8},(_,i)=>i),semiannual:Array.from({length:11},(_,i)=>i),morning:[0,1,2,3,4,6],afternoon:[0,1,2,3,4,5],evening:[0,1,2,3,4,5,6,7,8]}[details.kind]||[];if(required.some(i=>!details.answers[i].answer))throw new Error('필수 체크리스트 답변을 모두 선택해 주세요.');}
    if(typeof opinion!=='string' || opinion.length>2000)throw new Error('검토 의견을 확인해 주세요.');
    opinion=opinion.trim();
    if(doc.type==='risk' && action==='reject' && !opinion)throw new Error('반려 의견을 입력해 주세요.');
    let cycleId=doc.approval_cycle_id||null;this.db.exec('SAVEPOINT document_transition');
    try {
      if(doc.type==='office'&&action==='submit'){
        this.db.prepare('UPDATE documents SET id=id WHERE id=?').run(Number(id));const currentDoc=this.document(id),currentLine=this.approvalLine(id);
        if(!currentDoc||['status','title','date','body','details'].some(key=>currentDoc[key]!==doc[key])||JSON.stringify(currentLine)!==JSON.stringify(line))throw new Error('문서 또는 결재선이 변경되었습니다. 다시 확인해 주세요.');
        if(!currentLine.length||currentLine.some(step=>!step.active)||this.officeReferences(id).some(person=>!person.active)||!this.meetingSignature(id))throw new Error('시험 결재자·참조자와 작성자 서명을 확인해 주세요.');
      }
      if(doc.type==='basic'&&action==='submit'){
        this.db.prepare('UPDATE basic_document_versions SET version=version WHERE document_id=?').run(doc.id);
        const current=this.document(id);if(!current||current.basic_version!==doc.basic_version)throw new Error('기본 서류가 변경되었습니다. 다시 조회해 주세요.');
        const details=JSON.parse(current.details);if(typeof details.category!=='string'||!details.category.trim())throw new Error('기본 서류 분류를 입력해 주세요.');
        if(!this.attachments(id).length)throw new Error('기본 서류에 첨부파일을 추가해 주세요.');
      }
      if(action==='submit'&&line.length)this.db.prepare("UPDATE approval_steps SET state='pending' WHERE document_id=?").run(Number(id));
      if(reviewer)this.db.prepare('UPDATE approval_steps SET state=? WHERE document_id=? AND position=?').run(action==='approve'?'approved':'rejected',Number(id),reviewer.position);
      if(doc.type==='work_plan'&&action==='submit'){
        const details=JSON.parse(doc.details),get=this.db.prepare('SELECT id,kind,model,capacity,manufacturer,registration,details FROM equipment WHERE id=? AND site_id=?');
        if(details.equipmentIds!==undefined){details.equipmentSnapshot=details.equipmentIds.map(equipmentId=>{const item=get.get(equipmentId,doc.site_id);if(!item)throw new Error('같은 현장의 장비를 확인해 주세요.');return item;});this.db.prepare('UPDATE documents SET details=? WHERE id=?').run(JSON.stringify(details),Number(id));}
      }
      if(action==='submit')cycleId=this.captureApprovalCycle(this.document(id));
      this.db.prepare('UPDATE documents SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next, Number(id));
      this.db.prepare('INSERT INTO events(document_id,action,from_status,to_status,opinion,signature,reviewer_id,reviewer_name,approval_cycle_id) VALUES(?,?,?,?,?,?,?,?,?)').run(Number(id),action,doc.status,next,opinion,signature,reviewer?.reviewer_id||null,reviewer?.name||null,cycleId);
      this.db.exec('RELEASE document_transition');
    } catch (err) { this.db.exec('ROLLBACK TO document_transition');this.db.exec('RELEASE document_transition');throw err; }
    return this.document(id);
  }
  publishNotice(id){
    const doc=this.document(id);
    if(!doc||doc.type!=='notice'||doc.status!=='draft')throw new Error('임시저장된 공지를 확인해 주세요.');
    if(this.approvalLine(id).length)throw new Error('지정된 시험 결재선을 먼저 해제해 주세요.');
    if(!doc.body.trim())throw new Error('공지 내용을 입력해 주세요.');
    this.db.exec('SAVEPOINT publish_notice');
    try{this.db.prepare("UPDATE documents SET status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);this.db.prepare("INSERT INTO events(document_id,action,from_status,to_status) VALUES(?,'publish','draft','approved')").run(doc.id);this.db.exec('RELEASE publish_notice');}catch(error){this.db.exec('ROLLBACK TO publish_notice');this.db.exec('RELEASE publish_notice');throw error;}
    return this.document(id);
  }
  approveDocument(id,opinion,signature){return this.transition(id,'approve',opinion,signatureBytes(signature));}
  reviewerTransition(id,reviewerId,action,opinion,signature,onAuthorize=null){this.db.exec('BEGIN IMMEDIATE');try{if(onAuthorize)onAuthorize();if(!['approve','reject'].includes(action)||!this.reviewerDocument(reviewerId,id))throw new Error('현재 차례의 결재자를 확인해 주세요.');const result=this.transition(id,action,opinion,action==='approve'?signatureBytes(signature):null,Number(reviewerId));this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  approveDocuments(siteId,ids,signature){
    if(!Number.isSafeInteger(siteId)||siteId<1||!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw new Error('선택한 시험 문서를 확인해 주세요.');
    const bytes=signatureBytes(signature);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const id of ids){const doc=this.document(id);if(!doc||doc.site_id!==siteId||doc.status!=='pending')throw new Error('선택한 현장의 결재 대기 문서를 확인해 주세요.');}
      for(const id of ids)this.transition(id,'approve','',bytes);
      this.db.exec('COMMIT');
    }catch(err){this.db.exec('ROLLBACK');throw err;}
    return {approved:ids.length};
  }
  events(id) { return this.db.prepare('SELECT id,document_id,action,from_status,to_status,created_at,opinion,reviewer_id,reviewer_name,approval_cycle_id,signature IS NOT NULL AS has_signature FROM events WHERE document_id=? ORDER BY id').all(Number(id)); }
  eventSignature(id,eventId){return this.db.prepare('SELECT signature FROM events WHERE document_id=? AND id=? AND signature IS NOT NULL').get(Number(id),Number(eventId))?.signature||null;}
}
