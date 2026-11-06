import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,actor={id:1,name:'가상 관리자'},requestId='00000000-0000-4000-8000-000000000001';
function setup(path=':memory:'){
 const s=new Store(path),site=s.createSite({name:'가상 현장'}),make=name=>s.createWorker({siteId:site.id,name,category:'직영',company:'가상',occupation:'가상'}),source=make('오기입'),target=make('정상'),date='2026-11-01',restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),params={siteId:site.id,sourceId:source.id,targetId:target.id,date};
 s.setAttendance({siteId:site.id,workerId:source.id,date,present:true});s.setAttendanceUnits({siteId:site.id,workerId:source.id,date,units:'1.25'});s.saveMealCheck({siteId:site.id,workerId:source.id,date,kind:'lunch',restaurantId:restaurant.id});
 s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(source.id,date,Buffer.from('점검 서명'),'[]');s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)').run(source.id,date,'tbm',Buffer.from('교육 서명'));s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)').run(source.id,'2026-11-02','tbm',Buffer.from('다음 날'));
 const notice=s.createDocument({siteId:site.id,type:'notice',date,title:'공지'}),education=s.createDocument({siteId:site.id,type:'education',date,title:'교육'}),edit=s.db.prepare('INSERT INTO notice_edits(document_id,previous_title,previous_body) VALUES(?,?,?)').run(notice.id,'이전','내용').lastInsertRowid;
 s.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id,signature) VALUES(?,?,?)').run(source.id,notice.id,Buffer.from('공지 서명'));s.db.prepare('INSERT INTO notice_edit_reads(edit_id,worker_id,read_at,signature) VALUES(?,?,?,?)').run(edit,source.id,'가상',Buffer.from('이전 공지 서명'));s.db.prepare('INSERT INTO worker_training_checks(worker_id,document_id,signature) VALUES(?,?,?)').run(source.id,education.id,Buffer.from('확인 서명'));s.db.prepare('INSERT INTO training_target_config(document_id) VALUES(?)').run(education.id);s.db.prepare('INSERT INTO training_targets(document_id,worker_id) VALUES(?,?)').run(education.id,source.id);
 return {s,site,source,target,date,notice,education,edit,params};
}

test('전환은 모든 날짜별 기록을 원자적으로 옮기고 서명 출처와 버전을 보존한다',()=>{
 const {s,site,source,target,date,notice,education,edit,params}=setup();try{const preview=s.previewWorkerTransfer(params),input={...params,version:preview.version,requestId,signature},before=s.attendance(site.id,date).find(row=>row.id===source.id).day_version,result=s.executeWorkerTransfer(input,actor);assert.ok(result.id>0);assert.equal(s.executeWorkerTransfer(input,actor).id,result.id);assert.throws(()=>s.executeWorkerTransfer({...input,targetId:source.id},actor),/이전 전환/);
  const rows=s.attendance(site.id,date),old=rows.find(row=>row.id===source.id),current=rows.find(row=>row.id===target.id);assert.equal(old.present,0);assert.ok(old.day_version>before);assert.equal(current.present,1);assert.equal(current.units_hundredths,125);assert.throws(()=>s.changeAttendance('presence',{siteId:site.id,workerId:source.id,date,present:true,expectedDayVersion:before}),error=>error.sessionStatus===409);
  assert.equal(s.db.prepare('SELECT worker_id FROM meal_checks WHERE date=?').get(date).worker_id,target.id);assert.equal(Buffer.from(s.db.prepare('SELECT signature FROM worker_self_checks WHERE worker_id=? AND date=?').get(target.id,date).signature).toString(),'점검 서명');assert.equal(Buffer.from(s.db.prepare('SELECT signature FROM worker_training_checks WHERE worker_id=? AND document_id=?').get(target.id,education.id).signature).toString(),'확인 서명');assert.equal(s.db.prepare('SELECT worker_id FROM worker_notice_reads WHERE document_id=?').get(notice.id).worker_id,target.id);assert.equal(s.db.prepare('SELECT worker_id FROM notice_edit_reads WHERE edit_id=?').get(edit).worker_id,target.id);assert.equal(s.db.prepare('SELECT worker_id FROM worker_daily_training WHERE date=?').get('2026-11-02').worker_id,source.id);
  assert.ok(s.db.prepare('SELECT 1 FROM training_targets WHERE document_id=? AND worker_id=?').get(education.id,target.id));assert.ok(s.db.prepare('SELECT 1 FROM training_targets WHERE document_id=? AND worker_id=?').get(education.id,source.id));const provenance=s.db.prepare('SELECT * FROM worker_transfer_provenance WHERE worker_id=?').all(target.id);assert.equal(provenance.length,6);assert.ok(provenance.every(row=>row.original_worker_id===source.id&&row.original_name==='오기입'));const event=s.db.prepare('SELECT * FROM worker_transfer_events WHERE id=?').get(result.id);assert.equal(event.target_name,'정상');assert.deepEqual(Buffer.from(event.signature),PNG.sync.write(png));
 }finally{s.close();}
});

