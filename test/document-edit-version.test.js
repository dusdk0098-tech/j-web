import { fetchWithWorkerSession as fetch } from './helpers/worker-session-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';
import {runInNewContext} from 'node:vm';
const input={type:'tbm',title:'가상 제목',date:'2026-11-01',body:'최초 본문',details:{weather:'가상 날씨'}};
const conflict=error=>error.sessionStatus===409;

test('같은 초의 두 편집 및 되돌림도 충돌하고 상세·새 서명·첨부·이력을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),value={...input,siteId:site.id},doc=s.createDocument(value);
    const prepare=s.db.prepare.bind(s.db);s.db.prepare=sql=>prepare(sql.replaceAll('updated_at=CURRENT_TIMESTAMP',"updated_at='2026-11-01 12:00:00'"));s.db.prepare('UPDATE documents SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(doc.id);const a=s.document(doc.id),b=s.document(doc.id);
    const changed=s.updateDocument(doc.id,{...value,body:'A 저장 본문',details:{weather:'A 날씨'},expectedEditVersion:a.edit_version});
    assert.equal(changed.updated_at,a.updated_at);assert.ok(changed.edit_version>a.edit_version);
    s.db.prepare('INSERT INTO tbm_signatures(document_id,signature) VALUES(?,?)').run(doc.id,Buffer.from('virtual-signature'));
    const before=s.document(doc.id);
    assert.throws(()=>s.updateDocument(doc.id,{...value,title:'B 제목',expectedEditVersion:b.edit_version}),conflict);
    assert.deepEqual(s.document(doc.id),before);assert.equal(Buffer.from(s.tbmSignature(doc.id).signature).toString(),'virtual-signature');assert.equal(JSON.parse(before.details).weather,'A 날씨');
    const other=s.createDocument({...value,title:'다른 문서'});s.updateDocument(other.id,{...value,title:'다른 변경',expectedEditVersion:other.edit_version});
    const restored=s.updateDocument(doc.id,{...value,expectedEditVersion:before.edit_version});assert.ok(restored.edit_version>before.edit_version);assert.equal(s.tbmSignature(doc.id),null);
    assert.throws(()=>s.updateDocument(doc.id,{...value,expectedEditVersion:a.edit_version}),conflict);
    for(const mutate of [()=>s.db.prepare('INSERT INTO attachments(document_id,name,data) VALUES(?,?,?)').run(doc.id,'가상.txt',Buffer.from('virtual')),()=>s.db.prepare("INSERT INTO events(document_id,action,from_status,to_status) VALUES(?,'test','draft','draft')").run(doc.id)]){
      const read=s.document(doc.id);mutate();const current=s.document(doc.id);assert.ok(current.edit_version>read.edit_version);assert.throws(()=>s.updateDocument(doc.id,{...value,expectedEditVersion:read.edit_version}),conflict);assert.deepEqual(s.document(doc.id),current);
    }
    const read=s.document(doc.id);assert.throws(()=>s.updateDocument(doc.id,{...value,expectedEditVersion:read.edit_version},()=>s.db.prepare("UPDATE documents SET body='잠금 내부 변경' WHERE id=?").run(doc.id)),conflict);assert.deepEqual(s.document(doc.id),read);
  }finally{s.close();}
});

test('근로자 조회 버전과 직원 기존 해시 권한 검사는 각각 오래된 저장을 막는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 출입자',category:'직영',occupation:'목공',loginId:'virtual_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    s.setWorkerPermissions(site.id,worker.id,['training']);const doc=s.createWorkerDocument(site.id,worker.id,input),a=s.workerDocument(site.id,worker.id,doc.id),b=s.workerDocuments(site.id,worker.id)[0];
    s.updateWorkerDocument(site.id,worker.id,doc.id,{...input,body:'A 본문',expectedEditVersion:a.edit_version});assert.throws(()=>s.updateWorkerDocument(site.id,worker.id,doc.id,{...input,title:'B 제목',expectedEditVersion:b.edit_version}),conflict);assert.equal(s.document(doc.id).body,'A 본문');
    const reviewer=s.createReviewer({siteId:site.id,name:'가상 직원',loginId:'virtual_author',password:'virtual-password-123'}),office={...input,type:'office',details:{kind:'품의서'}},own=s.createReviewerOfficeDocument(reviewer.id,office),first=s.reviewerOfficeDetail(reviewer.id,own.id);
    s.updateReviewerOfficeDocument(reviewer.id,own.id,{...office,body:'직원 A 본문',expectedEditVersion:first.document.edit_version},first.version);
    assert.throws(()=>s.updateReviewerOfficeDocument(reviewer.id,own.id,{...office,title:'직원 B 제목',expectedEditVersion:first.document.edit_version},first.version),conflict);assert.equal(s.document(own.id).body,'직원 A 본문');
    const latest=s.reviewerOfficeDetail(reviewer.id,own.id);assert.throws(()=>s.updateReviewerOfficeDocument(reviewer.id,own.id,{...office,expectedEditVersion:latest.document.edit_version},undefined),conflict);
  }finally{s.close();}
});

