import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
const person=siteId=>({siteId,name:'가상 출입자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
const staff=(siteId,loginId)=>({siteId,loginId,name:loginId,password:'virtual-password-123'});
const weekly=(reviewerIds,workerIds=[])=>({kind:'weekly',date:'2026-10-30',periodFrom:'2026-10-01',periodTo:'2026-10-31',entryMode:'manual',place:'가상 장소',host:'가상 주관',participants:'',content:'가상 내용',reviewerIds,workerIds});
const signature=()=>{const png=new PNG({width:1,height:1});png.data[3]=255;return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;};

test('직원과 출입자를 같은 현장으로 제한하고 회의 당시 명단과 결재 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 현장'}),b=s.createSite({name:'다른 현장'}),doc=s.createDocument({siteId:a.id,type:'risk',title:'가상 평가',date:'2026-10-29'}),worker=s.createWorker(person(a.id)),one=s.createReviewer(staff(a.id,'virtual_one')),two=s.createReviewer(staff(a.id,'virtual_two')),foreign=s.createReviewer(staff(b.id,'virtual_foreign')),inactive=s.createReviewer(staff(a.id,'virtual_inactive'));
    s.updateReviewer(a.id,inactive.id,{active:false});
    for(const ids of [[foreign.id],[inactive.id],[one.id,one.id],[0],['1']])assert.throws(()=>s.saveRiskActivity(doc.id,weekly(ids)),/직원|참석자/);
    assert.throws(()=>s.saveRiskActivity(doc.id,weekly([one.id]),null,()=>{throw Error('시험 세션 만료');}),/세션 만료/);assert.equal(s.riskActivities(doc.id).length,0);
    const id=s.saveRiskActivity(doc.id,weekly([one.id])),row=()=>s.riskActivities(doc.id).find(item=>item.id===id);
    assert.deepEqual(JSON.parse(row().reviewer_snapshot),[{id:one.id,name:'virtual_one'}]);const previous=row().reviewer_snapshot;
    s.saveRiskActivity(doc.id,{...weekly([one.id,two.id]),expectedReviewerSnapshot:previous},id);assert.throws(()=>s.saveRiskActivity(doc.id,{...weekly([one.id]),expectedReviewerSnapshot:previous},id),error=>error.sessionStatus===409);
    assert.equal(JSON.parse(row().reviewer_snapshot).length,2);s.saveRiskActivity(doc.id,weekly([one.id]),id);s.saveRiskActivitySignature(doc.id,id,signature());assert.ok(s.riskActivitySignature(doc.id,id));
    s.db.prepare('UPDATE reviewers SET name=? WHERE id=?').run('수정된 직원',one.id);s.updateReviewer(a.id,one.id,{active:false});
    s.saveRiskActivity(doc.id,{...weekly([one.id]),content:'수정'},id);assert.equal(JSON.parse(row().reviewer_snapshot)[0].name,'virtual_one');assert.equal(s.riskActivitySignature(doc.id,id),null);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...weekly(undefined),date:'2026-10-31'},id),/다시 선택/);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...weekly([one.id]),date:'2026-10-31'},id),/활성 직원/);assert.equal(row().date,'2026-10-30');
    s.updateReviewer(a.id,one.id,{active:true});const changed={...weekly([one.id]),date:'2026-10-31'};s.saveRiskActivity(doc.id,changed,id);assert.equal(JSON.parse(row().reviewer_snapshot)[0].name,'수정된 직원');
    s.saveRiskActivity(doc.id,{...changed,reviewerIds:undefined,content:'이전 화면 수정'},id);assert.equal(JSON.parse(row().reviewer_snapshot)[0].name,'수정된 직원');
    s.saveRiskActivitySignature(doc.id,id,signature());s.setApprovalLine(doc.id,[two.id]);s.transition(doc.id,'submit');const frozen=s.reviewerPayload(s.document(doc.id)).linked.activities[0];
    assert.deepEqual(frozen.reviewer_snapshot,[{id:one.id,name:'수정된 직원'}]);s.saveRiskActivity(doc.id,{...changed,reviewerIds:[],workerIds:[worker.id]},id);
    assert.deepEqual(JSON.parse(row().reviewer_snapshot),[]);assert.equal(s.riskActivitySignature(doc.id,id),null);assert.deepEqual(s.reviewerPayload(s.document(doc.id)).linked.activities[0].reviewer_snapshot,frozen.reviewer_snapshot);
  }finally{s.close();}
});

test('이전 회의 데이터는 직원 항목 추가 후에도 기존 출입자와 내용을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-staff-old-')),file=join(dir,'old.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29'}),worker=s.createWorker(person(site.id)),id=s.saveRiskActivity(doc.id,weekly([], [worker.id]));s.close();s=null;
    const old=new DatabaseSync(file);old.exec('ALTER TABLE risk_activities DROP COLUMN reviewer_snapshot');old.close();
    s=new Store(file);const row=s.riskActivities(doc.id).find(item=>item.id===id);assert.deepEqual(JSON.parse(row.reviewer_snapshot),[]);assert.equal(JSON.parse(row.worker_snapshot)[0].id,worker.id);assert.equal(row.content,'가상 내용');
  }finally{if(s)s.close();cleanup(dir);}
});