test('충돌, 미리보기 이후 변경, 권한 회수, 중간 저장 오류는 전체 전환을 취소한다',()=>{
 for(const scenario of ['collision','stale','revoked','failure']){const {s,site,source,target,date,params}=setup();try{
  if(scenario==='collision')s.setAttendance({siteId:site.id,workerId:target.id,date,present:true});const preview=s.previewWorkerTransfer(params),input={...params,version:preview.version,requestId,signature};if(scenario==='stale')s.db.prepare('UPDATE worker_self_checks SET signature=? WHERE worker_id=? AND date=?').run(Buffer.from('변경'),source.id,date);if(scenario==='failure')s.db.exec("CREATE TRIGGER virtual_transfer_failure BEFORE INSERT ON worker_transfer_provenance BEGIN SELECT RAISE(ABORT,'가상 오류'); END");let calls=0;
  assert.throws(()=>s.executeWorkerTransfer(input,actor,()=>{if(scenario==='revoked'&&++calls===2)throw Error('권한 회수');}),scenario==='collision'?/같은 종류/:scenario==='stale'?/변경/:scenario==='revoked'?/권한 회수/:/가상 오류/);
  assert.equal(s.db.prepare('SELECT present FROM attendance WHERE worker_id=? AND date=?').get(source.id,date).present,1);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_transfer_events').get().n,0);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_transfer_evidence').get().n,0);assert.ok(s.db.prepare('SELECT 1 FROM worker_self_checks WHERE worker_id=? AND date=?').get(source.id,date));if(scenario!=='collision')assert.equal(s.db.prepare('SELECT 1 FROM attendance WHERE worker_id=? AND date=?').get(target.id,date),undefined);
 }finally{s.close();}}
});

test('다시 전환해도 최초 서명 출처와 이전 감사 기록을 유지한다',()=>{
 const {s,site,source,target,date,params}=setup();try{const third=s.createWorker({siteId:site.id,name:'최종 대상',category:'직영',company:'가상',occupation:'가상'}),first=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:first.version,requestId,signature},actor);const next={siteId:site.id,sourceId:target.id,targetId:third.id,date},second=s.previewWorkerTransfer(next);assert.deepEqual(second.conflicts,[]);s.executeWorkerTransfer({...next,version:second.version,requestId:'00000000-0000-4000-8000-000000000002',signature},actor);const origins=s.db.prepare('SELECT * FROM worker_transfer_provenance WHERE worker_id=?').all(third.id);assert.equal(origins.length,6);assert.ok(origins.every(row=>row.original_worker_id===source.id&&row.original_name==='오기입'));assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_transfer_events').get().n,2);assert.equal(Buffer.from(s.db.prepare('SELECT signature FROM worker_self_checks WHERE worker_id=? AND date=?').get(third.id,date).signature).toString(),'점검 서명');}finally{s.close();}
});

