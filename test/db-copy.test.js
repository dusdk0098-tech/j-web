import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { Store } from '../store.js';
import { WorkerSessions, ReviewerSessions } from '../auth.js';

const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
const run=(dataDir,...args)=>spawnSync(process.execPath,['db-copy.js',...args],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dataDir},encoding:'utf8',timeout:20000});
const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const documented=(dataDir,action,...args)=>existsSync(npmCli)?spawnSync(process.execPath,[npmCli,'run',action,'--',...args],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dataDir},encoding:'utf8',timeout:20000}):run(dataDir,action,...args);
const files=dir=>readdirSync(dir).filter(name=>name.startsWith('.jweb-copy-'));

test('실행 중 DB의 일관된 사본을 만들고 별도 폴더에서 문서와 첨부를 복원한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-db-copy-')),sourceDir=join(dir,'기존 자료'),backupDir=join(dir,'백업 자료'),restoreDir=join(dir,'복원 자료');for(const item of [sourceDir,backupDir,restoreDir])mkdirSync(item);
  const path=join(sourceDir,'jweb.sqlite'),archive=join(backupDir,'copy.sqlite');let store=new Store(path),child,locked=false;
  try{
    const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),reviewer=store.createReviewer({siteId:site.id,loginId:'virtual_reviewer',name:'가상 직원',password:'virtual-password-123'}),doc=store.createDocument({siteId:site.id,type:'tbm',title:'가상 문서',date:'2026-10-01',body:'가상 내용'}),attachment=store.addAttachment(doc.id,'가상.txt',Buffer.from('가상 첨부'));
    const invitation=store.createInvitation(site.id),siteKey=store.siteAccessKey(site.id);store.openSiteRegistration(site.id);
    const salt=Buffer.alloc(16,1);store.db.prepare('INSERT INTO worker_accounts(worker_id,site_id,login_id,salt,password_hash) VALUES(?,?,?,?,?)').run(worker.id,site.id,'virtual_worker',salt,scryptSync('virtual-password-123',salt,32));
    const workerToken='A'.repeat(43),reviewerToken='B'.repeat(43),hash=token=>createHash('sha256').update(token).digest('hex'),workerHash=hash(workerToken),reviewerHash=hash(reviewerToken),expires=Date.now()+3600000;
    const workerSessions=new WorkerSessions(store.db),reviewerSessions=new ReviewerSessions(store.db),credential=store.db.prepare('SELECT password_hash,auth_version FROM reviewers WHERE id=?').get(reviewer.id);
    workerSessions.set(workerHash,{worker:{id:worker.id,site_id:site.id},expires});assert.ok(workerSessions.get(workerHash));
    assert.equal(reviewerSessions.issue(reviewerHash,{id:reviewer.id,expires},credential.password_hash,credential.auth_version),true);assert.ok(reviewerSessions.get(reviewerHash));
    store.db.exec('BEGIN IMMEDIATE');locked=true;store.createDocument({siteId:site.id,type:'tbm',title:'아직 저장 중',date:'2026-10-02'});
    const backup=documented(sourceDir,'backup',archive);assert.equal(backup.status,0,backup.stderr);store.db.exec('COMMIT');locked=false;
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n,1);
    const snapshot=new DatabaseSync(archive,{readOnly:true});try{
      assert.equal(snapshot.prepare('SELECT count(*) AS n FROM documents').get().n,1);assert.equal(snapshot.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,0);assert.equal(snapshot.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n,0);
      assert.deepEqual(Buffer.from(snapshot.prepare('SELECT data FROM attachments WHERE id=?').get(attachment).data),Buffer.from('가상 첨부'));
      assert.equal(snapshot.prepare('SELECT access_key FROM site_access WHERE site_id=?').get(site.id).access_key,siteKey);assert.equal(snapshot.prepare('SELECT revoked FROM invitations').get().revoked,0);
    }finally{snapshot.close();}
    const bytes=readFileSync(archive);assert.equal(bytes.indexOf(Buffer.from(workerHash)),-1);assert.equal(bytes.indexOf(Buffer.from(reviewerHash)),-1);
    store.db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');store.createDocument({siteId:site.id,type:'tbm',title:'가상 WAL 문서',date:'2026-10-03'});
    assert.equal(existsSync(path+'-wal'),true);const walArchive=join(backupDir,'wal.sqlite'),walCopy=documented(sourceDir,'backup',walArchive);assert.equal(walCopy.status,0,walCopy.stderr);
    const walSnapshot=new DatabaseSync(walArchive,{readOnly:true});try{assert.equal(walSnapshot.prepare("SELECT count(*) AS n FROM documents WHERE title='가상 WAL 문서'").get().n,1);}finally{walSnapshot.close();}
    const restore=documented(sourceDir,'restore',archive,restoreDir);assert.equal(restore.status,0,restore.stderr);
    const restored=new Store(join(restoreDir,'jweb.sqlite'));try{
      assert.equal(restored.document(doc.id).title,'가상 문서');assert.deepEqual(Buffer.from(restored.attachment(attachment).data),Buffer.from('가상 첨부'));
      assert.equal(restored.db.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,0);assert.equal(restored.db.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n,0);
      assert.equal(restored.siteFromAccess(siteKey),null);assert.match(restored.siteAccessKey(site.id),/^[\w-]{43}$/);assert.notEqual(restored.siteAccessKey(site.id),siteKey);
      assert.equal(restored.invitation(invitation.token),null);assert.equal(restored.siteRegistrationOpen(site.id),false);
    }finally{restored.close();}
    assert.equal(store.siteFromAccess(siteKey).id,site.id);assert.equal(store.invitation(invitation.token).id,site.id);assert.equal(store.siteRegistrationOpen(site.id),true);
    const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:restoreDir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('복원 시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,login=await fetch(root+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-admin-password'})}),cookie=login.headers.get('set-cookie').split(';')[0],sites=await (await fetch(root+'/api/sites',{headers:{cookie}})).json();
    assert.equal(login.status,200);assert.equal(sites[0].name,'가상 현장');
    assert.equal((await fetch(root+'/api/worker/session',{headers:{cookie:`jweb_worker=${workerToken}`}})).status,401);
    assert.equal((await fetch(root+'/api/reviewer/session',{headers:{cookie:`jweb_reviewer=${reviewerToken}`}})).status,401);
    assert.equal((await fetch(root+`/api/join?token=${invitation.token}`)).status,404);assert.equal((await fetch(root+`/api/worker/site?key=${siteKey}`)).status,404);
    const qrResponse=await fetch(root+`/api/sites/${site.id}/access`,{method:'POST',headers:{cookie}}),qr=await qrResponse.json(),png=PNG.sync.read(Buffer.from(qr.image.split(',')[1],'base64')),newKey=new URL(qr.link).searchParams.get('site');
    assert.equal(qrResponse.status,200);assert.notEqual(newKey,siteKey);assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,qr.link);
    const newSite=await (await fetch(root+`/api/worker/site?key=${newKey}`)).json();assert.equal(newSite.id,site.id);assert.equal(newSite.canSignup,false);
    const workerLogin=await fetch(root+'/api/worker/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({siteKey:newKey,loginId:'virtual_worker',password:'virtual-password-123'})});
    assert.equal(workerLogin.status,200);assert.equal((await workerLogin.json()).worker.id,worker.id);
    const reviewerLogin=await fetch(root+'/api/reviewer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId:'virtual_reviewer',password:'virtual-password-123'})});assert.equal(reviewerLogin.status,200);
    assert.deepEqual(files(backupDir),[]);assert.deepEqual(files(restoreDir),[]);
  }finally{if(locked)store.db.exec('ROLLBACK');if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}if(store)store.close();cleanup(dir);}
});

