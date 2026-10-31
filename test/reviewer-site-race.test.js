import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

test('직원 점검 서명 조회 도중 소속이 바뀌면 이전 현장의 서명을 반환하지 않는다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reviewer-site-')),store=new Store(join(dir,'jweb.sqlite')),password='virtual-password-123',site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),reviewer=store.createReviewer({siteId:site.id,loginId:'site_race',name:'가상 직원',password}),date='2026-10-31';
  const png=new PNG({width:1,height:1});png.data[3]=255;
  store.saveReviewerManagerCheck(reviewer.id,date,{kind:'check',answers:[{answer:'O',note:''},{answer:'O',note:''},{answer:'O',note:''}],signature:'data:image/png;base64,'+PNG.sync.write(png).toString('base64')});
  store.db.exec('CREATE TABLE site_read_probe(target INTEGER)');
  const module=pathToFileURL(join(process.cwd(),'store.js')).href,probe=`
    import {Store} from ${JSON.stringify(module)};
    import {DatabaseSync} from 'node:sqlite';
    import {join} from 'node:path';
    const original=Store.prototype.siteReviewerManagerSignature;
    Store.prototype.siteReviewerManagerSignature=function(...args){
      const result=original.apply(this,args),row=this.db.prepare('SELECT target FROM site_read_probe').get();
      if(row){const db=new DatabaseSync(join(process.env.JWEB_DATA_DIR,'jweb.sqlite'));db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(row.target,args[1]);db.exec('DELETE FROM site_read_probe');db.close();}
      return result;
    };`;
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(probe)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/api/reviewer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId:reviewer.login_id,password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],path=base+`/api/reviewer/manager-checks/signature?date=${date}`;
    assert.equal((await fetch(path,{headers:{cookie}})).status,200);
    store.db.prepare('INSERT INTO site_read_probe(target) VALUES(?)').run(other.id);
    const result=await fetch(path,{headers:{cookie}});assert.equal(result.status,401);assert.deepEqual(await result.json(),{error:'결재자 로그인이 필요합니다.'});assert.equal(store.reviewer(reviewer.id).site_id,other.id);
    assert.equal((await fetch(path,{headers:{cookie}})).status,404);
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