test('직원 참석자 API는 관리자 인증과 현장 경계, 결재 당시 명단을 지킨다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-staff-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],a=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),b=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json(),one=await (await send('/api/reviewers','POST',staff(a.id,'api_staff'),admin)).json(),foreign=await (await send('/api/reviewers','POST',staff(b.id,'foreign_staff'),admin)).json(),doc=await (await send('/api/documents','POST',{siteId:a.id,type:'risk',title:'가상 평가',date:'2026-10-29'},admin)).json(),path=`/api/documents/${doc.id}/risk-activities`;
    const reviewerCookie=(await send('/api/reviewer/login','POST',{loginId:'api_staff',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    assert.equal((await send(path,'POST',weekly([one.id]))).status,401);assert.equal((await send(path,'POST',weekly([one.id]),reviewerCookie)).status,401);assert.equal((await send(path,'POST',weekly([foreign.id]),admin)).status,400);
    const saved=await send(path,'POST',weekly([one.id]),admin);assert.equal(saved.status,201);const id=(await saved.json()).id,rows=await (await send(path,'GET',null,admin)).json();assert.equal(JSON.parse(rows[0].reviewer_snapshot)[0].name,'api_staff');
    const extra=await (await send('/api/reviewers','POST',staff(a.id,'api_extra'),admin)).json(),old=rows[0].reviewer_snapshot;
    assert.equal((await send(`${path}/${id}`,'PUT',{...weekly([one.id,extra.id]),expectedReviewerSnapshot:old},admin)).status,200);
    assert.equal((await send(`${path}/${id}`,'PUT',{...weekly([one.id]),expectedReviewerSnapshot:old},admin)).status,409);
    const changed=(await (await send(path,'GET',null,admin)).json())[0];assert.equal(JSON.parse(changed.reviewer_snapshot).length,2);assert.equal((await send(`${path}/${id}`,'PUT',{...weekly([one.id]),expectedReviewerSnapshot:changed.reviewer_snapshot},admin)).status,200);
    assert.equal((await send(`${path}/${id}/signature`,'POST',{signature:signature()},admin)).status,200);assert.equal((await send(`/api/documents/${doc.id}/approval-line`,'PUT',{reviewerIds:[one.id]},admin)).status,200);assert.equal((await send(`/api/documents/${doc.id}/transition`,'POST',{action:'submit'},admin)).status,200);
    const review=await (await send(`/api/reviewer/documents/${doc.id}`,'GET',null,reviewerCookie)).json();assert.deepEqual(review.linked.activities[0].reviewer_snapshot,[{id:one.id,name:'api_staff'}]);
    const worker=await (await send('/api/workers','POST',person(a.id),admin)).json();assert.equal((await send(`${path}/${id}`,'PUT',weekly([], [worker.id]),admin)).status,200);
    const preserved=await (await send(`/api/reviewer/documents/${doc.id}`,'GET',null,reviewerCookie)).json();assert.deepEqual(preserved.linked.activities[0].reviewer_snapshot,[{id:one.id,name:'api_staff'}]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});

test('회의 저장이 잠금을 기다리는 동안 직원이 중지되거나 문서가 바뀌면 저장하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-staff-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,auth=pathToFileURL(join(process.cwd(),'auth.js')).href,flag=join(dir,'expired.flag'),trace=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(source)};import {LocalAuth} from ${JSON.stringify(auth)};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(...args){return existsSync(${JSON.stringify(flag)})?false:valid.apply(this,args)};for(const name of ['saveRiskActivity','saveRiskActivitySignature']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('RISK_LOCK\\n');return original.apply(this,args)}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',staff(site.id,'race_staff'),admin)).json(),doc=await (await send('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29'},admin)).json(),path=`/api/documents/${doc.id}/risk-activities`;
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const change of ['UPDATE reviewers SET active=0 WHERE id=?',"UPDATE documents SET type='tbm' WHERE id=?"]){
      db.exec('BEGIN IMMEDIATE');locked=true;const signal=once(child.stdout,'data'),pending=send(path,'POST',weekly([reviewer.id]),admin);pending.catch(()=>{});assert.match(String((await signal)[0]),/RISK_LOCK/);
      db.prepare(change).run(change.startsWith('UPDATE reviewers')?reviewer.id:doc.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM risk_activities').get().n,0);
      if(change.startsWith('UPDATE reviewers'))db.prepare('UPDATE reviewers SET active=1 WHERE id=?').run(reviewer.id);
    }
    db.prepare("UPDATE documents SET type='risk' WHERE id=?").run(doc.id);db.exec('BEGIN IMMEDIATE');locked=true;
    let signal=once(child.stdout,'data'),pending=send(path,'POST',weekly([reviewer.id]),admin);pending.catch(()=>{});assert.match(String((await signal)[0]),/RISK_LOCK/);writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT count(*) AS n FROM risk_activities').get().n,0);unlinkSync(flag);
    signal=once(child.stdout,'data');const created=await send(path,'POST',weekly([reviewer.id]),admin);assert.match(String((await signal)[0]),/RISK_LOCK/);assert.equal(created.status,201);const id=(await created.json()).id;
    db.exec('BEGIN IMMEDIATE');locked=true;signal=once(child.stdout,'data');pending=send(`${path}/${id}/signature`,'POST',{signature:signature()},admin);pending.catch(()=>{});assert.match(String((await signal)[0]),/RISK_LOCK/);
    writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT count(*) AS n FROM risk_activity_signatures').get().n,0);unlinkSync(flag);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});