test('백업·복원은 기존 파일, 보조 파일, 손상 파일과 잘못된 연결을 덮어쓰지 않는다',{timeout:30000},()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-db-copy-errors-')),sourceDir=join(dir,'source'),destination=join(dir,'destination');mkdirSync(sourceDir);mkdirSync(destination);
  const source=join(sourceDir,'jweb.sqlite'),copy=join(destination,'copy.sqlite');let store=new Store(source);
  try{
    const site=store.createSite({name:'가상 현장'});writeFileSync(copy,'기존 파일');assert.notEqual(run(sourceDir,'backup',copy).status,0);assert.equal(readFileSync(copy,'utf8'),'기존 파일');
    assert.notEqual(run(sourceDir,'backup',source).status,0);assert.equal(store.db.prepare('SELECT name FROM sites WHERE id=?').get(site.id).name,'가상 현장');
    const sidecar=join(destination,'busy.sqlite');writeFileSync(sidecar+'-wal','기존 보조 파일');assert.notEqual(run(sourceDir,'backup',sidecar).status,0);assert.equal(readFileSync(sidecar+'-wal','utf8'),'기존 보조 파일');
    const invalid=join(destination,'invalid.sqlite');writeFileSync(invalid,'잘못된 내용');assert.notEqual(run(sourceDir,'restore',invalid,destination).status,0);assert.equal(readFileSync(invalid,'utf8'),'잘못된 내용');
    const existing=join(destination,'jweb.sqlite');writeFileSync(existing,'기존 데이터');assert.notEqual(run(sourceDir,'restore',source,destination).status,0);assert.equal(readFileSync(existing,'utf8'),'기존 데이터');
    assert.notEqual(run(sourceDir,'backup',join(destination,'bad.txt')).status,0);assert.deepEqual(files(destination),[]);
    store.db.exec("CREATE TRIGGER session_guard BEFORE DELETE ON worker_sessions BEGIN SELECT RAISE(ABORT,'변경 금지'); END");
    const guarded=run(sourceDir,'backup',join(destination,'guarded.sqlite'));assert.notEqual(guarded.status,0);assert.match(guarded.stderr,/세션 테이블/);store.db.exec('DROP TRIGGER session_guard');assert.deepEqual(files(destination),[]);
    store.close();store=null;const broken=new DatabaseSync(source);broken.exec('PRAGMA foreign_keys=OFF');broken.prepare("INSERT INTO workers(site_id,name,category,company,occupation) VALUES(999,'가상','직영','가상','가상')").run();broken.close();
    const badCopy=join(destination,'broken.sqlite'),result=run(sourceDir,'backup',badCopy);assert.notEqual(result.status,0);assert.match(result.stderr,/무결성/);assert.deepEqual(files(destination),[]);assert.equal(readdirSync(destination).includes('broken.sqlite'),false);
  }finally{if(store)store.close();cleanup(dir);}
});

test('두 백업이 같은 이름을 동시에 선택해도 한 파일만 만들어진다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-db-copy-race-')),a=join(dir,'a'),b=join(dir,'b'),target=join(dir,'shared');for(const item of [a,b,target])mkdirSync(item);
  try{
    for(const [folder,name] of [[a,'가상 현장 A'],[b,'가상 현장 B']]){const store=new Store(join(folder,'jweb.sqlite'));store.createSite({name});store.close();}
    const archive=join(target,'same.sqlite'),children=[a,b].map(dataDir=>spawn(process.execPath,['db-copy.js','backup',archive],{cwd:process.cwd(),env:{...process.env,JWEB_DATA_DIR:dataDir},stdio:'ignore'}));
    const codes=await Promise.all(children.map(child=>once(child,'exit').then(([code])=>code)));assert.deepEqual(codes.slice().sort(),[0,1]);
    const snapshot=new DatabaseSync(archive,{readOnly:true});try{assert.ok(['가상 현장 A','가상 현장 B'].includes(snapshot.prepare('SELECT name FROM sites').get().name));}finally{snapshot.close();}
    assert.deepEqual(files(target),[]);
  }finally{cleanup(dir);}
});
