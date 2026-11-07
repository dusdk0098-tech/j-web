import {customQuestions,customChecklistDetails,requireCustomChecklist} from './public/custom-checklist.js';
const conflict=()=>Object.assign(Error('양식이 변경되었습니다. 입력을 복사한 뒤 다시 조회해 주세요.'),{sessionStatus:409});
export class CustomChecklists {
  constructor(db){this.db=db;db.exec('CREATE TABLE IF NOT EXISTS checklist_templates(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,category TEXT NOT NULL,questions TEXT NOT NULL,site_ids TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1,submitted INTEGER NOT NULL DEFAULT 0 CHECK(submitted IN (0,1)))');}
  list(){return this.db.prepare('SELECT * FROM checklist_templates ORDER BY category,title,id').all().map(row=>({...row,active:!!row.active,submitted:!!row.submitted,questions:JSON.parse(row.questions),siteIds:JSON.parse(row.site_ids)}));}
  get(id){return this.list().find(row=>row.id===Number(id))||null;}
  save(id,input,onAuthorize=()=>{}){
    if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>200||typeof input.category!=='string'||!input.category.trim()||input.category.trim().length>200||typeof input.active!=='boolean'||!Array.isArray(input.siteIds)||input.siteIds.length>1000||input.siteIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(input.siteIds).size!==input.siteIds.length)throw Error('제목·분류·사용 여부와 적용 현장을 확인해 주세요.');
    const questions=customQuestions(input.questions),siteIds=[...input.siteIds].sort((a,b)=>a-b);this.db.exec('BEGIN IMMEDIATE');try{onAuthorize();const exists=this.db.prepare('SELECT 1 FROM sites WHERE id=?');if(siteIds.some(id=>!exists.get(id)))throw Error('등록된 적용 현장을 선택해 주세요.');
      if(id!==null){const previous=this.get(id);if(!previous||input.expectedVersion!==previous.version)throw conflict();if(previous.submitted&&JSON.stringify(previous.questions)!==JSON.stringify(questions))throw Error('제출 이력이 있는 양식의 문항은 변경할 수 없습니다. 새 양식을 만드세요.');this.db.prepare('UPDATE checklist_templates SET title=?,category=?,questions=?,site_ids=?,active=?,version=version+1 WHERE id=?').run(input.title.trim(),input.category.trim(),JSON.stringify(questions),JSON.stringify(siteIds),input.active?1:0,Number(id));}
      else id=Number(this.db.prepare('INSERT INTO checklist_templates(title,category,questions,site_ids,active) VALUES(?,?,?,?,?)').run(input.title.trim(),input.category.trim(),JSON.stringify(questions),JSON.stringify(siteIds),input.active?1:0).lastInsertRowid);
      const result=this.get(id);this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  remove(id,expectedVersion,onAuthorize=()=>{}){this.db.exec('BEGIN IMMEDIATE');try{onAuthorize();const row=this.get(id);if(!row||row.version!==expectedVersion)throw conflict();if(row.submitted||this.db.prepare("SELECT 1 FROM documents WHERE type='checklist' AND json_extract(details,'$.kind')='custom' AND json_extract(details,'$.template.id')=? LIMIT 1").get(Number(id)))throw Error('사용된 양식은 삭제할 수 없습니다. 사용 중지로 전환하세요.');this.db.prepare('DELETE FROM checklist_templates WHERE id=?').run(Number(id));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
  prepare(input,current=null){
    const previous=current?.type==='checklist'?JSON.parse(current.details):null,value=input?.details;if(previous?.kind==='custom'&&(input.type!=='checklist'||value?.kind!=='custom'))throw Error('사용자 정의 문항을 보존하려면 양식을 유지해 주세요.');if(input?.type!=='checklist'||value?.kind!=='custom')return input;
    const id=previous?.kind==='custom'?previous.template.id:value.templateId,definition=this.get(id);if(!definition||!definition.active||!definition.siteIds.includes(Number(input.siteId)))throw Error('현재 현장에 적용된 사용 중 양식을 선택해 주세요.');
    let snapshot;if(previous?.kind==='custom'){if(value.templateId!==previous.template.id||value.templateVersion!==previous.template.version)throw conflict();snapshot=previous.template;}else{if(value.templateVersion!==definition.version)throw conflict();snapshot={id:definition.id,version:definition.version,title:definition.title,category:definition.category,questions:definition.questions};}
    const details=customChecklistDetails({template:snapshot,answers:value.answers});const attached=new Set(current?this.db.prepare('SELECT id FROM attachments WHERE document_id=?').all(current.id).map(file=>file.id):[]);if(details.answers.some(answer=>answer.files.some(id=>!attached.has(id))))throw Error('이 문서에 저장된 첨부파일만 연결할 수 있습니다.');return {...input,details};
  }
  submit(doc){const details=JSON.parse(doc.details);if(doc.type!=='checklist'||details.kind!=='custom')return;
    this.db.prepare('UPDATE checklist_templates SET submitted=1 WHERE id=?').run(details.template.id);
    const latest=this.db.prepare('SELECT details,status,edit_version FROM documents WHERE id=?').get(doc.id);
    if(!latest||latest.details!==doc.details||latest.status!==doc.status||latest.edit_version!==doc.edit_version)throw conflict();
    const definition=this.get(details.template.id);
    if(!definition||!definition.active||!definition.siteIds.includes(doc.site_id))throw Error('현재 현장에 적용된 양식이 아닙니다.');
    requireCustomChecklist(details,this.db.prepare('SELECT id FROM attachments WHERE document_id=?').all(doc.id));
    if(!this.db.prepare('SELECT 1 FROM checklist_signatures WHERE document_id=?').get(doc.id))throw Error('필수 문항과 작성자 서명을 저장한 뒤 결재를 요청하세요.');
  }
}
