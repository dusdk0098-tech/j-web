import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const image=PNG.sync.write(png),signature=`data:image/png;base64,${image.toString('base64')}`;
const person=(siteId,name='가상 근로자')=>({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'});
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};

test('가상 보호구 수령 확인은 같은 근로자의 현재 기록만 서명하고 변경 시 초기화한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),otherSite=s.createSite({name:'다른 현장'}),worker=s.createWorker(person(site.id)),other=s.createWorker(person(site.id,'다른 근로자'));
    const input={siteId:site.id,workerId:worker.id,date:'2026-10-30',item:'가상 안전모',quantity:'2'},id=s.addPpeIssue(input),first=s.workerPpeIssues(site.id,worker.id)[0];
    assert.match(first.version,/^[0-9a-f]{32}$/);assert.equal(first.receipt_at,null);
    assert.throws(()=>s.confirmPpeReceipt(site.id,worker.id,id,first.version,'잘못된 서명'),/서명/);
    assert.throws(()=>s.confirmPpeReceipt(site.id,other.id,id,first.version,signature),/지급 내역/);
    assert.throws(()=>s.confirmPpeReceipt(otherSite.id,worker.id,id,first.version,signature),/지급 내역/);
    assert.throws(()=>s.confirmPpeReceipt(site.id,worker.id,id,first.version,signature,()=>{throw Error('권한 만료');}),/권한 만료/);
    assert.equal(s.ppeReceipt(site.id,worker.id,id),null);
    s.confirmPpeReceipt(site.id,worker.id,id,first.version,signature);
    const confirmed=s.workerPpeIssues(site.id,worker.id)[0];assert.ok(confirmed.receipt_at);assert.notEqual(confirmed.version,first.version);
    assert.deepEqual(Buffer.from(s.ppeReceipt(site.id,worker.id,id)),image);assert.equal(s.ppeReceipt(site.id,other.id,id),null);
    assert.deepEqual(s.weeklyActivity(site.id,'2026-10-25')[5].ppeReceipts,{confirmed:1,total:1});
    assert.throws(()=>s.confirmPpeReceipt(site.id,worker.id,id,first.version,signature),/변경/);
    assert.throws(()=>s.updatePpeIssue(id,{...input,quantity:'3',expectedVersion:first.version}),/변경/);
    assert.throws(()=>s.deletePpeIssue(site.id,id),/변경/);
    s.updatePpeIssue(id,{...input,expectedVersion:confirmed.version});assert.deepEqual(Buffer.from(s.ppeReceipt(site.id,null,id)),image);
    s.updatePpeIssue(id,{...input,quantity:'3',expectedVersion:confirmed.version});
    const changed=s.workerPpeIssues(site.id,worker.id)[0];assert.equal(changed.receipt_at,null);assert.notEqual(changed.version,confirmed.version);
    assert.equal(s.ppeReceipt(site.id,worker.id,id),null);assert.deepEqual(s.weeklyActivity(site.id,'2026-10-25')[5].ppeReceipts,{confirmed:0,total:1});
    assert.throws(()=>s.confirmPpeReceipt(site.id,worker.id,id,confirmed.version,signature),/변경/);
    assert.throws(()=>s.deletePpeIssue(site.id,id,changed.version,()=>{throw Error('권한 만료');}),/권한 만료/);
    s.confirmPpeReceipt(site.id,worker.id,id,changed.version,signature);
    const latest=s.workerPpeIssues(site.id,worker.id)[0];s.deletePpeIssue(site.id,id,latest.version);
    assert.equal(s.ppeReceipt(site.id,worker.id,id),null);assert.deepEqual(s.weeklyActivity(site.id,'2026-10-25')[5].ppeReceipts,{confirmed:0,total:0});
  }finally{s.close();}
});

