import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';
import {runInNewContext} from 'node:vm';

test('권한 목록의 해제 버튼은 표시한 권한 집합을 함께 전송한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf("  if(state.page==='worker-permissions')"),to=source.indexOf("  if(state.page==='worker-access-blocks')",from);assert.ok(from>=0&&to>from);
  const button={dataset:{permissionWorker:'7',permissionKey:'training'}},content={innerHTML:'',querySelectorAll:()=>[button]},state={page:'worker-permissions',siteId:1},calls=[],people=[{id:7,name:'가상',company:'가상 업체',birth_date:null,phone:null,category:'직영',occupation:'목공',permissions:['risk','training']}],context={content,state,detailEpoch:1,confirm:()=>true,esc:value=>String(value),render:async()=>{},showError:error=>{throw error;},api:async(path,options)=>{calls.push({path,options});return options?{}:people;}};
  await runInNewContext(`(async()=>{${source.slice(from,to)}})()`,context);assert.match(content.innerHTML,/TBM·안전교육 작성/);await button.onclick();assert.equal(calls[1].path,'/api/workers/7/permissions');assert.deepEqual(JSON.parse(calls[1].options.body),{siteId:1,permissions:['risk'],expectedPermissions:['risk','training']});
});

test('특별권한 목록은 현장별로 권한이 있는 계정만 묶어 보여준다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(site,id)=>s.join(s.createInvitation(site.id).token,{name:'가상 '+id,category:'직영',occupation:'목공',loginId:id,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),first=make(a,'first_worker'),second=make(a,'second_worker'),other=make(b,'other_worker');s.setWorkerPermissions(a.id,first.id,['training','risk']);s.setWorkerPermissions(b.id,other.id,['attendance']);const rows=s.workerPermissionOverview(a.id);assert.equal(rows.length,1);assert.equal(rows[0].id,first.id);assert.deepEqual(rows[0].permissions,['risk','training']);assert.equal(rows[0].birth_date,'2000-01-01');assert.ok(!rows.some(row=>row.id===second.id||row.id===other.id));assert.throws(()=>s.workerPermissionOverview(0),/현장/);
    assert.throws(()=>s.setWorkerPermissions(a.id,first.id,['risk'],()=>{},['risk']),/변경/);assert.deepEqual(s.workerPermissions(a.id,first.id),['risk','training']);assert.deepEqual(s.setWorkerPermissions(a.id,first.id,['risk'],()=>{},['training','risk']),['risk']);
  }finally{s.close();}
});

test('권한 저장 대기 중 변경되면 이전 목록으로 덮어쓰지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permission-overview-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.setWorkerPermissions;Store.prototype.setWorkerPermissions=function(...args){const exec=this.db.exec;this.db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('PERMISSION_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{this.db.exec=exec}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상',category:'직영',occupation:'목공',loginId:'perm_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await call('/api/join','POST',person)).status,201);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const id=db.prepare('SELECT worker_id FROM worker_accounts WHERE login_id=?').get(person.loginId).worker_id;db.prepare('INSERT INTO worker_permissions(worker_id,permission) VALUES(?,?)').run(id,'risk');const path=`/api/sites/${site.id}/worker-permissions`;assert.equal((await call(path)).status,401);const rows=await (await call(path,'GET',null,admin)).json();assert.deepEqual(rows[0].permissions,['risk']);
    db.exec('BEGIN IMMEDIATE');locked=true;const started=once(child.stdout,'data'),pending=call(`/api/workers/${id}/permissions`,'PUT',{siteId:site.id,permissions:[],expectedPermissions:rows[0].permissions},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/PERMISSION_LOCK/);db.prepare('INSERT INTO worker_permissions(worker_id,permission) VALUES(?,?)').run(id,'training');db.exec('COMMIT');locked=false;assert.equal((await pending).status,409);assert.deepEqual(db.prepare('SELECT permission FROM worker_permissions WHERE worker_id=? ORDER BY permission').all(id).map(row=>row.permission),['risk','training']);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
