import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';

const input=(siteId,details={})=>({siteId,type:'permit',title:'가상 허가',date:'2026-10-31',details});
const expected=company=>({siteId:company.site_id,expectedName:company.name,expectedTrade:company.trade});
const emptyRoles=()=>({contractorLead:null,coordinator:null,supervisor:null,safetyOfficer:null,siteManager:null,inspector:null});

test('허가서의 등록 협력사 연결과 저장 당시 이름을 보호하고 수동 입력도 유지한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const first=store.createCompany({siteId:site.id,name:'같은 가상 업체',trade:'가상 공종 A'}),duplicate=store.createCompany({siteId:site.id,name:'같은 가상 업체',trade:'가상 공종 B'}),foreign=store.createCompany({siteId:other.id,name:'다른 업체',trade:'시험'}),archived=store.createCompany({siteId:site.id,name:'보관 업체',trade:'시험'});
    store.archiveCompany(archived.id,expected(archived));
    const legacy=store.createAuthorizedDocument(input(site.id,{company:'이전 직접 입력'}));
    assert.equal(JSON.parse(store.updateDocument(legacy.id,input(site.id,{company:'수정된 직접 입력'})).details).company,'수정된 직접 입력');
    for(const id of [foreign.id,archived.id,-1,1.5,'1',null])assert.throws(()=>store.createAuthorizedDocument(input(site.id,{companyId:id})),/협력사/);
    const doc=store.createAuthorizedDocument(input(site.id,{companyId:duplicate.id,company:'임의 이름'}));
    assert.deepEqual(JSON.parse(doc.details),{company:'같은 가상 업체',companyId:duplicate.id});
    assert.equal(store.companyInUse(site.id,duplicate.id,duplicate.name),true);
    store.managedTransition(doc.id,{action:'submit'});const cycle=store.document(doc.id).approval_cycle_id;
    const changed=store.updateCompany(duplicate.id,{siteId:site.id,name:'변경된 가상 업체',trade:duplicate.trade});
    assert.throws(()=>store.archiveCompany(duplicate.id,expected(changed)),/사용 중/);
    store.managedTransition(doc.id,{action:'withdraw'});
    assert.throws(()=>store.updateDocument(doc.id,input(site.id,{company:'기존 화면'})),/새로고침/);
    assert.throws(()=>store.updateDocument(doc.id,input(site.id,null)),/새로고침/);
    assert.equal(JSON.parse(store.document(doc.id).details).companyId,duplicate.id);
    assert.equal(JSON.parse(store.updateDocument(doc.id,input(site.id,{companyId:duplicate.id,company:'조작된 이름'})).details).company,'같은 가상 업체');
    assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).company,'같은 가상 업체');
    const switched=store.updateDocument(doc.id,input(site.id,{companyId:first.id,company:'다른 이름'}));
    assert.equal(JSON.parse(switched.details).companyId,first.id);
    const unlinked=store.updateDocument(doc.id,input(site.id,{companyId:0,company:'직접 입력'}));
    assert.equal(JSON.parse(unlinked.details).company,'직접 입력');assert.equal(JSON.parse(unlinked.details).companyId,0);
    store.archiveCompany(duplicate.id,expected(changed));
    const safety=[{accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 조치'}],withSafety=store.createAuthorizedDocument(input(site.id,{safetyMeasures:safety}));
    assert.deepEqual(JSON.parse(store.updateDocument(withSafety.id,input(site.id,null)).details).safetyMeasures,safety);
  }finally{store.close();}
});

test('등록 업체를 추가할 때 기존 허가 역할의 필수 조건을 확인하고 문서를 보존한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),company=store.createCompany({siteId:site.id,name:'가상 업체',trade:'시험'}),reviewer=store.createReviewer({siteId:site.id,loginId:'permit_company_manager',name:'가상 직원',password:'virtual-password-123'}),doc=store.createAuthorizedDocument(input(site.id));
    store.setPermitRoles(doc.id,{expectedVersion:store.permitRoles(doc.id).version,roles:{...emptyRoles(),siteManager:reviewer.id}});
    const before=store.document(doc.id);
    assert.throws(()=>store.updateDocument(doc.id,input(site.id,{companyId:company.id,company:''})),/협력사 현장소장/);
    assert.deepEqual(store.document(doc.id),before);
    store.setPermitRoles(doc.id,{expectedVersion:store.permitRoles(doc.id).version,roles:{...emptyRoles(),siteManager:reviewer.id,contractorLead:reviewer.id}});
    assert.equal(JSON.parse(store.updateDocument(doc.id,input(site.id,{companyId:company.id,company:''})).details).company,'가상 업체');
  }finally{store.close();}
});

test('HTTP 허가서 작성은 잠금 대기 중 보관된 업체를 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-company-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.createAuthorizedDocument;Store.prototype.createAuthorizedDocument=function(...args){process.stdout.write('DOC_LOCK\\n');return original.apply(this,args)};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,lines,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),company=await (await send('/api/companies','POST',{siteId:site.id,name:'가상 업체',trade:'시험'},admin)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;lines=createInterface({input:child.stdout});
    const started=Promise.race([once(lines,'line'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]),pending=send('/api/documents','POST',input(site.id,{companyId:company.id,company:''}),admin);pending.catch(()=>{});assert.match((await started)[0],/DOC_LOCK/);
    db.prepare('INSERT INTO archived_companies(company_id) VALUES(?)').run(company.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,0);
    const active=await (await send('/api/companies','POST',{siteId:site.id,name:'가상 등록 업체',trade:'시험'},admin)).json(),created=await send('/api/documents','POST',input(site.id,{companyId:active.id,company:'임의 이름'}),admin);
    assert.equal(created.status,201);const document=await created.json();assert.equal(JSON.parse(document.details).company,'가상 등록 업체');
    assert.equal((await send(`/api/documents/${document.id}`)).status,401);const loaded=await (await send(`/api/documents/${document.id}`,'GET',null,admin)).json();assert.equal(JSON.parse(loaded.details).companyId,active.id);
  }finally{lines?.close();if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
