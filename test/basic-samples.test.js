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
import { basicSampleList } from '../public/basic-samples.js';

test('샘플 목록은 파일 이름을 안전한 텍스트와 다운로드 링크로 표시한다',()=>{
  const category={id:2,samples:[{id:3,name:'<img src=x onerror=alert(1)>.txt',size:5}]};
  const editable=basicSampleList(7,category,true),readonly=basicSampleList(7,category);
  assert.match(editable,/&lt;img src=x onerror=alert\(1\)&gt;\.txt/);
  assert.doesNotMatch(editable,/<img/);
  assert.match(editable,/\/api\/basic-categories\/2\/samples\/3\?siteId=7/);
  assert.match(editable,/data-sample-delete="3"/);
  assert.doesNotMatch(readonly,/data-sample-delete/);
  assert.throws(()=>basicSampleList(7,{id:2,samples:[{id:'1" onclick="bad',size:5}]}),/목록/);
});

test('샘플은 현장과 분류에 묶이고 오래된 분류 삭제는 파일을 지우지 않는다',()=>{
  const s=new Store(':memory:');
  try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),root=s.saveBasicCategory(site.id,{name:'대분류'}),child=s.saveBasicCategory(site.id,{name:'소분류',parentId:root}),foreign=s.saveBasicCategory(other.id,{name:'다른 분류'}),row=id=>s.basicCategories(site.id).find(item=>item.id===id),version=()=>row(child).sampleTargetVersion,snapshot=()=>{const selected=s.basicCategories(site.id).filter(item=>item.id===root||item.parent_id===root);return {expectedCategories:selected,expectedDocumentVersions:selected.flatMap(item=>item.documentVersions),expectedSampleIds:selected.flatMap(item=>item.samples.map(file=>file.id))};};
    const doc=s.createDocument({siteId:site.id,type:'basic',title:'가상 서류',date:'2026-10-31',details:{categoryId:child}}),before=snapshot(),oldVersion=version(),file=s.addBasicCategorySample(site.id,child,'가상.txt',Buffer.from('가상 내용'),oldVersion);
    assert.equal(row(child).samples[0].name,'가상.txt');assert.equal(Buffer.from(s.basicCategorySample(site.id,child,file).data).toString(),'가상 내용');
    assert.equal(s.basicCategorySample(other.id,child,file),null);assert.equal(s.basicCategorySample(site.id,root,file),null);
    assert.throws(()=>s.deleteBasicCategory(site.id,root,before),/샘플/);assert.ok(s.document(doc.id));assert.ok(s.basicCategorySample(site.id,child,file));
    assert.throws(()=>s.deleteBasicCategory(site.id,root,{...snapshot(),expectedSampleIds:undefined}),/샘플/);
    assert.throws(()=>s.deleteBasicCategory(site.id,root,snapshot(),()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.throws(()=>s.deleteBasicCategorySample(other.id,child,file),/샘플/);
    assert.throws(()=>s.deleteBasicCategorySample(site.id,child,file,()=>{throw Error('세션 만료');}),/세션 만료/);
    s.saveBasicCategory(site.id,{name:'바뀐 대분류'},root);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'가상.txt',Buffer.from('내용'),oldVersion),error=>error.sessionStatus===409);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'../bad',Buffer.from('내용'),version()),/이름/);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'bad\\\\name',Buffer.from('내용'),version()),/이름/);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'빈 파일',Buffer.alloc(0),version()),/파일/);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'큰 파일',Buffer.alloc(2*1024*1024+1),version()),/파일/);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'가상.txt',Buffer.from('내용'),version(),()=>{throw Error('세션 만료');}),/세션 만료/);
    for(let i=0;i<19;i++)s.addBasicCategorySample(site.id,child,'가상 '+i+'.txt',Buffer.from('x'),version());
    assert.equal(row(child).samples.length,20);
    assert.throws(()=>s.addBasicCategorySample(site.id,child,'초과.txt',Buffer.from('x'),version()),/20개/);
    const otherFile=s.addBasicCategorySample(other.id,foreign,'다른 현장.txt',Buffer.from('다른 내용'),s.basicCategories(other.id)[0].sampleTargetVersion);
    s.db.exec("CREATE TRIGGER fail_sample_category_delete BEFORE DELETE ON basic_categories BEGIN SELECT RAISE(ABORT,'시험 실패'); END");
    assert.throws(()=>s.deleteBasicCategory(site.id,root,snapshot()),/시험 실패/);assert.ok(s.basicCategorySample(site.id,child,file));assert.ok(s.document(doc.id));
    s.db.exec('DROP TRIGGER fail_sample_category_delete');s.deleteBasicCategory(site.id,root,snapshot());
    assert.equal(s.basicCategorySample(site.id,child,file),null);assert.ok(s.basicCategorySample(other.id,foreign,otherFile));assert.equal(s.document(doc.id),undefined);assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{s.close();}
});