test('새 서명 또는 기록 삭제 뒤에는 이전 서명 출처를 새 기록에 붙이지 않는다',()=>{
 const {s,source,target,date,education,params}=setup();try{const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);assert.ok(s.db.prepare("SELECT 1 FROM worker_transfer_provenance WHERE kind='education' AND worker_id=?").get(target.id));s.db.prepare('UPDATE worker_training_checks SET signature=? WHERE worker_id=? AND document_id=?').run(Buffer.from('새 서명'),target.id,education.id);assert.equal(s.db.prepare("SELECT 1 FROM worker_transfer_provenance WHERE kind='education' AND worker_id=?").get(target.id),undefined);assert.ok(s.db.prepare("SELECT 1 FROM worker_transfer_provenance WHERE kind='selfChecks' AND worker_id=?").get(target.id));s.db.prepare('DELETE FROM worker_self_checks WHERE worker_id=? AND date=?').run(target.id,date);s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(target.id,date,Buffer.from('새 점검'),'[]');assert.equal(s.db.prepare("SELECT 1 FROM worker_transfer_provenance WHERE kind='selfChecks' AND worker_id=?").get(target.id),undefined);assert.equal(s.db.prepare('SELECT source_id FROM worker_transfer_events').get().source_id,source.id);const evidence=s.db.prepare("SELECT original_worker_id,signature FROM worker_transfer_evidence WHERE kind='selfChecks'").get();assert.equal(evidence.original_worker_id,source.id);assert.equal(Buffer.from(evidence.signature).toString(),'점검 서명');}finally{s.close();}
});

test('공지 내용이 바뀌어 이전 확인이 이력으로 이동해도 최초 서명 출처가 유지된다',()=>{
 const {s,source,target,notice,params}=setup();try{const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);const edit=s.db.prepare('INSERT INTO notice_edits(document_id,previous_title,previous_body) VALUES(?,?,?)').run(notice.id,'이전 내용','가상').lastInsertRowid;s.db.prepare('INSERT INTO notice_edit_reads(edit_id,worker_id,read_at,signature) SELECT ?,worker_id,read_at,signature FROM worker_notice_reads WHERE document_id=?').run(edit,notice.id);s.db.prepare('DELETE FROM worker_notice_reads WHERE document_id=?').run(notice.id);const history=s.db.prepare("SELECT * FROM worker_transfer_provenance WHERE kind='noticeHistory' AND record_key=? AND worker_id=?").get(JSON.stringify([Number(edit)]),target.id);assert.equal(history.original_worker_id,source.id);assert.equal(history.original_name,'오기입');assert.equal(s.db.prepare("SELECT 1 FROM worker_transfer_provenance WHERE kind='notices' AND worker_id=?").get(target.id),undefined);}finally{s.close();}
});

test('전환된 공지·교육·자가점검 조회는 원래 서명자를 함께 반환한다',()=>{
 const {s,site,source,target,date,notice,education,edit,params}=setup();try{const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);s.db.prepare("UPDATE documents SET status='approved' WHERE id IN (?,?)").run(notice.id,education.id);const origin=value=>{assert.equal(value?.transferOrigin?.workerId,source.id);assert.equal(value.transferOrigin.name,'오기입');};origin(s.noticeReads(notice.id)[0]);origin(s.noticeEditHistory(notice.id).find(row=>row.id===edit).reads[0]);origin(s.trainingChecks(education.id)[0]);origin(s.workerSelfCheck(target.id,date));origin(s.siteSelfChecks(site.id,date).find(row=>row.id===target.id));origin(s.sitePrintSelfChecks(site.id,date).find(row=>row.id===target.id));origin(s.dailyTraining(target.id,date)[0]);origin(s.workerTraining(target.id,date).find(row=>row.id===education.id));origin(s.workerNotices(target.id,date).find(row=>row.id===notice.id));const activities=s.workerActivities(site.id,target.id,[],0,date,date).items;for(const kind of ['notice','education','checklist','tbm'])origin(activities.find(row=>row.kind===kind));}finally{s.close();}
});

test('전환 당시 문서 내용을 보존하고 확인 후 변경된 문서는 전환하지 않는다',()=>{
 const {s,notice,education,params}=setup();try{
  s.db.prepare('UPDATE documents SET body=?,details=? WHERE id=?').run('가상 공지 본문','{"version":"가상"}',notice.id);
  const stale=s.previewWorkerTransfer(params);s.db.prepare('UPDATE documents SET body=? WHERE id=?').run('변경된 교육 본문',education.id);
  assert.throws(()=>s.executeWorkerTransfer({...params,version:stale.version,requestId,signature},actor),/변경/);
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  s.db.prepare('UPDATE documents SET body=? WHERE id=?').run('전환 후 변경',notice.id);
  const record=JSON.parse(s.db.prepare("SELECT record_json FROM worker_transfer_evidence WHERE kind='notices'").get().record_json);
  assert.equal(record.document_title,'공지');assert.equal(record.document_body,'가상 공지 본문');assert.equal(JSON.parse(record.document_details).version,'가상');
  const training=JSON.parse(s.db.prepare("SELECT record_json FROM worker_transfer_evidence WHERE kind='education'").get().record_json);assert.equal(training.document_body,'변경된 교육 본문');
 }finally{s.close();}
});

