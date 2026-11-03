import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import http from 'node:http';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
const password='virtual-scope-password-123';

test('현장 관리자 HTTP 경계: 위조·미분류·관계 검증·지연 본문·잠금 대기·응답 직전 철회',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-site-policy-')),store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db);auth.bootstrap(password);
 const a=store.createSite({name:'가상 하나'}),b=store.createSite({name:'가상 둘'}),input={siteId:a.id,type:'notice',title:'가상 문서',date:'2026-11-01',body:'가상 내용'},doc=store.createDocument(input),foreign=store.createDocument({...input,siteId:b.id}),file=store.addAttachment(doc.id,'가상.txt',Buffer.from('virtual')),foreignFile=store.addAttachment(foreign.id,'가상.txt',Buffer.from('private'));
 const account=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[a.id]}),empty=auth.create({loginId:'empty',name:'가상 무배정',password,scope:'restricted',siteIds:[]});
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const source=pathToFileURL(join(process.cwd(),'store.js')).href;
 const hook=`import {Store} from ${JSON.stringify(source)};for(const name of ['createAuthorizedDocument','updateDocument']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('WRITE_START\\n');return original.apply(this,args)}}const original=Store.prototype.attachment;Store.prototype.attachment=function(id){const result=original.call(this,id);if(result?.name==='revoke.txt')this.db.exec('DELETE FROM admin_sessions');return result};`;
 const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(hook)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');})]);
  const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie,headers={})=>fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const login=async id=>(await send('/api/login','POST',{loginId:id,password})).headers.get('set-cookie').split(';')[0];let cookie=await login('limited');const global=await login('admin');
  assert.deepEqual((await (await send('/api/sites','GET',null,cookie)).json()).map(s=>s.id),[a.id]);assert.deepEqual(await (await send('/api/sites','GET',null,await login('empty'))).json(),[]);
  assert.equal((await send('/api/types','GET',null,cookie)).status,200);
  assert.equal((await send(`/api/documents?siteId=${a.id}`,'GET',null,cookie)).status,200);
  const shared=store.createDocument({...input,siteId:b.id,type:'basic',details:{shared:true}});store.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(shared.id);
  for(const query of ['', '&type=basic', '&q=가상']){const rows=await (await send(`/api/documents?siteId=${a.id}${query}`,'GET',null,cookie)).json();assert.ok(rows.every(row=>row.site_id===a.id));assert.ok(!rows.some(row=>row.id===shared.id));}
  assert.ok((await (await send(`/api/documents?siteId=${a.id}&type=basic`,'GET',null,global)).json()).some(row=>row.id===shared.id));
  assert.equal((await send(`/api/documents/${shared.id}`,'GET',null,cookie)).status,403);
  for(const path of ['/api/documents',`/api/documents?siteId=${b.id}`,`/api/documents/${foreign.id}`,`/api/documents/${doc.id}?siteId=${b.id}`,`/api/attachments/${foreignFile}`,`/api/sites/${a.id}/worker-access-report?date=2026-11-02`,'/api/admin-accounts','/api/board-posts','/api/ai/status','/api/attendance/sites-report','/api/not-registered'])assert.equal((await send(path,'GET',null,cookie)).status,403,path);
  for(const path of [`/api/documents/${doc.id}/copy-work-plan`,'/api/documents/batch-approve',`/api/documents/${doc.id}/attachments`,'/api/sites','/api/admin-accounts'])assert.equal((await send(path,'POST',input,cookie)).status,403,path);
  assert.equal((await send(`/api/documents/${doc.id}`,'GET',null,cookie,{'X-Admin-Context':'stale'})).status,409);
  assert.equal((await send(`/api/documents/${doc.id}/attachments`,'GET',null,cookie)).status,200);assert.equal(await (await send(`/api/attachments/${file}`,'GET',null,cookie)).text(),'virtual');
  const trainingDocs=['education','tbm'].map(type=>store.createDocument({...input,type,details:type==='tbm'?{work:'가상 작업',hazards:'가상 위험'}:{kind:'other',otherTitle:'가상 교육'}}));
  trainingDocs[0].details=JSON.stringify({...JSON.parse(trainingDocs[0].details),timeFrom:'04:13',educationMethod:'이전 방식'});store.db.prepare('UPDATE documents SET details=? WHERE id=?').run(trainingDocs[0].details,trainingDocs[0].id);
  for(const training of trainingDocs){
   const trainingFile=store.addAttachment(training.id,'교육.txt',Buffer.from('virtual training'));
   const endpoint=`/api/documents/${training.id}/attachments/${trainingFile}`;
   assert.equal((await (await send(`/api/documents/${training.id}`,'GET',null,cookie)).json()).details,training.details);
   assert.equal((await (await send(`/api/documents/${training.id}/attachments`,'GET',null,cookie)).json())[0].id,trainingFile);
   for(const actor of [cookie,global]){const r=await send(endpoint,'GET',null,actor);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(await r.text(),'virtual training');}
   for(const other of [file,foreignFile])assert.equal((await send(`/api/documents/${training.id}/attachments/${other}`,'GET',null,cookie)).status,403);
   for(const method of ['POST','PUT','DELETE'])assert.equal((await send(endpoint,method,input,cookie)).status,403);
   assert.equal((await send(`/api/documents/${training.id}/transition`,'POST',{action:'submit'},cookie)).status,403);
  }
  assert.equal((await send('/training-detail.js','GET',null,cookie)).status,200);
  const plan=store.createDocument({...input,type:'work_plan',details:{company:'가상 계획 업체',place:'가상 장소',hazards:'가상 위험',measures:'가상 대책',periodFrom:'2026-11-01',periodTo:'2026-11-01',timeFrom:'07:00',timeTo:'16:00',workKinds:['기타']}});
  assert.equal((await (await send(`/api/documents/${plan.id}`,'GET',null,cookie)).json()).details,plan.details);
  const planFile=store.addAttachment(plan.id,'plan.txt',Buffer.from('virtual plan')),planEndpoint=`/api/documents/${plan.id}/attachments/${planFile}`;assert.equal((await (await send(`/api/documents/${plan.id}/attachments`,'GET',null,cookie)).json())[0].id,planFile);assert.equal(await (await send(planEndpoint,'GET',null,cookie)).text(),'virtual plan');assert.equal((await send(planEndpoint)).status,401);for(const other of [file,foreignFile])assert.equal((await send(`/api/documents/${plan.id}/attachments/${other}`,'GET',null,cookie)).status,403);for(const method of ['POST','PUT','DELETE'])assert.equal((await send(planEndpoint,method,input,cookie)).status,403);
  assert.equal((await send(`/api/documents/${plan.id}`)).status,401);
  const foreignPlan=store.createDocument({...input,siteId:b.id,type:'work_plan'}),foreignPlanFile=store.addAttachment(foreignPlan.id,'foreign-plan.txt',Buffer.from('foreign'));assert.equal((await send(`/api/documents/${foreignPlan.id}`,'GET',null,cookie)).status,403);assert.equal((await send(`/api/documents/${foreignPlan.id}/attachments/${foreignPlanFile}`,'GET',null,cookie)).status,403);
  assert.equal((await send(`/api/documents/${plan.id}/transition`,'POST',{action:'submit'},cookie)).status,403);
  for(const actor of [undefined,cookie,global]){
   const planScript=await send('/plan-detail.js','GET',null,actor);assert.equal(planScript.status,200);assert.match(planScript.headers.get('content-type'),/javascript/);assert.equal(await planScript.text(),readFileSync('public/plan-detail.js','utf8'));
   const script=await send('/risk-detail.js','GET',null,actor);assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);const body=await script.text();assert.match(body,/export function riskDetailMarkup/);assert.match(body,/export function muscleDetailMarkup/);
   const mode=await send('/risk-activity-mode.js','GET',null,actor);assert.equal(mode.status,200);assert.match(mode.headers.get('content-type'),/javascript/);assert.equal(await mode.text(),readFileSync('public/risk-activity-mode.js','utf8'));
   const dependency=await send('/risk-scale.js','GET',null,actor);assert.equal(dependency.status,200);assert.match(dependency.headers.get('content-type'),/javascript/);
  }
  assert.equal((await send('/api/documents','POST',{...input,siteId:b.id},cookie)).status,403);
  assert.equal((await send('/api/documents','POST',{...input,officeSetup:{}},cookie)).status,403);
  for(const type of ['notice','checklist','tbm','education','daily_report']){const created=await send('/api/documents','POST',{...input,type},cookie);assert.equal(created.status,201,`${type}: ${await created.clone().text()}`);const row=await created.json();assert.equal((await send(`/api/documents/${row.id}`,'PUT',{...input,type,title:'가상 수정',expectedEditVersion:row.edit_version},cookie)).status,200);}
  for(const site of [a,b]){
   const company=store.createCompany({siteId:site.id,name:'가상 업체',trade:'가상 공종'}),office=store.createDocument({...input,siteId:site.id,type:'office',details:{kind:'기타',otherKind:'가상'}});
   const equipment=Number(store.db.prepare("INSERT INTO equipment(site_id,kind,model,capacity,manufacturer,registration) VALUES(?,'가상','가상','가상','가상','가상')").run(site.id).lastInsertRowid);
   const worker=Number(store.db.prepare("INSERT INTO workers(site_id,name,category,company,occupation) VALUES(?,'가상','근로자','가상 업체','가상')").run(site.id).lastInsertRowid);
   const category=Number(store.db.prepare("INSERT INTO basic_categories(site_id,name,position) VALUES(?,'가상',0)").run(site.id).lastInsertRowid);
   for(const [type,details] of [['risk',{items:[{contractorId:company.id}]}],['instruction',{companyId:company.id,recipientId:worker}],['permit',{companyId:company.id,permitWorkerIds:[worker],permitEquipmentIds:[equipment]}],['office',{kind:'기타',otherKind:'가상',referenceDocId:office.id}],['work_plan',{equipmentIds:[equipment],equipmentAssignments:[{equipmentId:equipment,workerId:worker}]}],['basic',{categoryId:category}]]){
    const result=await send('/api/documents','POST',{...input,type,details},cookie);assert.equal(result.status,site===a?201:400,`${type}: ${await result.text()}`);
   }
  }
  const before=store.db.prepare('SELECT count(*) AS n FROM documents').get().n;
  const delayed=http.request(base+'/api/documents',{method:'POST',headers:{cookie,'content-type':'application/json'}});const answer=new Promise((r,j)=>{delayed.on('response',res=>{res.resume();r(res.statusCode)});delayed.on('error',j)});delayed.write('{');await new Promise(r=>setTimeout(r,100));auth.update(account.id,{version:auth.list().find(x=>x.id===account.id).version,siteIds:[b.id]});delayed.end(JSON.stringify(input).slice(1));assert.equal(await answer,401);assert.equal(store.db.prepare('SELECT count(*) AS n FROM documents').get().n,before);
  auth.update(account.id,{version:auth.list().find(x=>x.id===account.id).version,siteIds:[a.id]});cookie=await login('limited');
  store.db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(`/api/documents/${doc.id}`,'PUT',{...input,title:'차단 대상',expectedEditVersion:store.document(doc.id).edit_version},cookie);assert.match(String((await started)[0]),/WRITE_START/);store.db.prepare('UPDATE documents SET site_id=? WHERE id=?').run(b.id,doc.id);store.db.exec('COMMIT');locked=false;assert.equal((await pending).status,403);assert.equal(store.document(doc.id).title,input.title);
  store.db.exec('BEGIN IMMEDIATE');locked=true;const revokedStart=once(child.stdout,'data'),revoked=send('/api/documents','POST',input,cookie);assert.match(String((await revokedStart)[0]),/WRITE_START/);store.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(account.id);store.db.exec('COMMIT');locked=false;assert.equal((await revoked).status,401);
  assert.equal((await send('/api/sites','GET',null,global)).status,200);assert.equal((await send('/api/not-registered','GET',null,global)).status,404);assert.equal((await send('/api/admin-accounts','GET',null,global)).status,200);
  cookie=await login('limited');const trainingRevoke=store.addAttachment(trainingDocs[0].id,'revoke.txt',Buffer.from('blocked'));const revokedRead=await send(`/api/documents/${trainingDocs[0].id}/attachments/${trainingRevoke}`,'GET',null,cookie);assert.equal(revokedRead.status,401);assert.doesNotMatch(await revokedRead.text(),/blocked/);
  cookie=await login('limited');const planRevoke=store.addAttachment(plan.id,'revoke.txt',Buffer.from('blocked plan'));const revokedPlan=await send(`/api/documents/${plan.id}/attachments/${planRevoke}`,'GET',null,cookie);assert.equal(revokedPlan.status,401);assert.doesNotMatch(await revokedPlan.text(),/blocked plan/);
  cookie=await login('limited');const revokeFile=store.addAttachment(foreign.id,'revoke.txt',Buffer.from('blocked'));store.db.prepare('UPDATE documents SET site_id=? WHERE id=?').run(a.id,foreign.id);assert.equal((await send(`/api/attachments/${revokeFile}`,'GET',null,cookie)).status,401);
 }finally{if(locked)store.db.exec('ROLLBACK');store.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
