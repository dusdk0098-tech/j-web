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

test('게시글 저장 대기 중 다른 변경이나 세션 폐기가 발생하면 기존 내용을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-race-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.saveReviewerBoardPost;Store.prototype.saveReviewerBoardPost=function(...args){const db=this.db,exec=db.exec;db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('BOARD_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'board_race',name:'가상 작성자',password:'virtual-password-123'},admin)).json(),cookie=(await send('/api/reviewer/login','POST',{loginId:'board_race',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const first='a'.repeat(32),second='b'.repeat(32),id=db.prepare('INSERT INTO board_posts(kind,title,body,secret,author_id,author_name,shared,version) VALUES(?,?,?,?,?,?,?,?)').run('question','기존 글','비밀 내용',1,reviewer.id,'가상 작성자',1,first).lastInsertRowid,path=`/api/reviewer/board-posts/${id}`,input={kind:'question',title:'오래된 수정',body:'변경 내용',secret:true,version:first};
    db.exec('BEGIN IMMEDIATE');locked=true;const firstLock=once(child.stdout,'data'),pending=send(path,'PUT',input,cookie);pending.catch(()=>{});assert.match(String((await firstLock)[0]),/BOARD_LOCK/);db.prepare('UPDATE board_posts SET title=?,version=? WHERE id=?').run('먼저 저장된 글',second,id);db.exec('COMMIT');locked=false;assert.equal((await pending).status,409);assert.equal(db.prepare('SELECT title FROM board_posts WHERE id=?').get(id).title,'먼저 저장된 글');
    db.exec('BEGIN IMMEDIATE');locked=true;const secondLock=once(child.stdout,'data'),revoked=send(path,'PUT',{...input,version:second},cookie);revoked.catch(()=>{});assert.match(String((await secondLock)[0]),/BOARD_LOCK/);db.prepare('DELETE FROM reviewer_sessions WHERE reviewer_id=?').run(reviewer.id);db.exec('COMMIT');locked=false;assert.equal((await revoked).status,401);assert.equal(db.prepare('SELECT title FROM board_posts WHERE id=?').get(id).title,'먼저 저장된 글');
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