test('이전 보호구 기록은 데이터베이스 갱신 후 보존되고 수령 확인을 시작한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-ppe-migration-')),path=join(dir,'legacy.sqlite');let s;
  try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),worker=s.createWorker(person(site.id)),id=s.addPpeIssue({siteId:site.id,workerId:worker.id,date:'2026-10-30',item:'가상 안전화',quantity:'1'});s.close();s=null;
    const old=new DatabaseSync(path);old.exec('ALTER TABLE ppe_issues DROP COLUMN version');old.close();
    s=new Store(path);const row=s.workerPpeIssues(site.id,worker.id)[0];assert.equal(row.id,id);assert.equal(row.item,'가상 안전화');assert.equal(row.receipt_at,null);assert.match(row.version,/^[0-9a-f]{32}$/);
    s.confirmPpeReceipt(site.id,worker.id,id,row.version,signature);assert.deepEqual(Buffer.from(s.ppeReceipt(site.id,worker.id,id)),image);
  }finally{if(s)s.close();cleanup(dir);}
});

test('수령 API는 다른 근로자를 차단하고 저장 대기 중 세션이 폐기되면 서명하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-ppe-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};let calls=0;const original=Store.prototype.confirmPpeReceipt;Store.prototype.confirmPpeReceipt=function(...args){if(++calls===3)process.stdout.write('RECEIPT_SAVE\\n');return original.apply(this,args)};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const invitation=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invitation.link).searchParams.get('token');
    const joinWorker=async(loginId,name)=>{const input={token,...person(site.id,name),loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',input)).status,201);const login=await send('/api/worker/login','POST',{token,loginId,password:input.password});assert.equal(login.status,200);return {cookie:login.headers.get('set-cookie').split(';')[0],worker:(await login.json()).worker};};
    const owner=await joinWorker('ppe_owner','가상 근로자'),other=await joinWorker('ppe_other','다른 근로자'),input={siteId:site.id,workerId:owner.worker.id,date:'2026-10-30',item:'가상 안전모',quantity:'2'};
    const id=(await (await send('/api/ppe-issues','POST',input,admin)).json()).id,path=`/api/worker/ppe-issues/${id}/receipt`,first=(await (await send('/api/worker/ppe-issues','GET',null,owner.cookie)).json())[0];
    assert.equal((await send(path,'POST',{version:first.version,signature})).status,401);
    assert.equal((await send(path,'POST',{version:first.version,signature},other.cookie)).status,400);
    assert.equal((await send(path,'GET',null,other.cookie)).status,404);
    assert.equal((await send(path,'POST',{version:first.version,signature},owner.cookie)).status,200);
    assert.deepEqual(Buffer.from(await (await send(path,'GET',null,owner.cookie)).arrayBuffer()),image);
    assert.equal((await send(`/api/ppe-issues/${id}/receipt?siteId=${otherSite.id}`,'GET',null,admin)).status,404);
    assert.deepEqual(Buffer.from(await (await send(`/api/ppe-issues/${id}/receipt?siteId=${site.id}`,'GET',null,admin)).arrayBuffer()),image);
    assert.equal((await send(`/api/ppe-issues/${id}`,'PUT',{...input,quantity:'3',expectedVersion:first.version},admin)).status,400);
    const current=(await (await send(`/api/ppe-issues?siteId=${site.id}&month=2026-10`,'GET',null,admin)).json()).rows[0];
    assert.ok(current.receipt_at);assert.equal((await send(`/api/ppe-issues/${id}`,'PUT',{...input,quantity:'3',expectedVersion:current.version},admin)).status,200);
    const changed=(await (await send('/api/worker/ppe-issues','GET',null,owner.cookie)).json())[0];assert.equal(changed.receipt_at,null);
    assert.equal((await send(path,'GET',null,owner.cookie)).status,404);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');locked=true;
    const started=once(child.stdout,'data'),pending=send(path,'POST',{version:changed.version,signature},owner.cookie);pending.catch(()=>{});assert.match(String((await started)[0]),/RECEIPT_SAVE/);
    db.prepare('DELETE FROM worker_sessions WHERE worker_id=?').run(owner.worker.id);db.exec('COMMIT');locked=false;
    assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT count(*) AS n FROM ppe_receipts').get().n,0);
    const weekly=await (await send(`/api/weekly-activity?siteId=${site.id}&start=2026-10-25`,'GET',null,admin)).json();assert.deepEqual(weekly[5].ppeReceipts,{confirmed:0,total:1});
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}cleanup(dir);}
});
