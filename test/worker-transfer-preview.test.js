import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {inspectWorkerTransfer,previewWorkerTransfer} from '../worker-transfer.js';

test('출역 전환 영향은 날짜·현장·기록 종류별로 충돌과 서명 변경을 감지한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상',occupation:'가상'}),source=make(site.id,'기존'),target=make(site.id,'대상'),foreign=make(other.id,'다른 현장'),date='2026-11-01',params={siteId:site.id,sourceId:source.id,targetId:target.id,date};
  s.setAttendance({...params,workerId:source.id,present:true});s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(source.id,date,Buffer.from('가상 서명'),'[]');
  s.db.prepare('INSERT INTO worker_daily_training(worker_id,date,kind,signature) VALUES(?,?,?,?)').run(source.id,date,'tbm',Buffer.from('가상 교육'));
  const notice=s.createDocument({siteId:site.id,type:'notice',date,title:'가상 공지'}),education=s.createDocument({siteId:site.id,type:'education',date,title:'가상 교육'});
  s.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id,signature) VALUES(?,?,?)').run(source.id,notice.id,Buffer.from('가상 공지'));
  s.db.prepare('INSERT INTO worker_training_checks(worker_id,document_id,signature) VALUES(?,?,?)').run(source.id,education.id,Buffer.from('가상 확인'));
  s.db.prepare('INSERT INTO training_target_config(document_id) VALUES(?)').run(education.id);s.db.prepare('INSERT INTO training_targets(document_id,worker_id) VALUES(?,?)').run(education.id,source.id);
  const first=inspectWorkerTransfer(s.db,params),publicPreview=previewWorkerTransfer(s.db,params);assert.equal(publicPreview.version,first.version);assert.equal(Object.hasOwn(publicPreview,'from'),false);assert.equal(JSON.stringify(publicPreview).includes('가상 서명'),false);let checks=0;assert.throws(()=>previewWorkerTransfer(s.db,params,()=>{if(++checks===2)throw Error('권한 회수');}),/권한 회수/);assert.equal(s.db.isTransaction,false);assert.deepEqual(first.counts,{attendance:1,meals:0,selfChecks:1,dailyTraining:1,notices:1,noticeHistory:0,education:1});assert.deepEqual(first.conflicts,[]);assert.match(first.version,/^[a-f0-9]{64}$/);s.db.prepare('DELETE FROM training_target_config WHERE document_id=?').run(education.id);assert.notEqual(inspectWorkerTransfer(s.db,params).version,first.version);s.db.prepare('INSERT INTO training_target_config(document_id) VALUES(?)').run(education.id);assert.notEqual(inspectWorkerTransfer(s.db,params).version,first.version);
  s.db.prepare('UPDATE worker_self_checks SET signature=? WHERE worker_id=? AND date=?').run(Buffer.from('다른 서명'),source.id,date);assert.notEqual(inspectWorkerTransfer(s.db,params).version,first.version);
  s.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(target.id,date,Buffer.from('대상 서명'),'[]');const conflicting=inspectWorkerTransfer(s.db,params);assert.deepEqual(conflicting.conflicts,['selfChecks']);assert.notEqual(conflicting.version,first.version);
  assert.throws(()=>inspectWorkerTransfer(s.db,{...params,targetId:foreign.id}),/현장/);assert.throws(()=>inspectWorkerTransfer(s.db,{...params,targetId:source.id}),/서로 다른/);assert.throws(()=>inspectWorkerTransfer(s.db,{...params,date:'2026-02-30'}),/날짜/);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM worker_self_checks WHERE date=?').get(date).n,2);
 }finally{s.close();}
});

test('종류와 문서가 같은 기록만 충돌하며 다른 날짜 기록은 영향 계산에서 제외한다',()=>{
 const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),make=name=>s.createWorker({siteId:site.id,name,category:'직영',company:'가상',occupation:'가상'}),source=make('출발'),target=make('대상'),date='2026-11-01',next='2026-11-02',params={siteId:site.id,sourceId:source.id,targetId:target.id,date},restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'});
  for(const worker of [source,target])s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});s.saveMealCheck({siteId:site.id,workerId:source.id,date,kind:'lunch',restaurantId:restaurant.id});s.saveMealCheck({siteId:site.id,workerId:target.id,date,kind:'dinner',restaurantId:restaurant.id});
  const doc=s.createDocument({siteId:site.id,date,type:'notice',title:'가상 공지'}),other=s.createDocument({siteId:site.id,date:next,type:'notice',title:'다음 공지'}),edit=s.db.prepare('INSERT INTO notice_edits(document_id,previous_title,previous_body) VALUES(?,?,?)').run(doc.id,'가상','가상').lastInsertRowid;
  const notice=s.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id) VALUES(?,?)');notice.run(source.id,doc.id);notice.run(target.id,other.id);s.db.prepare('INSERT INTO notice_edit_reads(edit_id,worker_id,read_at,signature) VALUES(?,?,?,?)').run(edit,source.id,'가상',Buffer.from('서명'));
  let preview=inspectWorkerTransfer(s.db,params);assert.equal(preview.counts.meals,1);assert.equal(preview.counts.notices,1);assert.equal(preview.counts.noticeHistory,1);assert.deepEqual(preview.conflicts,['attendance']);
  s.saveMealCheck({siteId:site.id,workerId:target.id,date,kind:'lunch',restaurantId:restaurant.id});notice.run(target.id,doc.id);s.db.prepare('INSERT INTO notice_edit_reads(edit_id,worker_id,read_at,signature) VALUES(?,?,?,?)').run(edit,target.id,'가상',Buffer.from('다른 서명'));preview=inspectWorkerTransfer(s.db,params);assert.deepEqual(preview.conflicts,['attendance','meals','notices','noticeHistory']);
 }finally{s.close();}
});
