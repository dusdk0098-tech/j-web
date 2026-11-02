import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

test('공지 첨부 복사는 별도 DB 작성자의 잠금 뒤 상태·현장·파일·한도·세션을 다시 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-copy-lock-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href;
  const trace="import {Store} from "+JSON.stringify(source)+";const original=Store.prototype.copyNoticeAttachments;Store.prototype.copyNoticeAttachments=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE'||sql==='SAVEPOINT copy_notice_attachments')process.stdout.write('COPY_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}";
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(trace),'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base='http://127.0.0.1:'+port,send=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
    const cookie=(await send('/api/login',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await (await send('/api/sites',{name:'가상 현장'},cookie)).json(),other=await (await send('/api/sites',{name:'다른 가상 현장'},cookie)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const scenario of ['target-approved','source-draft','source-site','target-site','source-date','empty-source','file-limit','changed-file','session-revoked']){
      const make=async date=>{const response=await send('/api/documents',{siteId:site.id,type:'notice',title:'가상 공지',date,body:'가상 본문'},cookie);assert.equal(response.status,201);return response.json();};
      const from=await make('2024-01-01'),to=await make('2024-01-02');
      const insert=db.prepare("INSERT INTO attachments(document_id,name,data,category) VALUES(?,?,?,'general')");insert.run(from.id,'가상.txt',Buffer.from('before'));
      db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(from.id);
      db.exec('BEGIN IMMEDIATE');locked=true;
      const waiting=once(child.stdout,'data'),pending=send('/api/documents/'+to.id+'/copy-notice-files',{sourceId:from.id},cookie);pending.catch(()=>{});
      assert.match(String((await waiting)[0]),/COPY_LOCK/);
      if(scenario==='target-approved')db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(to.id);
      if(scenario==='source-draft')db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(from.id);
      if(scenario==='source-site'||scenario==='target-site')db.prepare('UPDATE documents SET site_id=? WHERE id=?').run(other.id,scenario==='source-site'?from.id:to.id);
      if(scenario==='source-date')db.prepare("UPDATE documents SET date='2024-01-03' WHERE id=?").run(from.id);
      if(scenario==='empty-source')db.prepare('DELETE FROM attachments WHERE document_id=?').run(from.id);
      if(scenario==='file-limit')for(let i=0;i<20;i++)insert.run(to.id,`가상${i}.txt`,Buffer.from('existing'));
      if(scenario==='changed-file'){db.prepare('DELETE FROM attachments WHERE document_id=?').run(from.id);insert.run(from.id,'현재.txt',Buffer.from('after'));insert.run(from.id,'추가.txt',Buffer.from('new'));}
      if(scenario==='session-revoked')db.exec('DELETE FROM admin_sessions');
      db.exec('COMMIT');locked=false;
      const response=await pending,body=await response.json(),files=db.prepare('SELECT name,data FROM attachments WHERE document_id=? ORDER BY id').all(to.id);
      if(scenario==='changed-file'){assert.equal(response.status,200,scenario);assert.deepEqual(body,{copied:2});assert.deepEqual(files.map(row=>[row.name,Buffer.from(row.data).toString()]),[['현재.txt','after'],['추가.txt','new']]);}
      else{assert.equal(response.status,scenario==='session-revoked'?401:400,scenario+': '+JSON.stringify(body));assert.equal(files.length,scenario==='file-limit'?20:0,scenario);}
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
