import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';

test('근로자 자료 첨부 조회 중 세션 종료 또는 공개 중지 시 파일을 반환하지 않는다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-article-race-')),store=new Store(join(dir,'jweb.sqlite')),site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id),password='virtual-password-123',worker=store.join(invite.token,{name:'가상 근로자',category:'직영',company:'',occupation:'가상 직종',loginId:'article_race',password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),article=store.saveSiteArticle({siteId:site.id,category:'기타',title:'가상 자료',body:'가상 내용',visible:true}),file=store.addArticleFile(site.id,article.id,'가상.txt',Buffer.from('가상 파일'));
  store.db.exec('CREATE TABLE article_read_probe(action TEXT)');
  const module=pathToFileURL(join(process.cwd(),'store.js')).href,probe=`
    import {Store} from ${JSON.stringify(module)};
    import {DatabaseSync} from 'node:sqlite';
    import {join} from 'node:path';
    const original=Store.prototype.workerArticleFile;
    Store.prototype.workerArticleFile=function(...args){
      const result=original.apply(this,args),row=this.db.prepare('SELECT action FROM article_read_probe').get();
      if(row){const db=new DatabaseSync(join(process.env.JWEB_DATA_DIR,'jweb.sqlite'));if(row.action==='revoke')db.prepare('DELETE FROM worker_sessions WHERE worker_id=?').run(args[0]);if(row.action==='hide')db.prepare('UPDATE site_articles SET visible=0 WHERE id=?').run(args[1]);db.exec('DELETE FROM article_read_probe');db.close();}
      return result;
    };`;
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(probe)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,login=async()=>{const res=await fetch(base+'/api/worker/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:invite.token,loginId:'article_race',password})});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];},path=base+`/api/worker/articles/${article.id}/files/${file}`;
    let cookie=await login();assert.equal(await (await fetch(path,{headers:{cookie}})).text(),'가상 파일');
    store.db.prepare('INSERT INTO article_read_probe(action) VALUES(?)').run('revoke');assert.equal((await fetch(path,{headers:{cookie}})).status,401);
    cookie=await login();store.db.prepare('INSERT INTO article_read_probe(action) VALUES(?)').run('hide');assert.equal((await fetch(path,{headers:{cookie}})).status,404);assert.equal(store.workerArticleFile(worker.id,article.id,file),null);
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
