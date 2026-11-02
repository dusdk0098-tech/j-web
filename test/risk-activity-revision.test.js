import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { Store } from '../store.js';
const input={kind:'weekly',date:'2026-10-30',periodFrom:'2026-10-01',periodTo:'2026-10-31',place:'가상 장소',host:'가상 주관',participants:'',content:'원래 내용'};
const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
const conflict=error=>error.sessionStatus===409;
function setup(s){const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:input.date}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',company:'가상 업체',category:'직영',occupation:'가상 직종'});return {doc,values:{...input,workerIds:[worker.id]}};}

test('활동 수정·첨부·서명·삭제 충돌과 같은 번호 재생성을 구별한다',()=>{
  const s=new Store(':memory:');try{const {doc,values}=setup(s),id=s.saveRiskActivity(doc.id,values),row=()=>s.riskActivities(doc.id).find(x=>x.id===id),a=row();
    s.saveRiskActivity(doc.id,{...values,content:'먼저 저장',expectedRevision:a.revision},id);
    const before=row();assert.throws(()=>s.saveRiskActivity(doc.id,{...values,content:'늦게 저장',expectedRevision:a.revision},id),conflict);assert.deepEqual(row(),before);
    assert.throws(()=>s.saveRiskActivitySignature(doc.id,id,signature,()=>{},a.revision),conflict);
    assert.throws(()=>s.deleteRiskActivity(doc.id,id,a.revision),conflict);
    const photo=s.addRiskActivityPhoto(doc.id,id,'가상.png',bytes,'photo',before.revision),withPhoto=row();assert.notEqual(withPhoto.revision,before.revision);
    assert.throws(()=>s.saveRiskActivitySignature(doc.id,id,signature,()=>{},before.revision),conflict);
    assert.throws(()=>s.deleteRiskActivityPhoto(doc.id,id,photo,before.revision),conflict);assert.ok(s.riskActivityPhoto(doc.id,id,photo));
    s.saveRiskActivitySignature(doc.id,id,signature,()=>{},withPhoto.revision);const signed=row();assert.notEqual(signed.revision,withPhoto.revision);
    assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'늦은.png',bytes,'photo',withPhoto.revision),conflict);assert.ok(s.riskActivitySignature(doc.id,id));
    s.transition(doc.id,'submit');const frozen=s.reviewerPayload(s.document(doc.id));s.deleteRiskActivity(doc.id,id,signed.revision);const replacement=s.saveRiskActivity(doc.id,values);assert.equal(replacement,id);assert.notEqual(row().revision,signed.revision);
    assert.throws(()=>s.deleteRiskActivity(doc.id,id,signed.revision),conflict);assert.throws(()=>s.saveRiskActivity(doc.id,{...values,expectedRevision:signed.revision},id),conflict);assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'옛.png',bytes,'photo',signed.revision),conflict);assert.throws(()=>s.saveRiskActivitySignature(doc.id,id,signature,()=>{},signed.revision),conflict);assert.deepEqual(s.reviewerPayload(s.document(doc.id)),frozen);
    assert.throws(()=>s.deleteRiskActivity(doc.id,id,row().revision,()=>{throw Error('권한 취소');}),/권한 취소/);assert.ok(row());
    const second=s.saveRiskActivity(doc.id,values);assert.notEqual(second,id);assert.equal(s.riskActivities(doc.id).length,2);
  }finally{s.close();}
});