test('샘플 API는 관리자만 접근하고 서버 재시작 뒤에도 파일을 보존한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-basic-samples-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  try{
    await start();const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await login();const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json(),cats=`/api/basic-categories?siteId=${site.id}`,category=(await (await send(cats,'POST',{name:'가상 분류'},admin)).json()).id,find=async()=>(await (await send(cats,'GET',undefined,admin)).json()).find(item=>item.id===category),info=await find(),base=`/api/basic-categories/${category}/samples`,upload=async(cookie,version=info.sampleTargetVersion,name='가상.txt',siteId=site.id)=>fetch(root+`${base}?siteId=${siteId}&expectedVersion=${version}`,{method:'POST',headers:{...(cookie?{cookie}:{}),'x-file-name':encodeURIComponent(name)},body:'가상 샘플'});
    assert.equal((await upload()).status,401);assert.equal((await fetch(root+'/basic-samples.js')).status,200);assert.equal((await upload(admin,info.sampleTargetVersion,'../금지.txt')).status,400);assert.equal((await upload(admin,info.sampleTargetVersion,'가상.txt',other.id)).status,400);
    const created=await upload(admin);assert.equal(created.status,201);const file=(await created.json()).id,path=`${base}/${file}?siteId=${site.id}`;assert.equal((await send(path)).status,401);
    let download=await send(path,'GET',undefined,admin);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.equal(await download.text(),'가상 샘플');
    assert.equal((await send(`${base}/${file}?siteId=${other.id}`,'GET',undefined,admin)).status,404);assert.equal((await send(`${base}/${file}?siteId=${other.id}`,'DELETE',undefined,admin)).status,400);
    const selected=[await find()],deletion={expectedCategories:selected,expectedDocumentVersions:[],expectedSampleIds:[]},catPath=`/api/basic-categories/${category}?siteId=${site.id}`;
    assert.equal((await send(catPath,'DELETE',deletion,admin)).status,400);assert.equal((await send(path,'GET',undefined,admin)).status,200);
    assert.equal((await send(catPath,'PUT',{name:'바뀐 분류'},admin)).status,200);assert.equal((await upload(admin,info.sampleTargetVersion)).status,409);
    await stop();await start();admin=await login();assert.equal((await find()).samples[0].id,file);download=await send(path,'GET',undefined,admin);assert.equal(await download.text(),'가상 샘플');
    assert.equal((await send(path,'DELETE',undefined,admin)).status,200);assert.equal((await send(path,'GET',undefined,admin)).status,404);
  }finally{await stop();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('쓰기 대기 중 분류와 샘플이 바뀌면 이전 요청은 저장·삭제하지 않는다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-basic-samples-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const module=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(module)};for(const name of ['addBasicCategorySample','deleteBasicCategory']){const original=Store.prototype[name];Store.prototype[name]=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write(name==='addBasicCategorySample'?'SAMPLE_ADD_LOCK':'SAMPLE_DELETE_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),cats=`/api/basic-categories?siteId=${site.id}`,category=(await (await send(cats,'POST',{name:'원래 분류'},admin)).json()).id,info=(await (await send(cats,'GET',undefined,admin)).json())[0],base=`/api/basic-categories/${category}`;
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;let entered=once(child.stdout,'data'),pending=fetch(root+`${base}/samples?siteId=${site.id}&expectedVersion=${info.sampleTargetVersion}`,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'virtual'});pending.catch(()=>{});assert.match(String((await entered)[0]),/SAMPLE_ADD_LOCK/);db.prepare('UPDATE basic_categories SET name=? WHERE id=?').run('바뀐 분류',category);db.exec('COMMIT');locked=false;assert.equal((await pending).status,409);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM basic_category_samples').get().n,0);
    const current=(await (await send(cats,'GET',undefined,admin)).json())[0],input={expectedCategories:[current],expectedDocumentVersions:[],expectedSampleIds:[]};
    db.exec('BEGIN IMMEDIATE');locked=true;entered=once(child.stdout,'data');pending=send(`${base}?siteId=${site.id}`,'DELETE',input,admin);pending.catch(()=>{});assert.match(String((await entered)[0]),/SAMPLE_DELETE_LOCK/);db.prepare('INSERT INTO basic_category_samples(category_id,name,data) VALUES(?,?,?)').run(category,'새 샘플.txt',Buffer.from('가상'));db.exec('COMMIT');locked=false;assert.equal((await pending).status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM basic_categories WHERE id=?').get(category).n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM basic_category_samples WHERE category_id=?').get(category).n,1);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

