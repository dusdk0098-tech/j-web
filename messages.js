import { text } from './domain.js';

export class Messages {
  constructor(db){
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),sender_id INTEGER NOT NULL REFERENCES reviewers(id),recipient_id INTEGER NOT NULL REFERENCES reviewers(id),sender_name TEXT NOT NULL,recipient_name TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,read_at TEXT,sender_hidden INTEGER NOT NULL DEFAULT 0,recipient_hidden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS messages_sender ON messages(site_id,sender_id,id);
      CREATE INDEX IF NOT EXISTS messages_recipient ON messages(site_id,recipient_id,id);
      CREATE TABLE IF NOT EXISTS message_files (id INTEGER PRIMARY KEY,message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,name TEXT NOT NULL,data BLOB NOT NULL);`);
  }
  transaction(fn,onAuthorize){this.db.exec('BEGIN IMMEDIATE');try{onAuthorize();const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  account(actor){const row=this.db.prepare('SELECT id,site_id,name FROM reviewers WHERE id=? AND site_id=? AND active=1').get(Number(actor.id),Number(actor.site_id));if(!row)throw Error('활성 시험 계정을 확인해 주세요.');return row;}
  recipients(actor){const account=this.account(actor);return this.db.prepare('SELECT id,name FROM reviewers WHERE site_id=? AND active=1 AND id<>? ORDER BY name,id').all(account.site_id,account.id);}
  list(actor,box,query=''){
    if(!['inbox','sent'].includes(box)||typeof query!=='string'||query.length>200)throw Error('쪽지 검색 조건을 확인해 주세요.');const account=this.account(actor),condition=box==='inbox'?'recipient_id=? AND recipient_hidden=0':'sender_id=? AND sender_hidden=0';
    return this.db.prepare(`SELECT id,sender_name,recipient_name,title,created_at,read_at,(SELECT COUNT(*) FROM message_files f WHERE f.message_id=messages.id) AS file_count FROM messages WHERE site_id=? AND ${condition} AND (instr(title,?)>0 OR instr(body,?)>0) ORDER BY id DESC`).all(account.site_id,account.id,query,query);
  }
  get(actor,id){
    const account=this.account(actor),row=this.db.prepare('SELECT id,sender_id,recipient_id,sender_name,recipient_name,title,body,created_at,read_at FROM messages WHERE id=? AND site_id=? AND ((sender_id=? AND sender_hidden=0) OR (recipient_id=? AND recipient_hidden=0))').get(Number(id),account.site_id,account.id,account.id);if(!row)return null;
    const files=this.db.prepare('SELECT id,name,length(data) AS size FROM message_files WHERE message_id=? ORDER BY id').all(row.id);return {...row,files};
  }
  send(actor,input,onAuthorize=()=>{}){
    if(!input||typeof input!=='object'||!Number.isSafeInteger(input.recipientId)||input.recipientId<1||!Array.isArray(input.files)||input.files.length>5)throw Error('쪽지와 수신자를 확인해 주세요.');
    const title=text(input.title,'제목'),body=text(input.body,'내용',10000),files=input.files.map(file=>{if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>200||/[\\/\x00-\x1f\x7f]/.test(file.name)||typeof file.data!=='string'||file.data.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(file.data))throw Error('첨부파일을 확인해 주세요.');const bytes=Buffer.from(file.data,'base64');if(!bytes.length||bytes.length>1024*1024||bytes.toString('base64')!==file.data)throw Error('첨부파일은 1MB 이하여야 합니다.');return {name:file.name,data:bytes};});
    return this.transaction(()=>{const sender=this.account(actor),recipient=this.db.prepare('SELECT id,name FROM reviewers WHERE id=? AND site_id=? AND active=1 AND id<>?').get(input.recipientId,sender.site_id,sender.id);if(!recipient)throw Error('같은 현장의 활성 시험 수신자를 선택해 주세요.');const id=this.db.prepare('INSERT INTO messages(site_id,sender_id,recipient_id,sender_name,recipient_name,title,body) VALUES(?,?,?,?,?,?,?)').run(sender.site_id,sender.id,recipient.id,sender.name,recipient.name,title,body).lastInsertRowid,add=this.db.prepare('INSERT INTO message_files(message_id,name,data) VALUES(?,?,?)');for(const file of files)add.run(id,file.name,file.data);return {id};},onAuthorize);
  }
  read(actor,id,onAuthorize=()=>{}){return this.transaction(()=>{const account=this.account(actor),row=this.db.prepare('SELECT id FROM messages WHERE id=? AND site_id=? AND recipient_id=? AND recipient_hidden=0').get(Number(id),account.site_id,account.id);if(!row)throw Error('받은 쪽지를 확인해 주세요.');this.db.prepare("UPDATE messages SET read_at=COALESCE(read_at,strftime('%Y-%m-%d %H:%M:%S','now')) WHERE id=?").run(row.id);return this.get(actor,row.id);},onAuthorize);}
  remove(actor,id,onAuthorize=()=>{}){return this.transaction(()=>{const account=this.account(actor),row=this.db.prepare('SELECT id,sender_id,recipient_id,sender_hidden,recipient_hidden FROM messages WHERE id=? AND site_id=?').get(Number(id),account.site_id);if(!row)throw Error('쪽지를 확인해 주세요.');if(row.sender_id===account.id&&!row.sender_hidden)this.db.prepare('UPDATE messages SET sender_hidden=1 WHERE id=?').run(row.id);else if(row.recipient_id===account.id&&!row.recipient_hidden)this.db.prepare('UPDATE messages SET recipient_hidden=1 WHERE id=?').run(row.id);else throw Error('쪽지를 확인해 주세요.');this.db.prepare('DELETE FROM messages WHERE id=? AND sender_hidden=1 AND recipient_hidden=1').run(row.id);},onAuthorize);}
  file(actor,id,fileId){if(!this.get(actor,id))return null;return this.db.prepare('SELECT name,data FROM message_files WHERE message_id=? AND id=?').get(Number(id),Number(fileId))||null;}
}