test('구형 활동 DB에 버전을 부여하고 재시작에도 버전과 본문을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-revision-')),file=join(dir,'old.sqlite');let s=new Store(file);
  try{const {doc,values}=setup(s),id=s.saveRiskActivity(doc.id,values);s.close();s=null;const db=new DatabaseSync(file);for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%revision%'").all())if(row.name.startsWith('risk_'))db.exec(`DROP TRIGGER ${row.name}`);db.exec('ALTER TABLE risk_activities DROP COLUMN revision');db.close();s=new Store(file);const row=s.riskActivities(doc.id).find(a=>a.id===id);assert.match(row.revision,/^[a-f0-9]{64}$/);assert.equal(row.content,values.content);s.close();s=new Store(file);assert.deepEqual(s.riskActivities(doc.id).find(a=>a.id===id),row);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP 동시 수정은 하나만 성공하며 구형·재사용 ID 요청을 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-revision-api-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const trace=`import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};const save=Store.prototype.saveRiskActivity;Store.prototype.saveRiskActivity=function(...args){process.stdout.write('ACTIVITY_LOCK');return save.apply(this,args)}`;const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-admin-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
    const send=(path,method='GET',body,revision)=>fetch(base+path,{method,headers:{cookie,'content-type':'application/json',...(revision?{'x-risk-revision':revision}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const site=await(await send('/api/sites','POST',{name:'가상 현장'})).json(),doc=await(await send('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:input.date})).json(),worker=await(await send('/api/workers','POST',{siteId:site.id,name:'가상 근로자',company:'가상 업체',category:'직영',occupation:'가상 직종'})).json(),values={...input,workerIds:[worker.id]},path=`/api/documents/${doc.id}/risk-activities`,id=(await(await send(path,'POST',values)).json()).id,read=async()=>(await(await send(path)).json()).find(a=>a.id===id),a=await read();
    assert.equal((await send(path+'/'+id,'PUT',values)).status,409);assert.equal((await send(path+'/'+id,'DELETE')).status,409);assert.equal((await send(path+'/'+id+'/signature','POST',{signature})).status,409);
    const db=new DatabaseSync(join(dir,'jweb.sqlite'));try{db.exec('BEGIN IMMEDIATE');const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.stdout.off('data',listen);reject(Error('활동 잠금 대기 초과'));},5000);function listen(chunk){if(String(chunk).includes('ACTIVITY_LOCK')){clearTimeout(timer);child.stdout.off('data',listen);resolve();}}child.stdout.on('data',listen);});const pending=send(path+'/'+id,'PUT',{...values,content:'잠금 뒤 오래된 저장'},a.revision);await started;db.prepare('UPDATE risk_activities SET content=? WHERE id=?').run('다른 연결의 먼저 저장',id);db.exec('COMMIT');assert.equal((await pending).status,409);assert.equal((await read()).content,'다른 연결의 먼저 저장');}finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
    a.revision=(await read()).revision;
    const results=await Promise.all([send(path+'/'+id,'PUT',{...values,content:'첫 화면'},a.revision),send(path+'/'+id,'PUT',{...values,content:'둘째 화면'},a.revision)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const current=await read();assert.ok(['첫 화면','둘째 화면'].includes(current.content));
    assert.equal((await send(path+'/'+id+'/signature','POST',{signature,expectedRevision:a.revision})).status,409);assert.equal((await send(path+'/'+id+'/signature','POST',{signature,expectedRevision:current.revision})).status,200);const signed=await read();
    assert.equal((await send(path+'/'+id,'DELETE',undefined,signed.revision)).status,200);assert.equal((await(await send(path,'POST',values)).json()).id,id);assert.equal((await send(path+'/'+id,'DELETE',undefined,signed.revision)).status,409);assert.equal((await send(path+'/'+id,'PUT',values,signed.revision)).status,409);
    const upload=revision=>fetch(base+path+'/'+id+'/photos',{method:'POST',headers:{cookie,'x-file-name':'fake.png',...(revision?{'x-risk-revision':revision}:{})},body:bytes});assert.equal((await upload()).status,409);assert.equal((await upload(signed.revision)).status,409);const fresh=await read(),file=await upload(fresh.revision);assert.equal(file.status,201);const photo=(await file.json()).id;assert.equal((await send(path+'/'+id+'/photos/'+photo,'DELETE',undefined,fresh.revision)).status,409);assert.equal((await send(path+'/'+id+'/photos/'+photo,'DELETE',undefined,(await read()).revision)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('실제 활동 수정 핸들러는 조회 버전을 보내며 충돌 후 입력을 보존한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),form={value:'입력 보존'},nodes={'#dialog-title':{},'#dialog-body':{},'#dialog-error':{},'#dialog-form':form,'#dialog-form button[type=submit]':{}},dialog={open:false,showModal(){this.open=true},close(){this.open=false}};let sent,rendered=0;
  const context={$:key=>nodes[key],dialog,FormData:class{constructor(){return [['content',form.value],['kind','meeting'],['date',input.date]];}},flash(){},render(){rendered++;},state:{detail:3,siteId:2},doc:{id:3,site_id:2},riskReviewers:[],riskWorkers:[],kinds:{meeting:'회의'},esc:x=>x,field:()=>'',today:()=>input.date,document:{querySelectorAll:()=>[]},detailApi:async(path,options)=>{sent=options;throw Error('변경 충돌');}};
  context.api=context.detailApi;const handler=source.split('\n').find(line=>line.includes('const editActivity='));runInNewContext(source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick"))+'\n'+handler+'\neditActivity({id:1,revision:"old-revision",kind:"meeting",date:"2026-10-30"});',context);const submit=form.onsubmit;await submit({preventDefault(){},currentTarget:form});assert.equal(sent.headers['x-risk-revision'],'old-revision');assert.equal(JSON.parse(sent.body).content,'입력 보존');assert.equal(form.value,'입력 보존');assert.equal(dialog.open,true);assert.equal(form.onsubmit,submit);assert.equal(rendered,0);assert.equal(nodes['#dialog-error'].textContent,'변경 충돌');assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);
});