test('기존 DB에 버전만 추가하고 본문·상세·서명·이력을 무손실 보존하며 재시작 후 버전이 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-edit-migration-')),path=join(dir,'virtual.sqlite');let s;
  try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({...input,siteId:site.id});s.db.prepare('INSERT INTO tbm_signatures(document_id,signature) VALUES(?,?)').run(doc.id,Buffer.from('virtual-signature'));s.close();s=null;
    const db=new DatabaseSync(path);for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'document_edit_%'").all())db.exec('DROP TRIGGER '+name);db.exec('ALTER TABLE documents DROP COLUMN edit_version');
    const previous=db.prepare('SELECT * FROM documents').all(),signature=db.prepare('SELECT * FROM tbm_signatures').all(),events=db.prepare('SELECT * FROM events').all();db.close();
    s=new Store(path);assert.deepEqual(s.db.prepare('SELECT * FROM documents').all().map(({edit_version,...row})=>row),previous.map(row=>({...row})));assert.deepEqual(s.db.prepare('SELECT * FROM tbm_signatures').all(),signature);assert.deepEqual(s.db.prepare('SELECT * FROM events').all(),events);assert.equal(s.document(doc.id).edit_version,0);
    s.updateDocument(doc.id,{...input,siteId:site.id,body:'이관 후 본문',expectedEditVersion:0});const version=s.document(doc.id).edit_version;s.close();s=new Store(path);assert.equal(s.document(doc.id).edit_version,version);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('관리자 두 API 클라이언트는 200/409이고 버전 누락·잘못된 값도 409다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-edit-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const login=async()=>(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],a=await login(),b=await login(),site=await(await call('/api/sites','POST',{name:'가상 현장'},a)).json(),value={...input,siteId:site.id},doc=await(await call('/api/documents','POST',value,a)).json(),path=`/api/documents/${doc.id}`,readA=await(await call(path,'GET',null,a)).json(),readB=await(await call(path,'GET',null,b)).json();
    assert.equal((await call(path,'PUT',{...value,body:'A 보존 본문',expectedEditVersion:readA.edit_version},a)).status,200);
    assert.equal((await call(path,'PUT',{...value,title:'B 오래된 제목',expectedEditVersion:readB.edit_version},b)).status,409);
    for(const version of [undefined,null,'0',-1])assert.equal((await call(path,'PUT',{...value,expectedEditVersion:version},b)).status,409);
    const latest=await(await call(path,'GET',null,b)).json();assert.equal(latest.body,'A 보존 본문');assert.equal(latest.title,input.title);assert.equal((await call(path,'PUT',{...value,body:latest.body,title:'재조회 후 제목',expectedEditVersion:latest.edit_version},b)).status,200);
    const invitation=await(await call('/api/sites/'+site.id+'/invitation','POST',{},a)).json(),token=new URL(invitation.link).searchParams.get('token'),person={token,name:'가상 출입자',category:'직영',occupation:'목공',loginId:'virtual_api_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',person)).status,201);const loginWorker=async()=>{const response=await call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password});return {cookie:response.headers.get('set-cookie').split(';')[0],worker:(await response.json()).worker};},wa=await loginWorker(),wb=await loginWorker();
    assert.equal((await call('/api/workers/'+wa.worker.id+'/permissions','PUT',{siteId:site.id,permissions:['training']},a)).status,200);const wd=await(await call('/api/worker/documents','POST',input,wa.cookie)).json(),wp='/api/worker/documents/'+wd.id,wreadA=await(await call(wp,'GET',null,wa.cookie)).json(),wreadB=await(await call(wp,'GET',null,wb.cookie)).json();
    assert.equal((await call(wp,'PUT',{...input,body:'근로자 A 본문',expectedEditVersion:wreadA.edit_version},wa.cookie)).status,200);assert.equal((await call(wp,'PUT',{...input,title:'근로자 B 제목',expectedEditVersion:wreadB.edit_version},wb.cookie)).status,409);assert.equal((await call(wp,'PUT',input,wb.cookie)).status,409);assert.equal((await(await call(wp,'GET',null,wb.cookie)).json()).body,'근로자 A 본문');

  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('세 편집 화면은 읽은 버전을 보내고 저장 실패 시 입력을 지우거나 자동 재시도하지 않는다',()=>{
  const admin=readFileSync('public/app.js','utf8'),worker=readFileSync('public/worker-documents.js','utf8'),reviewer=readFileSync('public/reviewer-office.js','utf8');
  for(const source of [admin,worker,reviewer])assert.match(source,/expectedEditVersion:doc.edit_version/);
  assert.match(admin,/catch\(err\)\{if\(current\(\)&&dialog.open\)\$\('#dialog-error'\).textContent=err.message;/);
  assert.match(worker,/await send\(doc\?[\s\S]*?\);if\(form.isConnected\)editor.replaceChildren\(\)/);
  assert.match(reviewer,/await send\(path\|\|[\s\S]*?await reload\(result.document.id\)/);
});

test('관리자 저장 핸들러에 409를 주면 입력과 대화상자를 유지하고 재시도는 하지 않는다',async()=>{
  const source=readFileSync('public/app.js','utf8'),handler=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick")),nodes=Object.fromEntries(['#dialog-title','#dialog-body','#dialog-error','#dialog-form','#dialog-form button[type=submit]'].map(key=>[key,{}])),form=nodes['#dialog-form'];form.values={title:'B 편집 제목',body:'B 편집 본문'};let calls=0;
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},context={$:key=>nodes[key],dialog,flash(){throw Error('실패 후 성공 알림');},render(){throw Error('실패 후 화면 교체');},FormData:class{constructor(target){return Object.entries(target.values);}}};
  runInNewContext(handler,context);context.showDialog('가상 편집','가상 입력',async value=>{calls++;assert.equal(value.body,'B 편집 본문');throw Object.assign(Error('문서 변경: 입력 내용을 복사해 주세요.'),{status:409});});
  await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(calls,1);assert.equal(dialog.open,true);assert.deepEqual(form.values,{title:'B 편집 제목',body:'B 편집 본문'});assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);assert.match(nodes['#dialog-error'].textContent,/복사/);
});
test('근로자 실제 저장 핸들러가 조회 버전을 전송하고 409 후 본문·상세 입력을 보존한다',async()=>{
  const source=readFileSync('public/worker-documents.js','utf8'),handler=source.slice(source.indexOf('    form.onsubmit=async event=>{'),source.indexOf("    if(doc&&type==='work_plan'){")),button={disabled:false},elements=Object.fromEntries(['title','date','body','weather','instructor','work','hazards'].map(key=>[key,{value:'편집 '+key}])),form={elements,isConnected:true,querySelector(){return button;}},status={};let sent,calls=0;
  const reportContext={workerId:1,siteId:1,generation:'original'},context={form,type:'tbm',doc:{id:1,edit_version:7},editVersion:7,reportContext,editor:{replaceChildren(){throw Error('입력 소실');}},status,updateList(){throw Error('목록 재조회');},message(error){status.textContent=error.message;},send:async(path,method,value)=>{calls++;sent={path,method,value};throw Object.assign(Error('문서 변경: 입력 내용을 복사해 주세요.'),{status:409});}};
  runInNewContext(handler,context);await form.onsubmit({preventDefault(){}});assert.equal(calls,1);assert.equal(sent.method,'PUT');assert.equal(sent.value.expectedEditVersion,7);assert.equal(sent.value.reportContext,reportContext);assert.equal(sent.value.body,'편집 body');assert.equal(sent.value.details.weather,'편집 weather');assert.equal(form.elements.body.value,'편집 body');assert.equal(form.elements.weather.value,'편집 weather');assert.equal(button.disabled,false);assert.match(status.textContent,/복사/);
});

