import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AdminAccounts} from '../admin-accounts.js';
import {Store} from '../store.js';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const password='virtual-password-123';
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
function setup(db){db.exec('PRAGMA foreign_keys=ON;CREATE TABLE sites(id INTEGER PRIMARY KEY);INSERT INTO sites VALUES(1),(2)');const auth=new AdminAccounts(db);auth.bootstrap(password);return auth;}

test('구형 모든 계정 전역 이관, 재실행 보존 및 배정 FK',()=>{
 const db=new DatabaseSync(':memory:');try{
 const auth=setup(db);auth.create({loginId:'legacy',name:'가상 기존',password});const token=auth.login('legacy',password);
 db.exec('DROP TABLE admin_site_assignments;ALTER TABLE admin_accounts DROP COLUMN scope');
 const migrated=new AdminAccounts(db);assert.ok(migrated.list().every(a=>a.scope==='global'));assert.equal(migrated.valid(token),true);
 const restricted=migrated.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[1]});
 assert.deepEqual(new AdminAccounts(db).list().find(a=>a.id===restricted.id).siteIds,[1]);
 assert.throws(()=>db.prepare('INSERT INTO admin_site_assignments VALUES(?,999)').run(restricted.id),/FOREIGN KEY/);
 db.exec('DELETE FROM sites WHERE id=1');assert.deepEqual(migrated.siteIds(restricted.id),[]);
 }finally{db.close();}
});

test('마지막 전역 보호, 제한 관리자 거부, 배정 버전 충돌과 세션 폐기',()=>{
 const db=new DatabaseSync(':memory:');try{
 const auth=setup(db),global=auth.list()[0],token=auth.login('admin',password),authorize=()=>auth.requireGlobal(token);
 const limited=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[1]},authorize),old=auth.login('limited',password);
 for(const change of [{active:false},{scope:'restricted',siteIds:[2]}])assert.throws(()=>auth.update(global.id,{version:global.version,...change},authorize),/마지막 활성 전역/);
 assert.throws(()=>auth.create({loginId:'escape',name:'가상',password},()=>auth.requireGlobal(old)),e=>e.sessionStatus===403);
 assert.throws(()=>auth.update(limited.id,{version:limited.version,scope:'global'},()=>auth.requireGlobal(old)),e=>e.sessionStatus===403);
 for(const siteIds of [[99],[1,1],['1'],null])assert.throws(()=>auth.update(limited.id,{version:limited.version,siteIds},authorize));
 const changed=auth.update(limited.id,{version:limited.version,siteIds:[2]},authorize);assert.equal(auth.session(old),null);assert.deepEqual(changed.siteIds,[2]);
 assert.throws(()=>auth.update(limited.id,{version:limited.version,siteIds:[1]},authorize),e=>e.sessionStatus===409);
 db.exec('INSERT INTO sites VALUES(3)');const fresh=auth.login('limited',password);assert.deepEqual(auth.session(fresh).siteIds,[2]);assert.equal(auth.session(fresh).scope,'restricted');
 auth.update(limited.id,{version:changed.version,name:'가상 새 이름'},authorize);assert.equal(auth.valid(fresh),true);
 const before=auth.list().length;assert.throws(()=>auth.create({loginId:'denied',name:'가상',password},()=>{assert.equal(db.isTransaction,true);throw Error('잠금 후 거부');}),/잠금 후 거부/);assert.equal(auth.list().length,before);
 }finally{db.close();}
});

