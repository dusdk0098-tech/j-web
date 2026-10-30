import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { PersonalNotes } from '../personal-notes.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('가상 개인업무는 현장과 버전을 검증하며 확인 후 변경을 막는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-personal-')),path=join(dir,'data.sqlite');let store;try{
    store=new Store(path);let notes=new PersonalNotes(store.db);const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),input={siteId:site.id,date:'2026-10-30',content:'가상 업무 내용',private:true};
    assert.throws(()=>notes.create({...input,content:''}),/내용/);assert.throws(()=>notes.create({...input,private:'true'}),/비공개/);assert.throws(()=>notes.create(input,()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(notes.list(site.id),[]);
    const first=notes.create(input);assert.equal(notes.list(other.id).length,0);assert.equal(notes.list(site.id,'2026-10-01','2026-10-31','업무').length,1);assert.equal(notes.list(site.id,'2026-11-01').length,0);
    assert.throws(()=>notes.update(other.id,first.id,{...input,version:first.version}),/기록/);assert.throws(()=>notes.addFile(site.id,first.id,first.version,'../file',Buffer.from('가상')),/이름/);assert.throws(()=>notes.addFile(site.id,first.id,first.version,'x.txt',Buffer.alloc(0)),/파일/);
    const file=notes.addFile(site.id,first.id,first.version,'가상.txt',Buffer.from('첨부'));assert.equal(Buffer.from(notes.file(site.id,first.id,file.id).data).toString(),'첨부');assert.equal(notes.file(other.id,first.id,file.id),null);
    assert.throws(()=>notes.update(site.id,first.id,{...input,version:first.version}),/변경/);let current=notes.get(site.id,first.id);assert.throws(()=>notes.removeFile(site.id,first.id,file.id,first.version),/변경/);
    const updated=notes.update(site.id,first.id,{...input,content:'수정 내용',version:current.version});assert.equal(updated.content,'수정 내용');store.close();store=new Store(path);notes=new PersonalNotes(store.db);current=notes.get(site.id,first.id);assert.equal(current.content,'수정 내용');assert.equal(notes.files(site.id,first.id).length,1);
    const checked=notes.check(site.id,first.id,current.version);assert.equal(checked.checked,1);assert.throws(()=>notes.update(site.id,first.id,{...input,version:checked.version}),/확인된/);assert.throws(()=>notes.remove(site.id,first.id,checked.version),/확인된/);assert.throws(()=>notes.addFile(site.id,first.id,checked.version,'새 파일',Buffer.from('x')),/확인된/);assert.throws(()=>notes.removeFile(site.id,first.id,file.id,checked.version),/확인된/);assert.equal(Buffer.from(notes.file(site.id,first.id,file.id).data).toString(),'첨부');
    const second=notes.create({...input,private:false});notes.addFile(site.id,second.id,second.version,'삭제.txt',Buffer.from('x'));current=notes.get(site.id,second.id);notes.remove(site.id,second.id,current.version);assert.equal(notes.get(site.id,second.id),null);assert.equal(store.db.prepare('SELECT count(*) AS n FROM personal_note_files WHERE note_id=?').get(second.id).n,0);
  }finally{if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});

test('가상 개인업무 API는 관리자 인증, 현장 및 첨부 버전을 지킨다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-personal-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),input={siteId:site.id,date:'2026-10-30',content:'가상 일지',private:true};
    assert.equal((await call('/api/personal-notes','POST',input)).status,401);const created=await call('/api/personal-notes','POST',input,admin);assert.equal(created.status,201);const note=await created.json(),path=`/api/personal-notes/${note.id}`,upload=`${path}/files?siteId=${site.id}&version=${note.version}`;
    const sent=await fetch(base+upload,{method:'POST',headers:{cookie:admin,'x-file-name':encodeURIComponent('가상.txt')},body:'가상 첨부'});assert.equal(sent.status,201);const file=(await sent.json()).id,filePath=`${path}/files/${file}?siteId=${site.id}`;assert.equal((await call(filePath)).status,401);assert.equal((await call(filePath.replace(`siteId=${site.id}`,`siteId=${other.id}`),'GET',null,admin)).status,404);assert.equal(await (await call(filePath,'GET',null,admin)).text(),'가상 첨부');
    assert.equal((await call(path,'PUT',{...input,content:'오래된 수정',version:note.version},admin)).status,409);const listed=await (await call(`/api/personal-notes?siteId=${site.id}`,'GET',null,admin)).json();assert.equal(listed[0].files.length,1);const checked=await call(path+'/check','POST',{siteId:site.id,version:listed[0].version},admin);assert.equal(checked.status,200);const current=await checked.json();assert.equal((await call(path,'DELETE',{siteId:site.id,version:current.version},admin)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