test('직원 실제 저장 핸들러가 기존 권한 해시와 조회 버전을 보내고 409 후 입력을 보존한다',async()=>{
  const source=readFileSync('public/reviewer-office.js','utf8'),run=source.slice(source.indexOf('    const run='),source.indexOf('    const reload=')).replace('const run=','globalThis.run='),start=source.indexOf('      form.onsubmit=event=>'),handler=source.slice(start,source.indexOf('\n',start)),button={disabled:false},elements=Object.fromEntries(['title','date','kind','otherKind','referenceDocId'].map(key=>[key,{value:key==='referenceDocId'?'0':'편집 '+key}])),form={elements,querySelector(){return button;}},status={},editor={inert:false},richValue=[{type:'paragraph',children:[{text:'직원 편집 본문'}]}];let sent,calls=0;
  const context={form,button,status,editor,formDirty:true,lineDirty:false,refDirty:false,signDirty:false,pending:0,request:0,savingMessage:'저장 중',id:1,path:'/api/reviewer/office-documents/1',doc:{id:1,edit_version:12},data:{version:'권한 해시'},rich:{value:()=>richValue},draftSetup:()=>null,editSignature:()=>null,reload(){throw Error('입력 소실');},saveWarning(){throw Error('다른 변경');},error(error){status.textContent=error.message;},send:async(path,method,value)=>{calls++;sent={path,method,value};throw Object.assign(Error('문서가 변경되었습니다.'),{status:409});}};
  runInNewContext(run+handler,context);form.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(sent.method,'PUT');assert.equal(sent.value.expectedEditVersion,12);assert.equal(sent.value.version,'권한 해시');assert.equal(sent.value.details.bodyRich,richValue);assert.equal(form.elements.title.value,'편집 title');assert.equal(context.rich.value(),richValue);assert.equal(button.disabled,false);assert.equal(editor.inert,false);assert.match(status.textContent,/변경/);
});