test('전환 기록의 원래 작성자는 교육 명단과 자가점검 출력에 안전하게 표시된다',async()=>{
 const {trainingRoster}=await import('../public/training-groups.js');
 const {dailyBatchReport}=await import('../public/batch-print.js');
 const {s,site,target,date,education,params}=setup();try{
  s.db.prepare('UPDATE workers SET name=? WHERE id=?').run('<가상 작성자>',params.sourceId);
  s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)').run(params.sourceId,date,'education',Buffer.from('가상 교육 서명'));
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  const person=trainingRoster(s.trainingTargets(education.id)).find(row=>row.id===target.id);
  assert.equal(person.transferOrigin.name,'<가상 작성자>');
  const row=s.sitePrintSelfChecks(site.id,date).find(item=>item.id===target.id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=dailyBatchReport({kind:'self-check',title:'자가점검',site,date,rows:[row]},esc);
  assert.match(html,/전환 전 기록자: &lt;가상 작성자&gt;/);assert.doesNotMatch(html,/<가상 작성자>/);
 }finally{s.close();}
});

test('교육 통계는 전환된 날짜와 문서별 최초 기록자를 구분한다',()=>{
 const {s,site,target,date,education,params}=setup();try{
  s.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(education.id);
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  const daily=s.dailyTrainingReport(site.id,date,date).find(row=>row.id===target.id&&row.kind==='tbm');
  assert.equal(daily.transferredRecords[0].date,date);assert.equal(daily.transferredRecords[0].transferOrigin.name,'오기입');
  const document=s.educationReport(site.id,date,date).find(row=>row.id===target.id).documents.find(row=>row.id===education.id);
  assert.equal(document.transferOrigin.name,'오기입');
 }finally{s.close();}
});

test('전환 감사 조회는 같은 현장만 허용하고 서명 원본을 노출하지 않는다',()=>{
 const {s,site,source,params}=setup();try{
  const other=s.createSite({name:'다른 가상 현장'}),preview=s.previewWorkerTransfer(params),event=s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  const audit=s.workerTransferAudit(site.id,event.id);assert.equal(audit.source_id,source.id);assert.equal(audit.actor_name,actor.name);assert.equal(audit.records.length,7);
  const notice=audit.records.find(row=>row.kind==='notices');assert.equal(notice.record.document_title,'공지');assert.equal(notice.has_signature,1);assert.equal(notice.signature,undefined);assert.ok(!JSON.stringify(audit).includes('공지 서명'));
  assert.deepEqual(s.workerTransferHistory(other.id,params.date),[]);assert.equal(s.workerTransferHistory(site.id,params.date)[0].id,event.id);assert.throws(()=>s.workerTransferHistory(site.id,'2026-02-30'),/날짜/);
  let historyCalls=0;assert.throws(()=>s.workerTransferHistory(site.id,params.date,()=>{if(++historyCalls===2)throw Error('권한 회수');}),/권한 회수/);
  assert.equal(s.workerTransferAudit(other.id,event.id),null);let calls=0;assert.throws(()=>s.workerTransferAudit(site.id,event.id,()=>{if(++calls===2)throw Error('권한 회수');}),/권한 회수/);
  assert.equal(s.workerTransferAudit(site.id,event.id).id,event.id);assert.throws(()=>s.workerTransferAudit(site.id,0),/확인/);
 }finally{s.close();}
});

