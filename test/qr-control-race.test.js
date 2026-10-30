import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

test('가입 열기와 초대 중지는 권한 검사가 실패하면 변경하지 않는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),expired=()=>{throw Error('세션 만료');};
    assert.throws(()=>store.openSiteRegistration(site.id,expired),/세션 만료/);assert.equal(store.siteAccessKey(site.id),null);assert.equal(store.siteRegistrationOpen(site.id),false);
    store.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON site_registration BEGIN SELECT RAISE(ABORT,'시험 설정 실패'); END");
    assert.throws(()=>store.openSiteRegistration(site.id),/시험 설정 실패/);assert.equal(store.siteAccessKey(site.id),null);assert.equal(store.siteRegistrationOpen(site.id),false);store.db.exec('DROP TRIGGER fail_registration');
    store.openSiteRegistration(site.id);const invitation=store.createInvitation(site.id);
    assert.throws(()=>store.revokeInvitations(site.id,expired),/세션 만료/);assert.equal(store.siteRegistrationOpen(site.id),true);assert.equal(store.invitation(invitation.token).id,site.id);
    store.db.exec("CREATE TRIGGER fail_close BEFORE DELETE ON site_registration BEGIN SELECT RAISE(ABORT,'시험 중지 실패'); END");
    assert.throws(()=>store.revokeInvitations(site.id),/시험 중지 실패/);assert.equal(store.siteRegistrationOpen(site.id),true);assert.equal(store.invitation(invitation.token).id,site.id);store.db.exec('DROP TRIGGER fail_close');
  }finally{store.close();}
});

test('QR 가입 제어가 DB 잠금을 기다리는 동안 관리자가 만료되면 변경하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-control-')),flag=join(dir,'expired'),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const storeUrl=pathToFileURL(join(process.cwd(),'store.js')).href,authUrl=pathToFileURL(join(process.cwd(),'auth.js')).href;
  const trace=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(storeUrl)};import {LocalAuth} from ${JSON.stringify(authUrl)};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(...args){return existsSync(${JSON.stringify(flag)})?false:valid.apply(this,args)};for(const name of ['openSiteRegistration','revokeInvitations']){const original=Store.prototype[name];Store.prototype[name]=function(...args){process.stdout.write('QR_CONTROL_STARTED\\n');return original.apply(this,args)}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),path=`/api/sites/${site.id}`;
    assert.equal((await send(path+'/access','POST',{},admin)).status,200);db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    const expireWhileLocked=async(url,method)=>{db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=send(url,method,method==='POST'?{}:undefined,admin);pending.catch(()=>{});assert.match(String((await started)[0]),/QR_CONTROL_STARTED/);writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;const response=await pending;unlinkSync(flag);return response;};
    assert.equal((await expireWhileLocked(path+'/access/registration','POST')).status,401);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_registration WHERE site_id=?').get(site.id).n,0);
    assert.equal((await send(path+'/invitation','POST',{},admin)).status,201);const expiry=Date.now()+600000;db.prepare('INSERT INTO site_registration(site_id,expires_at) VALUES(?,?)').run(site.id,expiry);
    assert.equal((await expireWhileLocked(path+'/invitation','DELETE')).status,401);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE site_id=? AND revoked=0 AND pending=0').get(site.id).n,1);assert.equal(db.prepare('SELECT expires_at FROM site_registration WHERE site_id=?').get(site.id).expires_at,expiry);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
