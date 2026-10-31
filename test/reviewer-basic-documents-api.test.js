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

test('직원 기본 서류 API는 현재 소속·승인·공유와 응답 직전 세션을 확인한다',{timeout:60000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reviewer-basic-')),store=new Store(join(dir,'jweb.sqlite')),password='virtual-basic-password',site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 가상 현장'}),person=store.createReviewer({siteId:site.id,loginId:'basic_reader',name:'가상 직원',password});
  const make=(siteId,status,shared=false,type='basic')=>{
    const doc=store.createDocument({siteId,type,title:`가상 ${type} ${status}`,date:'2026-10-31',body:'가상 본문',details:type==='basic'?{category:'가상 분류',shared}:{}}),file=Number(store.addAttachment(doc.id,'가상 자료 (시험).txt',Buffer.from(`가상 파일 ${doc.id}`)));
    store.db.prepare('UPDATE documents SET status=? WHERE id=?').run(status,doc.id);return {...doc,file};
  };
  const own=make(site.id,'approved'),shared=make(other.id,'approved',true),privateDoc=make(other.id,'approved'),hidden=[privateDoc,...['draft','pending','rejected'].flatMap(status=>[make(site.id,status),make(other.id,status,true)]),make(site.id,'approved',false,'notice')];
  store.db.exec('CREATE TABLE basic_read_probe(action TEXT)');
  const module=pathToFileURL(join(process.cwd(),'store.js')).href,probe=`
    import {Store} from ${JSON.stringify(module)};
    import {spawnSync} from 'node:child_process';
    import {join} from 'node:path';
    for(const name of ['reviewerBasicDocuments','reviewerBasicDocument','reviewerBasicAttachment']){
      const original=Store.prototype[name];
      Store.prototype[name]=function(...args){
        const result=original.apply(this,args),action=this.db.prepare('SELECT action FROM basic_read_probe').get()?.action;
        if(action){
          this.db.exec('DELETE FROM basic_read_probe');
          const sql={revoke:'DELETE FROM reviewer_sessions',deactivate:'UPDATE reviewers SET active=0',expire:'UPDATE reviewer_sessions SET expires=0',move:'UPDATE reviewers SET site_id=(SELECT MAX(id) FROM sites)'}[action];
          const script="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec(process.argv[2]);db.close();";
          const child=spawnSync(process.execPath,['-e',script,join(process.env.JWEB_DATA_DIR,'jweb.sqlite'),sql]);
          if(child.status!==0)throw Error('별도 프로세스 세션 변경 실패');
        }
        return result;
      };
    }`;
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(probe)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,base='/api/reviewer/basic-documents',send=(path,cookie,method='GET',data)=>fetch(root+path,{method,headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=async()=>{const res=await send('/api/reviewer/login',null,'POST',{loginId:person.login_id,password});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];};let cookie=await login();
    const paths=[base,`${base}/${own.id}`,`${base}/${own.id}/attachments/${own.file}`];
    await t.test('비로그인·관리자·근로자 쿠키는 직원 자료에 접근하지 못한다',async()=>{
      const admin=(await send('/api/login',null,'POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
      const invitation=await (await send(`/api/sites/${site.id}/invitation`,admin,'POST',{})).json(),token=new URL(invitation.link).searchParams.get('token'),registration={token,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'basic_worker',password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
      assert.equal((await send('/api/join',null,'POST',registration)).status,201);const workerLogin=await send('/api/worker/login',null,'POST',{token,loginId:registration.loginId,password});assert.equal(workerLogin.status,200);const workerCookie=workerLogin.headers.get('set-cookie').split(';')[0];
      for(const path of paths)for(const invalid of [undefined,admin,workerCookie])assert.equal((await send(path,invalid)).status,401);
      const asset=await send('/reviewer-basic-documents.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
    });
    await t.test('목록·상세·파일은 승인된 소속 현장과 다른 현장 공유 자료만 제공한다',async()=>{
      const res=await send(base+`?siteId=${other.id}&reviewerId=999999`,cookie);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');const payload=await res.json();assert.deepEqual(payload.documents.map(x=>x.id),[shared.id,own.id]);
      assert.deepEqual(Object.keys(payload.documents[0]).sort(),['category','date','id','shared','site_id','title']);assert.equal(payload.documents[0].shared,true);assert.equal(payload.documents[1].shared,false);
      for(const doc of [own,shared]){const detail=await (await send(`${base}/${doc.id}`,cookie)).json();assert.equal(detail.document.body,'가상 본문');assert.deepEqual(detail.attachments,[{id:doc.file,name:'가상 자료 (시험).txt'}]);assert.deepEqual(Object.keys(detail.document).sort(),['body','category','date','id','shared','site_id','title']);const file=await send(`${base}/${doc.id}/attachments/${doc.file}`,cookie);assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'application/octet-stream');assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.equal(file.headers.get('cache-control'),'no-store');assert.match(file.headers.get('content-disposition'),/^attachment; filename="attachment"; filename\*=UTF-8''/);assert.ok(file.headers.get('content-disposition').includes('%28'));assert.equal(await file.text(),`가상 파일 ${doc.id}`);}
      const missing=await (await send(`${base}/999999`,cookie)).json();for(const doc of hidden){const denied=await send(`${base}/${doc.id}`,cookie);assert.equal(denied.status,404);assert.deepEqual(await denied.json(),missing);assert.equal((await send(`${base}/${doc.id}/attachments/${doc.file}`,cookie)).status,404);}
      assert.equal((await send(`${base}/${own.id}/attachments/${shared.file}`,cookie)).status,404);assert.equal((await send(`${base}/${shared.id}/attachments/${privateDoc.file}`,cookie)).status,404);assert.equal((await send(`/api/reviewer/documents/${own.id}`,cookie)).status,404);
      assert.equal((await send(`${base}/${own.id}`,cookie,'DELETE')).status,404);assert.ok(store.document(own.id));
    });
    await t.test('조회 후 공유·승인·소속 변경은 다음 상세와 직접 파일 주소에 반영된다',async()=>{
      store.db.prepare("UPDATE documents SET details=json_set(details,'$.shared',0) WHERE id=?").run(shared.id);
      for(const path of [`${base}/${shared.id}`,`${base}/${shared.id}/attachments/${shared.file}`])assert.equal((await send(path,cookie)).status,404);
      for(const status of ['draft','pending','rejected']){store.db.prepare('UPDATE documents SET status=? WHERE id=?').run(status,own.id);assert.equal((await send(`${base}/${own.id}`,cookie)).status,404);assert.equal((await send(`${base}/${own.id}/attachments/${own.file}`,cookie)).status,404);}
      store.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(own.id);store.db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(other.id,person.id);
      const rows=(await (await send(base,cookie)).json()).documents;assert.deepEqual(rows.map(x=>x.id),[privateDoc.id,shared.id]);assert.equal((await send(`${base}/${own.id}`,cookie)).status,404);assert.equal((await send(`${base}/${own.id}/attachments/${own.file}`,cookie)).status,404);assert.equal((await send(`${base}/${privateDoc.id}`,cookie)).status,200);
      store.db.prepare('UPDATE reviewers SET site_id=? WHERE id=?').run(site.id,person.id);
    });
    await t.test('다른 프로세스가 조회 직후 계정 중지·세션 폐기·만료·소속 변경을 확정하면 응답을 차단한다',async()=>{
      for(const action of ['revoke','deactivate','expire','move'])for(const path of paths){store.db.prepare('UPDATE reviewers SET active=1,site_id=? WHERE id=?').run(site.id,person.id);cookie=await login();store.db.prepare('INSERT INTO basic_read_probe(action) VALUES(?)').run(action);const result=await send(path,cookie);assert.equal(result.status,401,`${action}: ${path}`);assert.deepEqual(await result.json(),{error:'결재자 로그인이 필요합니다.'});assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM basic_read_probe').get().n,0);if(action!=='move')assert.equal((await send(path,cookie)).status,401);}
    });
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