test('전환 원본과 감사 기록은 데이터베이스 재시작 후에도 보존된다',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-transfer-reopen-')),path=join(dir,'jweb.sqlite');let s;
 try{
  const fixture=setup(path);s=fixture.s;const {site,source,target,date,params}=fixture,preview=s.previewWorkerTransfer(params),event=s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);s.close();s=null;
  s=new Store(path);assert.equal(s.attendance(site.id,date).find(row=>row.id===target.id).present,1);assert.equal(s.workerSelfCheck(target.id,date).transferOrigin.workerId,source.id);
  assert.equal(s.workerTransferHistory(site.id,date)[0].id,event.id);assert.equal(s.workerTransferAudit(site.id,event.id).source_id,source.id);
  assert.deepEqual(Buffer.from(s.workerTransferSignature(site.id,event.id,null,null)),PNG.sync.write(png));assert.equal(Buffer.from(s.workerTransferSignature(site.id,event.id,'selfChecks',JSON.stringify([date]))).toString(),'점검 서명');assert.equal(s.workerTransferSignature(site.id,event.id,'selfChecks','[\"다른 날짜\"]'),null);assert.throws(()=>s.workerTransferSignature(site.id,event.id,'잘못된 종류','[]'),/확인/);
  s.db.prepare('UPDATE worker_self_checks SET signature=? WHERE worker_id=? AND date=?').run(Buffer.from('새로운 시험 서명'),target.id,date);
  assert.equal(s.workerSelfCheck(target.id,date).transferOrigin,undefined);assert.equal(s.workerTransferAudit(site.id,event.id).records.find(row=>row.kind==='selfChecks').has_signature,1);
 }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('전환별 보존 서명은 다른 전환·현장과 섞이지 않고 권한 회수 시 반환하지 않는다',()=>{
 const {s,site,source,date,params}=setup();try{
  const first=s.previewWorkerTransfer(params),one=s.executeWorkerTransfer({...params,version:first.version,requestId,signature},actor),other=s.createSite({name:'다른 현장'});
  const make=name=>s.createWorker({siteId:site.id,name,category:'직영',company:'가상',occupation:'가상'}),from=make('다른 출발'),to=make('다른 대상');s.setAttendance({siteId:site.id,workerId:from.id,date,present:true});
  s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(from.id,date,Buffer.from('다른 기록 서명'),'{}');
  const second={siteId:site.id,sourceId:from.id,targetId:to.id,date},preview=s.previewWorkerTransfer(second),two=s.executeWorkerTransfer({...second,version:preview.version,requestId:'00000000-0000-4000-8000-000000000002',signature},actor),key=JSON.stringify([date]);
  assert.equal(Buffer.from(s.workerTransferSignature(site.id,one.id,'selfChecks',key)).toString(),'점검 서명');assert.equal(Buffer.from(s.workerTransferSignature(site.id,two.id,'selfChecks',key)).toString(),'다른 기록 서명');
  assert.equal(s.workerTransferSignature(other.id,one.id,'selfChecks',key),null);let calls=0;assert.throws(()=>s.workerTransferSignature(site.id,one.id,'selfChecks',key,()=>{if(++calls===2)throw Error('권한 회수');}),/권한 회수/);assert.equal(s.workerTransferAudit(site.id,one.id).source_id,source.id);
 }finally{s.close();}
});

