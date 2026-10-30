import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
const expected=company=>({siteId:company.site_id,expectedName:company.name,expectedTrade:company.trade});
const worker=(siteId,company)=>({siteId,name:'가상 근로자',category:'직영',company,occupation:'가상 직종'});

test('이전 데이터베이스에 협력사 보관 기능을 추가해도 기존 목록은 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-company-old-')),file=join(dir,'old.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),company=s.createCompany({siteId:site.id,name:'기존 가상 업체',trade:'가상 공종'});s.close();s=null;
    const old=new DatabaseSync(file);old.exec('DROP TABLE archived_companies');old.close();
    s=new Store(file);assert.deepEqual(s.companies(site.id).map(row=>row.id),[company.id]);s.archiveCompany(company.id,expected(company));assert.deepEqual(s.companies(site.id),[]);
  }finally{if(s)s.close();cleanup(dir);}
});

test('협력사 목록 제거는 현장·사용 여부·변경과 권한을 검사하고 번호를 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-company-')),file=join(dir,'test.sqlite');let s=new Store(file);
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=name=>s.createCompany({siteId:site.id,name,trade:'가상 공종'});
    const idle=make('미사용 업체'),workerCompany=make('출입자 업체'),duplicate=make('출입자 업체'),docCompany=make('문서 업체'),textCompany=make('직접 입력 업체'),foreignOnly=make('다른 현장에서만 사용');
    s.createWorker(worker(site.id,workerCompany.name));s.createWorker(worker(other.id,foreignOnly.name));
    s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-30',details:{kind:'initial',items:[{contractorId:docCompany.id,task:'가상 작업'}]}});
    s.createDocument({siteId:site.id,type:'permit',title:'가상 허가',date:'2026-10-30',details:{company:textCompany.name}});
    for(const company of [workerCompany,duplicate,docCompany,textCompany]){assert.equal(s.companyInUse(site.id,company.id,company.name),true);assert.throws(()=>s.archiveCompany(company.id,expected(company)),/사용 중/);}
    assert.equal(s.companyInUse(site.id,foreignOnly.id,foreignOnly.name),false);
    assert.throws(()=>s.archiveCompany(idle.id,{...expected(idle),siteId:other.id}),/현장/);
    assert.throws(()=>s.archiveCompany(idle.id,{...expected(idle),expectedTrade:'다른 공종'}),/변경/);
    assert.throws(()=>s.archiveCompany(idle.id,expected(idle),()=>{throw Error('권한 만료');}),/권한 만료/);
    assert.throws(()=>s.updateCompany(idle.id,{siteId:site.id,name:'변경',trade:'가상 공종'},()=>{throw Error('권한 만료');}),/권한 만료/);
    assert.ok(s.companies(site.id).some(company=>company.id===idle.id));
    s.archiveCompany(idle.id,expected(idle));assert.ok(!s.companies(site.id).some(company=>company.id===idle.id));
    assert.throws(()=>s.updateCompany(idle.id,{siteId:site.id,name:'변경',trade:'공종'}),/현장/);
    assert.throws(()=>s.createAuthorizedDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-30',details:{items:[{contractorId:idle.id,task:'작업'}]}}),/협력사/);
    assert.throws(()=>s.createAuthorizedDocument({siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-10-30',details:{companyId:idle.id}}),/협력사/);
    assert.throws(()=>s.documents(site.id,'risk','','','','',String(idle.id)),/협력사/);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM companies WHERE id=?').get(idle.id).n,1);
    s.close();s=new Store(file);assert.ok(!s.companies(site.id).some(company=>company.id===idle.id));
    const replacement=make('미사용 업체');assert.notEqual(replacement.id,idle.id);assert.equal(s.companyInUse(site.id,replacement.id,replacement.name),false);
  }finally{s.close();cleanup(dir);}
});

test('협력사 API는 관리자만 미사용 항목을 삭제하고 가입 후보에서 제외한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-company-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const add=async name=>(await (await send('/api/companies','POST',{siteId:site.id,name,trade:'가상 공종'},admin)).json()),idle=await add('미사용 업체'),used=await add('사용 업체');
    assert.equal((await send('/api/workers','POST',worker(site.id,used.name),admin)).status,201);
    const invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),joinPath=`/api/join?token=${encodeURIComponent(token)}`;
    const before=await (await send(joinPath)).json();assert.ok(before.companies.includes(idle.name));
    assert.equal((await send(`/api/companies/${idle.id}`,'DELETE',expected(idle))).status,401);
    assert.equal((await send(`/api/companies/${idle.id}`,'DELETE',{...expected(idle),siteId:other.id},admin)).status,400);
    const rows=await (await send(`/api/companies?siteId=${site.id}&withUsage=1`,'GET',null,admin)).json();assert.equal(rows.find(row=>row.id===idle.id).in_use,false);assert.equal(rows.find(row=>row.id===used.id).in_use,true);
    assert.equal((await send(`/api/companies/${used.id}`,'DELETE',expected(used),admin)).status,400);
    assert.equal((await send(`/api/companies/${idle.id}`,'DELETE',expected(idle),admin)).status,200);
    const after=await (await send(joinPath)).json();assert.ok(!after.companies.includes(idle.name));assert.ok(after.companies.includes(used.name));
    assert.equal((await send(`/api/companies/${idle.id}`,'PUT',{siteId:site.id,name:'변경',trade:'시험'},admin)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});

test('저장 잠금 중 협력사가 삭제되거나 사용되면 진행 중인 문서와 삭제를 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-company-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};for(const [method,marker] of [['createAuthorizedDocument','DOC_LOCK'],['archiveCompany','COMPANY_LOCK']]){const original=Store.prototype[method];Store.prototype[method]=function(...args){process.stdout.write(marker+'\\n');return original.apply(this,args)}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    const add=async name=>(await (await send('/api/companies','POST',{siteId:site.id,name,trade:'시험'},admin)).json()),first=await add('삭제될 업체'),second=await add('사용될 업체');
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;
    let started=once(child.stdout,'data'),pending=send('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-30',details:{items:[{contractorId:first.id,task:'작업'}]}},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/DOC_LOCK/);
    db.prepare('INSERT INTO archived_companies(company_id) VALUES(?)').run(first.id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,0);
    db.exec('BEGIN IMMEDIATE');locked=true;started=once(child.stdout,'data');pending=send(`/api/companies/${second.id}`,'DELETE',expected(second),admin);pending.catch(()=>{});assert.match(String((await started)[0]),/COMPANY_LOCK/);
    db.prepare('INSERT INTO workers(site_id,name,category,company,occupation) VALUES(?,?,?,?,?)').run(site.id,'가상 근로자','직영',second.name,'가상 직종');db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT count(*) AS n FROM archived_companies WHERE company_id=?').get(second.id).n,0);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});
