import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';

test('남은 열세 근로자 저장 경로는 최초 세션과 잠금 후 철회를 검증한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-report-session-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};for(const [method,table] of ['recordWorkerLogin','recordWorkerDeparture','setDelegatedAttendance','confirmPpeReceipt','respondInstruction','addWorkerInstructionPhoto','updateWorkerDocument','transitionWorkerDocument','addAttachment','deleteAttachment','setTrainingTargets','saveAuthorSignature'].map(method=>[method,'unused'])){const original=Store.prototype[method];Store.prototype[method]=function(...args){const db=this.db,exec=db.exec,prepare=db.prepare;let notified=false;const notify=()=>{if(!notified){notified=true;process.stdout.write('REPORT_SAVE\\n')}};db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'&&(method!=='recordWorkerLogin'||args[2]===null))notify();return exec.call(this,sql)};db.prepare=function(sql){if(sql.includes('INSERT')&&sql.includes(table))notify();return prepare.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec;db.prepare=prepare}};}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invitation=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token'),person={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'report_race',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',person)).status,201);const login=async(loginId=person.loginId,cookie)=>{const r=await send('/api/worker/login','POST',{token,loginId,password:person.password},cookie);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');return {cookie:r.headers.get('set-cookie').split(';')[0],...(await r.json())};},png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),photo=`data:image/png;base64,${bytes.toString('base64')}`;db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');let current=await login();assert.equal((await send('/api/join','POST',{...person,name:'가상 B',loginId:'report_other'})).status,201);

    const a=current,b=await login('report_other'),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),signature=photo;

    for(const actor of [a,b])for(const permission of ['risk','work_plan','training','attendance'])db.prepare('INSERT INTO worker_permissions(worker_id,permission) VALUES(?,?)').run(actor.worker.id,permission);
    const document=(type,status='draft',details={})=>{const id=Number(db.prepare('INSERT INTO documents(site_id,type,title,date,body,status,details) VALUES(?,?,?,?,?,?,?)').run(site.id,type,'가상 문서',date,'가상 본문',status,JSON.stringify(details)).lastInsertRowid);db.prepare('INSERT INTO worker_authored_documents(document_id,worker_id) VALUES(?,?)').run(id,b.worker.id);return id;};
    const risk=document('risk'),transition=document('risk'),attachmentDoc=document('risk'),tbm=document('tbm'),plan=document('work_plan'),instruction=document('instruction','approved',{recipientId:b.worker.id}),photoDoc=document('instruction','approved',{recipientId:b.worker.id});
    db.prepare("INSERT INTO instruction_results(document_id,date,actor,content,source,signature) VALUES(?,?,?,'가상 응답','worker',?)").run(photoDoc,date,'가상 근로자',bytes);
    const issue=Number(db.prepare("INSERT INTO ppe_issues(site_id,worker_id,date,item,quantity,worker_snapshot,version) VALUES(?,?,?,'가상 보호구',1,'{}',?)").run(site.id,b.worker.id,date,'a'.repeat(32)).lastInsertRowid),file=Number(db.prepare("INSERT INTO attachments(document_id,name,data,category) VALUES(?,'virtual.txt',?,'general')").run(attachmentDoc,Buffer.from('가상 첨부')).lastInsertRowid);
    const tables=['documents','attachments','worker_arrivals','worker_departures','attendance','delegated_attendance_events','ppe_receipts','ppe_issues','instruction_results','instruction_photos','training_target_config','training_targets','tbm_signatures','meeting_signatures','events'];
    const snapshot=()=>JSON.stringify(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
    const docInput={title:'가상 수정',date,body:'가상 내용',details:{},expectedEditVersion:0};
    const scenarios=[
      {name:'출입 복원',path:'/api/worker/access',data:{siteId:site.id,token},prepare:()=>db.prepare('DELETE FROM worker_arrivals WHERE worker_id=?').run(b.worker.id)},
      {name:'퇴근',path:'/api/worker/departure',data:{}},
      {name:'출역 관리',path:'/api/worker/managed-attendance',method:'PUT',data:async()=>{const rows=await (await send('/api/worker/managed-attendance?date='+date,'GET',null,current.cookie)).json();return {date,workerId:a.worker.id,present:false,expectedDayVersion:rows.find(row=>row.id===a.worker.id).day_version};}},
      {name:'보호구 수령',path:'/api/worker/ppe-issues/'+issue+'/receipt',data:{version:'a'.repeat(32),signature}},
      {name:'지시 응답',path:'/api/worker/instructions',data:{documentId:instruction,date,content:'가상 응답',signature},status:201},
      {name:'지시 사진',path:'/api/worker/instructions/'+photoDoc+'/photos?phase=after',binary:true,status:201},
      {name:'문서 수정',path:'/api/worker/documents/'+risk,method:'PUT',data:()=>({...docInput,expectedEditVersion:db.prepare('SELECT edit_version FROM documents WHERE id=?').get(risk).edit_version})},
      {name:'문서 상신',path:'/api/worker/documents/'+transition+'/transition',data:()=>({action:'submit',expectedEditVersion:db.prepare('SELECT edit_version FROM documents WHERE id=?').get(transition).edit_version})},
      {name:'첨부 추가',path:'/api/worker/documents/'+attachmentDoc+'/attachments',binary:true,status:201},
      {name:'첨부 삭제',path:'/api/worker/documents/'+attachmentDoc+'/attachments/'+file,method:'DELETE',data:{}},
      {name:'교육 대상',path:'/api/worker/documents/'+tbm+'/training',method:'PUT',data:async()=>({workerIds:[b.worker.id],expectedVersion:(await (await send('/api/worker/documents/'+tbm+'/training','GET',null,current.cookie)).json()).version})},
      {name:'TBM 서명',path:'/api/worker/documents/'+tbm+'/training/signature',data:async()=>({signature,expectedVersion:(await (await send('/api/worker/documents/'+tbm+'/training','GET',null,current.cookie)).json()).version})},
      {name:'작성자 서명',path:'/api/worker/documents/'+plan+'/author-signature',data:async()=>{const info=await (await send('/api/worker/documents/'+plan+'/author-signature','GET',null,current.cookie)).json();return {signature,expectedVersion:info.version,expectedEditVersion:info.editVersion};}}
    ];
    for(const scenario of scenarios){
      current=await login('report_other');scenario.prepare?.();const data=typeof scenario.data==='function'?await scenario.data():scenario.data,before=snapshot();
      const request=reportContext=>scenario.binary?fetch(base+scenario.path,{method:'POST',headers:{cookie:current.cookie,'content-type':'application/octet-stream','x-file-name':'virtual.png',...(reportContext===undefined?{}:{'x-worker-report-context':typeof reportContext==='string'?reportContext:JSON.stringify(reportContext)})},body:bytes}):send(scenario.path,scenario.method||'POST',{...data,reportContext},current.cookie);
      for(const reportContext of [undefined,a.reportContext,b.reportContext,{...current.reportContext,siteId:99999},{...current.reportContext,workerId:a.worker.id},...(scenario.binary?['invalid-json']:[])]){
        const response=await request(reportContext);assert.equal(response.status,409,scenario.name+' '+await response.clone().text());assert.equal((await response.json()).sessionChanged,true);assert.equal(snapshot(),before,scenario.name+' 거절 후 DB 보존');
      }
      db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=request(current.reportContext);pending.catch(()=>{});assert.match(String((await started)[0]),/REPORT_SAVE/);db.prepare('DELETE FROM worker_sessions WHERE worker_id=?').run(current.worker.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,401,scenario.name);assert.equal(snapshot(),before,scenario.name+' 잠금 철회 후 DB 보존');
      current=await login('report_other');scenario.prepare?.();const validBefore=snapshot(),valid=await request(current.reportContext);assert.equal(valid.status,scenario.status||200,scenario.name+' '+await valid.clone().text());assert.notEqual(snapshot(),validBefore,scenario.name+' 정상 요청 저장');console.log(scenario.name+': 누락/다른 근로자/재로그인/현장 불일치 거절, 잠금 대기 철회 401 및 DB 보존, 정상 저장 통과');
    }

  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