test('다른 연결이 출역을 변경하는 동안 전환은 잠금을 기다린 뒤 오래된 미리보기를 거절한다',{timeout:30000},async()=>{
 const {Worker}=await import('node:worker_threads'),{once}=await import('node:events'),dir=mkdtempSync(join(tmpdir(),'jweb-transfer-lock-')),path=join(dir,'jweb.sqlite');let s,worker;
 try{
  const fixture=setup(path);s=fixture.s;const {source,target,date,params}=fixture,preview=s.previewWorkerTransfer(params),input={...params,version:preview.version,requestId,signature};
  const code=`import {parentPort,workerData} from 'node:worker_threads';const {Store}=await import(workerData.module);const s=new Store(workerData.path);parentPort.postMessage('ready');parentPort.once('message',()=>{parentPort.postMessage('attempt');try{s.executeWorkerTransfer(workerData.input,workerData.actor);parentPort.postMessage({ok:true});}catch(e){parentPort.postMessage({ok:false,message:e.message,status:e.sessionStatus});}finally{s.close();}});`;
  worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{module:new URL('../store.js',import.meta.url).href,path,input,actor}});assert.equal((await once(worker,'message'))[0],'ready');
  s.db.exec('BEGIN IMMEDIATE');s.db.prepare('UPDATE attendance SET units_hundredths=175 WHERE worker_id=? AND date=?').run(source.id,date);worker.postMessage('start');assert.equal((await once(worker,'message'))[0],'attempt');const outcome=once(worker,'message');await new Promise(resolve=>setTimeout(resolve,100));s.db.exec('COMMIT');
  const [result]=await outcome;assert.equal(result.ok,false);assert.equal(result.status,409);assert.match(result.message,/변경/);assert.equal(s.db.prepare('SELECT present FROM attendance WHERE worker_id=? AND date=?').get(source.id,date).present,1);assert.equal(s.db.prepare('SELECT 1 FROM attendance WHERE worker_id=? AND date=?').get(target.id,date),undefined);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_transfer_events').get().n,0);
 }finally{if(s?.db.isTransaction)s.db.exec('ROLLBACK');if(worker)await worker.terminate();if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('같은 전환 요청을 두 연결에서 동시에 보내도 한 번만 저장한다',{timeout:30000},async()=>{
 const {Worker}=await import('node:worker_threads'),{once}=await import('node:events'),dir=mkdtempSync(join(tmpdir(),'jweb-transfer-retry-')),path=join(dir,'jweb.sqlite');let s;const workers=[];
 try{
  const fixture=setup(path);s=fixture.s;const {source,target,date,params}=fixture,preview=s.previewWorkerTransfer(params),input={...params,version:preview.version,requestId,signature};
  const code=`import {parentPort,workerData} from 'node:worker_threads';const {Store}=await import(workerData.module);const s=new Store(workerData.path);parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage({result:s.executeWorkerTransfer(workerData.input,workerData.actor)});}catch(e){parentPort.postMessage({error:e.message});}finally{s.close();}});`;
  for(let i=0;i<2;i++){const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{module:new URL('../store.js',import.meta.url).href,path,input,actor}});workers.push(worker);assert.equal((await once(worker,'message'))[0],'ready');}
  const outcomes=workers.map(worker=>once(worker,'message'));for(const worker of workers)worker.postMessage('start');const results=(await Promise.all(outcomes)).map(([result])=>result);assert.ok(results.every(result=>!result.error));assert.equal(results[0].result.id,results[1].result.id);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_transfer_events').get().n,1);assert.equal(s.db.prepare('SELECT present FROM attendance WHERE worker_id=? AND date=?').get(source.id,date).present,0);assert.equal(s.db.prepare('SELECT present FROM attendance WHERE worker_id=? AND date=?').get(target.id,date).present,1);
 }finally{for(const worker of workers)await worker.terminate();if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('별도 백업과 복원은 전환 이력과 원래 시험 서명을 보존한다',{timeout:30000},async()=>{
 const {spawnSync}=await import('node:child_process'),{mkdirSync}=await import('node:fs'),dir=mkdtempSync(join(tmpdir(),'jweb-transfer-backup-')),path=join(dir,'jweb.sqlite'),backup=join(dir,'backup.sqlite'),restoredDir=join(dir,'restored');let s;
 try{
  const fixture=setup(path);s=fixture.s;const {site,source,target,date,params}=fixture,preview=s.previewWorkerTransfer(params),event=s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);s.close();s=null;
  mkdirSync(restoredDir);const backupRun=spawnSync(process.execPath,['db-copy.js','backup',backup],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8'});assert.equal(backupRun.status,0,backupRun.stderr);
  const restoreRun=spawnSync(process.execPath,['db-copy.js','restore',backup,restoredDir],{cwd:process.cwd(),encoding:'utf8'});assert.equal(restoreRun.status,0,restoreRun.stderr);
  s=new Store(join(restoredDir,'jweb.sqlite'));assert.equal(s.workerTransferHistory(site.id,date)[0].id,event.id);assert.equal(s.workerSelfCheck(target.id,date).transferOrigin.workerId,source.id);assert.equal(Buffer.from(s.workerTransferSignature(site.id,event.id,'selfChecks',JSON.stringify([date]))).toString(),'점검 서명');assert.deepEqual(Buffer.from(s.workerTransferSignature(site.id,event.id,null,null)),PNG.sync.write(png));
 }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('서명 없는 전환 교육에 대상자가 새 서명하면 새 확인 시각을 사용하고 이전 이력은 보존한다',()=>{
 const {s,source,target,date,education,params}=setup();try{
  s.db.prepare("UPDATE worker_training_checks SET signature=NULL,created_at='2001-01-01 00:00:00' WHERE worker_id=? AND document_id=?").run(source.id,education.id);s.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(education.id);
  const preview=s.previewWorkerTransfer(params),event=s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);assert.equal(s.trainingChecks(education.id)[0].transferOrigin.workerId,source.id);
  s.confirmWorkerTraining(target.id,education.id,date,true,signature);const current=s.trainingChecks(education.id)[0];assert.notEqual(current.created_at,'2001-01-01 00:00:00');assert.equal(current.transferOrigin,undefined);assert.equal(current.has_signature,1);
  const original=s.workerTransferAudit(params.siteId,event.id).records.find(row=>row.kind==='education');assert.equal(original.original_worker_id,source.id);assert.equal(original.record.created_at,'2001-01-01 00:00:00');assert.equal(original.has_signature,0);
 }finally{s.close();}
});

test('전환 전 결재 사본은 유지되고 전환 후 사본은 최초 서명자를 보존한다',()=>{
 const {s,source,target,date,education,params}=setup();try{
  s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)').run(source.id,date,'education',Buffer.from('원래 교육 서명'));
  const beforeId=s.captureApprovalCycle(s.document(education.id)),before=s.approvalCycle(education.id,beforeId);assert.equal(before.linked.signedWorkers[0].id,source.id);assert.equal(Buffer.from(s.approvalCycleFile(education.id,beforeId,'training-signature',source.id,0).data).toString(),'원래 교육 서명');
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  const afterId=s.captureApprovalCycle(s.document(education.id)),after=s.approvalCycle(education.id,afterId),person=after.linked.signedWorkers.find(row=>row.id===target.id);assert.equal(person.transferOrigin.workerId,source.id);assert.equal(Buffer.from(s.approvalCycleFile(education.id,afterId,'training-signature',target.id,0).data).toString(),'원래 교육 서명');
  assert.deepEqual(s.approvalCycle(education.id,beforeId),before);assert.equal(Buffer.from(s.approvalCycleFile(education.id,beforeId,'training-signature',source.id,0).data).toString(),'원래 교육 서명');
 }finally{s.close();}
});

test('전환 표가 없는 기존 DB를 열어도 출역과 서명을 보존하고 새 전환을 사용할 수 있다',{timeout:30000},async()=>{
 const {DatabaseSync}=await import('node:sqlite'),dir=mkdtempSync(join(tmpdir(),'jweb-transfer-migrate-')),path=join(dir,'jweb.sqlite');let s,legacy;
 try{
  const fixture=setup(path);s=fixture.s;const {site,source,target,date,education,params}=fixture;s.close();s=null;
  legacy=new DatabaseSync(path);for(const row of legacy.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'transfer_*'").all())legacy.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`);legacy.exec('DROP TABLE worker_transfer_evidence; DROP TABLE worker_transfer_provenance; DROP TABLE worker_transfer_events');legacy.close();legacy=null;
  s=new Store(path);assert.equal(s.attendance(site.id,date).find(row=>row.id===source.id).present,1);assert.equal(Buffer.from(s.trainingCheckSignature(education.id,source.id)).toString(),'확인 서명');assert.equal(s.workerSelfCheck(source.id,date).transferOrigin,undefined);assert.deepEqual(s.workerTransferHistory(site.id,date),[]);
  const preview=s.previewWorkerTransfer(params),event=s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);assert.equal(s.workerSelfCheck(target.id,date).transferOrigin.workerId,source.id);assert.equal(s.workerTransferAudit(site.id,event.id).source_id,source.id);
 }finally{if(legacy)legacy.close();if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('전환은 같은 날 교육 종류별 기록만 옮기고 대상의 다른 종류와 다음 날 기록을 유지한다',()=>{
 const {s,source,target,date,params}=setup();try{
  const add=s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)');add.run(source.id,date,'meeting',Buffer.from('기존 회의'));add.run(target.id,date,'education',Buffer.from('대상의 다른 교육'));add.run(target.id,'2026-11-02','meeting',Buffer.from('대상의 다음 날'));
  const preview=s.previewWorkerTransfer(params);assert.deepEqual(preview.conflicts,[]);assert.equal(preview.counts.dailyTraining,2);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  const rows=s.dailyTraining(target.id,date);assert.deepEqual(rows.map(row=>row.kind),['education','meeting','tbm']);assert.equal(rows.find(row=>row.kind==='meeting').transferOrigin.workerId,source.id);assert.equal(rows.find(row=>row.kind==='education').transferOrigin,undefined);
  assert.equal(Buffer.from(s.db.prepare('SELECT signature FROM worker_daily_training WHERE worker_id=? AND date=? AND kind=?').get(target.id,'2026-11-02','meeting').signature).toString(),'대상의 다음 날');assert.equal(s.db.prepare('SELECT worker_id FROM worker_daily_training WHERE worker_id=? AND date=? AND kind=?').get(source.id,'2026-11-02','tbm').worker_id,source.id);
 }finally{s.close();}
});

test('출역 전환은 급여대장과 보호구 지급·수령 서명을 옮기거나 수정하지 않는다',()=>{
 const {s,site,source,target,date,params}=setup();try{
  const deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'};s.saveWageRecord({siteId:site.id,workerId:source.id,month:date.slice(0,7),gross:'1000',deductions});
  const issue=s.addPpeIssue({siteId:site.id,workerId:source.id,date,item:'가상 안전모',quantity:'1'}),version=s.workerPpeIssues(site.id,source.id).find(row=>row.id===issue).version;s.confirmPpeReceipt(site.id,source.id,issue,version,signature);
  const wage=s.db.prepare('SELECT * FROM wage_records WHERE worker_id=?').get(source.id),ppe=s.db.prepare('SELECT * FROM ppe_issues WHERE id=?').get(issue),receipt=Buffer.from(s.ppeReceipt(site.id,source.id,issue));
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  assert.deepEqual(s.db.prepare('SELECT * FROM wage_records WHERE worker_id=?').get(source.id),wage);assert.deepEqual(s.db.prepare('SELECT * FROM ppe_issues WHERE id=?').get(issue),ppe);assert.deepEqual(Buffer.from(s.ppeReceipt(site.id,source.id,issue)),receipt);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM wage_records WHERE worker_id=?').get(target.id).n,0);assert.equal(s.workerPpeIssues(site.id,target.id).length,0);
 }finally{s.close();}
});

test('출역 전환은 가입 계정·작성 문서·개인 첨부와 권한을 옮기지 않는다',()=>{
 const {s,site,source,target,education,params}=setup();try{
  const accounts=s.db.prepare('INSERT INTO worker_accounts(worker_id,site_id,login_id,salt,password_hash) VALUES(?,?,?,?,?)');accounts.run(source.id,site.id,'virtual_old',Buffer.from('salt-old'),Buffer.from('hash-old'));accounts.run(target.id,site.id,'virtual_new',Buffer.from('salt-new'),Buffer.from('hash-new'));
  s.db.prepare('INSERT INTO worker_authored_documents(document_id,worker_id) VALUES(?,?)').run(education.id,source.id);s.db.prepare('INSERT INTO worker_permissions(worker_id,permission) VALUES(?,?)').run(source.id,'attendance');s.db.prepare('INSERT INTO worker_files(worker_id,category,name,data) VALUES(?,?,?,?)').run(source.id,'other','가상.txt',Buffer.from('가상 첨부'));
  const before={accounts:s.db.prepare('SELECT worker_id,site_id,login_id,hex(salt) AS salt,hex(password_hash) AS hash FROM worker_accounts ORDER BY worker_id').all(),authors:s.db.prepare('SELECT * FROM worker_authored_documents').all(),permissions:s.db.prepare('SELECT * FROM worker_permissions').all(),files:s.db.prepare('SELECT id,worker_id,category,name,hex(data) AS data FROM worker_files').all()};
  const preview=s.previewWorkerTransfer(params);s.executeWorkerTransfer({...params,version:preview.version,requestId,signature},actor);
  assert.deepEqual(s.db.prepare('SELECT worker_id,site_id,login_id,hex(salt) AS salt,hex(password_hash) AS hash FROM worker_accounts ORDER BY worker_id').all(),before.accounts);assert.deepEqual(s.db.prepare('SELECT * FROM worker_authored_documents').all(),before.authors);assert.deepEqual(s.db.prepare('SELECT * FROM worker_permissions').all(),before.permissions);assert.deepEqual(s.db.prepare('SELECT id,worker_id,category,name,hex(data) AS data FROM worker_files').all(),before.files);
 }finally{s.close();}
});
