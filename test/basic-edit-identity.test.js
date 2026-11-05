import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
const input={type:'basic',title:'가상 기본서류',date:'2026-11-01',body:'가상 본문',details:{category:'가상 분류'}};
const conflict=e=>e.sessionStatus===409;
for(const mode of ['개별','분류'])test(`${mode} 삭제 후 같은 ID와 숫자 버전에도 과거 편집 차단`,()=>{
 const s=new Store(':memory:');try{
 const site=s.createSite({name:'가상 현장'}),category=s.saveBasicCategory(site.id,{name:'가상 분류'}),value={...input,siteId:site.id,details:{categoryId:category}},old=s.createDocument(value);
 if(mode==='개별')s.deleteBasicDocument(site.id,old.id,old.basic_version);else{const rows=s.basicCategories(site.id);s.deleteBasicCategory(site.id,category,{expectedCategories:rows,expectedDocumentVersions:rows.flatMap(r=>r.documentVersions)});}
 const fresh=s.createDocument({...input,siteId:site.id});assert.equal(fresh.id,old.id);assert.equal(fresh.edit_version,old.edit_version);assert.notEqual(fresh.basic_version,old.basic_version);
 const edit={...input,siteId:site.id,title:'늦은 편집',expectedEditVersion:old.edit_version};
 for(const version of [undefined,null,0,{},[],old.basic_version,'']){assert.throws(()=>s.updateDocument(old.id,{...edit,expectedBasicVersion:version}),conflict);assert.deepEqual(s.document(fresh.id),fresh);}
 assert.throws(()=>s.updateDocument(old.id,{...edit,expectedBasicVersion:fresh.basic_version},()=>s.db.prepare("UPDATE basic_document_versions SET version='changed-in-lock' WHERE document_id=?").run(old.id)),conflict);assert.deepEqual(s.document(fresh.id),fresh);
 for(const change of [{siteId:999},{type:'tbm'}])assert.throws(()=>s.updateDocument(old.id,{...edit,expectedBasicVersion:fresh.basic_version,...change}),/현장과 유형/);
 const next=s.updateDocument(fresh.id,{...edit,expectedBasicVersion:fresh.basic_version});assert.equal(next.title,'늦은 편집');assert.notEqual(next.basic_version,fresh.basic_version);
 }finally{s.close();}
});
test('기존 DB 버전 백필과 백업 복원에서 문서·버전 보존',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-basic-identity-')),path=join(dir,'jweb.sqlite');let s;
 try{s=new Store(path);const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({...input,siteId:site.id});s.db.exec('DELETE FROM basic_document_versions');s.close();s=new Store(path);const restored=s.document(doc.id);assert.match(restored.basic_version,/^[a-f0-9]{32}$/);assert.equal(restored.body,doc.body);assert.equal(restored.edit_version,doc.edit_version);s.close();s=null;
 const backup=join(dir,'backup.sqlite'),out=join(dir,'restore');mkdirSync(out);for(const args of [['backup',backup],['restore',backup,out]]){const result=spawnSync(process.execPath,['db-copy.js',...args],{env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 s=new Store(join(out,'jweb.sqlite'));assert.deepEqual(s.document(doc.id),restored);const value={...input,siteId:site.id,expectedEditVersion:restored.edit_version,expectedBasicVersion:restored.basic_version};assert.equal(s.updateDocument(doc.id,value).body,input.body);
 }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
test('관리자 API 두 삭제 경로에서 ABA는 409, 최신 저장 200, 비인증 401',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-basic-api-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const call=(path,method='GET',body,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const cookie=(await call('/api/login','POST',{password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],site=await(await call('/api/sites','POST',{name:'가상 현장'},cookie)).json();
 for(const mode of ['개별','분류']){const category=await(await call(`/api/basic-categories?siteId=${site.id}`,'POST',{name:'가상 분류 '+mode},cookie)).json(),value={...input,siteId:site.id,details:{categoryId:category.id}},old=await(await call('/api/documents','POST',value,cookie)).json(),path=`/api/documents/${old.id}`;
 if(mode==='개별')assert.equal((await call(path,'DELETE',{siteId:site.id,expectedVersion:old.basic_version},cookie)).status,200);else{const rows=await(await call(`/api/basic-categories?siteId=${site.id}`,'GET',null,cookie)).json(),selected=rows.filter(r=>r.id===category.id);assert.equal((await call(`/api/basic-categories/${category.id}?siteId=${site.id}`,'DELETE',{expectedCategories:selected,expectedDocumentVersions:selected.flatMap(r=>r.documentVersions)},cookie)).status,200);}
 const fresh=await(await call('/api/documents','POST',{...input,siteId:site.id},cookie)).json();assert.equal(fresh.id,old.id);assert.equal(fresh.edit_version,old.edit_version);const edit={...input,siteId:site.id,title:'새 편집',expectedEditVersion:old.edit_version};for(const version of [undefined,null,0,{},old.basic_version])assert.equal((await call(path,'PUT',{...edit,expectedBasicVersion:version},cookie)).status,409);
 assert.equal((await call(path,'PUT',{...edit,expectedBasicVersion:fresh.basic_version})).status,401);for(const change of [{siteId:999},{type:'tbm'}])assert.equal((await call(path,'PUT',{...edit,expectedBasicVersion:fresh.basic_version,...change},cookie)).status,400);
 assert.deepEqual(await(await call(path,'GET',null,cookie)).json(),fresh);assert.equal((await call(path,'PUT',{...edit,expectedBasicVersion:fresh.basic_version},cookie)).status,200);const next=await(await call(path,'GET',null,cookie)).json();assert.equal(next.title,'새 편집');assert.equal((await call(path,'DELETE',{siteId:site.id,expectedVersion:next.basic_version},cookie)).status,200);
 }
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
test('실제 관리자 저장 요청은 basic 식별 버전을 보내고 409에서 입력 보존',async()=>{
 const source=readFileSync('public/app.js','utf8'),dialogCode=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick")),saveLine=source.split('\n').find(line=>line.includes('const result=await api(doc?')),nodes=Object.fromEntries(['#dialog-title','#dialog-body','#dialog-error','#dialog-form','#dialog-form button[type=submit]'].map(k=>[k,{}])),form=nodes['#dialog-form'];form.values={title:'보존 제목',body:'보존 본문'};let calls=0,sent;
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},ctx={$:k=>nodes[k],dialog,doc:{id:1,type:'basic',edit_version:0,basic_version:'old-identity'},state:{siteId:1},locked:[],FormData:class{constructor(f){return Object.entries(f.values);}},flash(){throw Error('성공 알림 금지');},render(){throw Error('화면 교체 금지');},api:async(path,options)=>{calls++;sent=JSON.parse(options.body);throw Error('문서 변경: 입력을 복사해 주세요.');}};
 runInNewContext(dialogCode+`;showDialog('편집','',async data=>{${saveLine}});`,ctx);await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(calls,1);assert.equal(sent.expectedBasicVersion,'old-identity');assert.equal(sent.expectedEditVersion,0);assert.equal(form.values.body,'보존 본문');assert.equal(dialog.open,true);assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);assert.match(nodes['#dialog-error'].textContent,/복사/);
});

test('기본서류 삭제 후 같은 ID의 다른 유형도 오래된 기본서류 저장을 거절한다',()=>{
 const s=new Store(':memory:');try{
 const site=s.createSite({name:'가상 현장'}),value={...input,siteId:site.id},old=s.createDocument(value);s.deleteBasicDocument(site.id,old.id,old.basic_version);
 const fresh=s.createDocument({...value,type:'tbm',details:{weather:'가상 날씨'}});assert.equal(fresh.id,old.id);assert.equal(fresh.edit_version,old.edit_version);
 assert.throws(()=>s.updateDocument(old.id,{...value,title:'늦은 기본서류',expectedEditVersion:old.edit_version,expectedBasicVersion:old.basic_version}),/현장과 유형/);assert.deepEqual(s.document(fresh.id),fresh);
 }finally{s.close();}
});