test('실제 두 연결 잠금 대기 후 권한 재검증 및 마지막 전역 경합',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-admin-scope-race-')),path=join(dir,'test.sqlite'),db=new DatabaseSync(path);let child;
 try{
 const auth=setup(db),first=auth.list()[0],second=auth.create({loginId:'second',name:'가상 전역',password}),token=auth.login('admin',password);
 const module=pathToFileURL(join(process.cwd(),'admin-accounts.js')).href;
 const start=async(id,version,actor)=>{const script=`import {DatabaseSync} from 'node:sqlite';import {AdminAccounts} from ${JSON.stringify(module)};const db=new DatabaseSync(${JSON.stringify(path)});db.exec('PRAGMA busy_timeout=5000');const auth=new AdminAccounts(db);process.stdout.write('READY');process.stdin.once('data',()=>{process.stdout.write('ATTEMPT');try{auth.update(${id},{version:${JSON.stringify(version)},scope:'restricted'},()=>auth.requireGlobal(${JSON.stringify(actor)}));process.stdout.write('ACCEPTED')}catch(e){process.stdout.write('REJECTED:'+e.message)}finally{db.close()}});`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',chunk=>out+=chunk);const wait=async text=>{const end=Date.now()+5000;while(!out.includes(text)){assert.ok(Date.now()<end,out);await new Promise(r=>setTimeout(r,10));}};await wait('READY');return {wait,result:()=>out};};
 let probe=await start(second.id,second.version,token);db.exec('BEGIN IMMEDIATE');child.stdin.end('go');await probe.wait('ATTEMPT');db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(first.id);db.exec('COMMIT');await once(child,'exit');assert.match(probe.result(),/REJECTED:관리자 세션/);assert.equal(auth.list().find(a=>a.id===second.id).scope,'global');
 const secondToken=auth.login('second',password);probe=await start(second.id,second.version,secondToken);db.exec('BEGIN IMMEDIATE');child.stdin.end('go');await probe.wait('ATTEMPT');db.prepare("UPDATE admin_accounts SET scope='restricted' WHERE id=?").run(first.id);db.exec('COMMIT');await once(child,'exit');assert.match(probe.result(),/REJECTED:마지막 활성 전역/);assert.equal(auth.list().find(a=>a.id===second.id).scope,'global');
 }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}db.close();cleanup(dir);}
});

test('DB 백업·복원 계정 범위와 배정 보존, 관리자 로그인 세션 삭제',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-admin-scope-copy-')),restore=join(dir,'restore'),path=join(dir,'jweb.sqlite');mkdirSync(restore);const store=new Store(path);
 try{
 const site=store.createSite({name:'가상 배정 현장'}),auth=new AdminAccounts(store.db);auth.bootstrap(password);const limited=auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[site.id]}),token=auth.login('limited',password),archive=join(dir,'backup.sqlite');
 for(const args of [['backup',archive],['restore',archive,restore]]){const result=spawnSync(process.execPath,['db-copy.js',...args],{env:{...process.env,JWEB_DATA_DIR:dir},encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 for(const file of [archive,join(restore,'jweb.sqlite')]){const db=new DatabaseSync(file);try{assert.equal(db.prepare('SELECT count(*) n FROM admin_sessions').get().n,0);const copy=new AdminAccounts(db),row=copy.list().find(a=>a.id===limited.id);assert.equal(row.scope,'restricted');assert.deepEqual(row.siteIds,[site.id]);assert.equal(copy.valid(token),false);assert.deepEqual(copy.session(copy.login('limited',password)).siteIds,[site.id]);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{db.close();}}
 assert.equal(auth.valid(token),true);
 }finally{store.close();cleanup(dir);}
});


test('쓰기 가드 아래 자기 전역 권한 제한 및 배정을 원자적으로 저장한다',async()=>{
 const {adminWriteGuard}=await import('../admin-write-guard.js'),db=new DatabaseSync(':memory:');try{
 const auth=setup(db),account=auth.list()[0];auth.create({loginId:'other',name:'다른 전역',password});const token=auth.login('admin',password),guard=adminWriteGuard(db),req={adminProtected:true,checkSession:()=>auth.valid(token)?null:{status:401,error:'만료'}};
 const saved=guard.run(req,()=>auth.update(account.id,{version:account.version,scope:'restricted',siteIds:[1]},()=>auth.requireGlobal(token)));
 assert.equal(saved.scope,'restricted');assert.deepEqual(saved.siteIds,[1]);assert.equal(auth.valid(token),false);assert.deepEqual(auth.session(auth.login('admin',password)).siteIds,[1]);
 }finally{db.close();}
});
