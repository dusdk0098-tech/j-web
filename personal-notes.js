import { dateValue, text } from './domain.js';

export class PersonalNotes {
  constructor(db){
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS personal_notes (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),date TEXT NOT NULL,content TEXT NOT NULL,private INTEGER NOT NULL CHECK(private IN (0,1)),checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1)),version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS personal_notes_site_date ON personal_notes(site_id,date,id);
      CREATE TABLE IF NOT EXISTS personal_note_files (id INTEGER PRIMARY KEY,note_id INTEGER NOT NULL REFERENCES personal_notes(id) ON DELETE CASCADE,name TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  }
  site(id){id=Number(id);if(!Number.isSafeInteger(id)||id<1||!this.db.prepare('SELECT 1 FROM sites WHERE id=?').get(id))throw Error('현장을 확인해 주세요.');return id;}
  get(siteId,id){return this.db.prepare('SELECT id,site_id,date,content,private,checked,version,created_at FROM personal_notes WHERE site_id=? AND id=?').get(Number(siteId),Number(id))||null;}
  files(siteId,id){if(!this.get(siteId,id))throw Error('개인업무 기록을 확인해 주세요.');return this.db.prepare('SELECT id,name,length(data) AS size FROM personal_note_files WHERE note_id=? ORDER BY id').all(Number(id));}
  list(siteId,from='',to='',query=''){
    siteId=this.site(siteId);if(from)from=dateValue(from);if(to)to=dateValue(to);if(from&&to&&from>to)throw Error('조회 기간을 확인해 주세요.');if(typeof query!=='string'||query.length>200)throw Error('검색어를 확인해 주세요.');
    return this.db.prepare("SELECT id,site_id,date,content,private,checked,version,created_at FROM personal_notes WHERE site_id=? AND (?='' OR date>=?) AND (?='' OR date<=?) AND instr(content,?)>0 ORDER BY date DESC,id DESC").all(siteId,from,from,to,to,query).map(note=>({...note,files:this.files(siteId,note.id)}));
  }
  transaction(callback,onAuthorize){this.db.exec('BEGIN IMMEDIATE');try{onAuthorize();const value=callback();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  editable(siteId,id,version){const note=this.get(siteId,id);if(!note)throw Error('개인업무 기록을 확인해 주세요.');if(note.checked)throw Error('확인된 시험 기록은 수정하거나 삭제할 수 없습니다.');if(typeof version!=='string'||version!==note.version)throw Object.assign(Error('기록이 변경되었습니다. 다시 조회해 주세요.'),{sessionStatus:409});return note;}
  create(input,onAuthorize=()=>{}){
    const siteId=this.site(input.siteId),date=dateValue(input.date),content=text(input.content,'내용',10000);if(typeof input.private!=='boolean')throw Error('비공개 표시를 확인해 주세요.');
    return this.transaction(()=>{const id=this.db.prepare('INSERT INTO personal_notes(site_id,date,content,private,version) VALUES(?,?,?,?,lower(hex(randomblob(16))))').run(siteId,date,content,input.private?1:0).lastInsertRowid;return this.get(siteId,id);},onAuthorize);
  }
  update(siteId,id,input,onAuthorize=()=>{}){
    siteId=this.site(siteId);const date=dateValue(input.date),content=text(input.content,'내용',10000);if(typeof input.private!=='boolean')throw Error('비공개 표시를 확인해 주세요.');
    return this.transaction(()=>{this.editable(siteId,id,input.version);this.db.prepare('UPDATE personal_notes SET date=?,content=?,private=?,version=lower(hex(randomblob(16))) WHERE site_id=? AND id=?').run(date,content,input.private?1:0,siteId,Number(id));return this.get(siteId,id);},onAuthorize);
  }
  check(siteId,id,version,onAuthorize=()=>{}){siteId=this.site(siteId);return this.transaction(()=>{this.editable(siteId,id,version);this.db.prepare('UPDATE personal_notes SET checked=1,version=lower(hex(randomblob(16))) WHERE site_id=? AND id=?').run(siteId,Number(id));return this.get(siteId,id);},onAuthorize);}
  remove(siteId,id,version,onAuthorize=()=>{}){siteId=this.site(siteId);return this.transaction(()=>{this.editable(siteId,id,version);this.db.prepare('DELETE FROM personal_notes WHERE site_id=? AND id=?').run(siteId,Number(id));},onAuthorize);}
  addFile(siteId,id,version,name,data,onAuthorize=()=>{}){
    siteId=this.site(siteId);if(typeof name!=='string'||!name.trim()||name.length>200||/[\\\\/\x00-\x1f\x7f]/.test(name))throw Error('파일 이름을 확인해 주세요.');if(!(data instanceof Uint8Array)||!data.length||data.length>2*1024*1024)throw Error('파일은 1바이트 이상 2MB 이하여야 합니다.');
    return this.transaction(()=>{this.editable(siteId,id,version);if(this.files(siteId,id).length>=20)throw Error('첨부파일은 20개까지 가능합니다.');const fileId=this.db.prepare('INSERT INTO personal_note_files(note_id,name,data) VALUES(?,?,?)').run(Number(id),name,Buffer.from(data)).lastInsertRowid;this.db.prepare('UPDATE personal_notes SET version=lower(hex(randomblob(16))) WHERE site_id=? AND id=?').run(siteId,Number(id));return {id:fileId};},onAuthorize);
  }
  file(siteId,id,fileId){return this.db.prepare('SELECT f.name,f.data FROM personal_note_files f JOIN personal_notes n ON n.id=f.note_id WHERE n.site_id=? AND n.id=? AND f.id=?').get(Number(siteId),Number(id),Number(fileId))||null;}
  removeFile(siteId,id,fileId,version,onAuthorize=()=>{}){siteId=this.site(siteId);return this.transaction(()=>{this.editable(siteId,id,version);if(!this.db.prepare('DELETE FROM personal_note_files WHERE note_id=? AND id=?').run(Number(id),Number(fileId)).changes)throw Error('첨부파일을 찾을 수 없습니다.');this.db.prepare('UPDATE personal_notes SET version=lower(hex(randomblob(16))) WHERE site_id=? AND id=?').run(siteId,Number(id));},onAuthorize);}
}
