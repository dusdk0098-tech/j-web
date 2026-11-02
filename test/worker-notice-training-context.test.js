import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';

test('근로자 일일 조회와 신고 조회는 화면을 연 계정과 로그인 세대를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-notice-training-context-')),store=new Store(join(dir,'jweb.sqlite')),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),people=[];
  for(const suffix of ['a','b']){
    const site=store.createSite({name:'가상 현장 '+suffix}),token=store.createInvitation(site.id).token,loginId='virtual_context_'+suffix,password='virtual-password-123';
    const worker=store.join(token,{name:'가상 근로자 '+suffix,category:'직영',occupation:'가상 직종',loginId,password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});store.setWorkerPermissions(site.id,worker.id,['attendance']);
    for(const type of ['notice','education']){const doc=store.createDocument({siteId:site.id,type,title:'가상 '+type+' '+suffix,date,body:'가상 내용'});store.db.prepare("UPDATE documents SET status='approved' WHERE id=?").run(doc.id);}
    people.push({token,loginId,password});
  }
  store.close();const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,login=async person=>{const r=await fetch(base+'/api/worker/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(person)});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],...(await r.json())};},a=await login(people[0]),b=await login(people[1]);
    const get=(path,session,context)=>fetch(base+path,{headers:{cookie:session.cookie,...(context===undefined?{}:{'x-worker-report-context':typeof context==='string'?context:JSON.stringify(context)})}});
    for(const [path,type] of [['/api/worker/notices','notice'],['/api/worker/training','education']]){
      for(const [session,suffix] of [[a,'a'],[b,'b']]){const response=await get(path,session,session.reportContext);assert.equal(response.status,200);assert.deepEqual((await response.json()).map(item=>item.title),['가상 '+type+' '+suffix]);}
      for(const context of [a.reportContext,'invalid']){const response=await get(path,b,context);assert.equal(response.status,409);assert.equal((await response.json()).sessionChanged,true);}
      const legacy=await get(path,b);assert.equal(legacy.status,200);assert.deepEqual((await legacy.json()).map(item=>item.title),['가상 '+type+' b']);
      const next=await login(people[0]),stale=await get(path,next,a.reportContext);assert.equal(stale.status,409);assert.equal((await stale.json()).sessionChanged,true);
    }
    const next=await login(people[0]);for(const path of ['/api/worker/self-check','/api/worker/daily-training','/api/worker/meetings','/api/worker/hazard-reports','/api/worker/attendance?month=2026-11','/api/worker/ppe-issues','/api/worker/permissions','/api/worker/managed-attendance?date=2026-11-01']){
      assert.equal((await get(path,a,a.reportContext)).status,200);assert.equal((await get(path,b,b.reportContext)).status,200);assert.equal((await get(path,b)).status,200);
      for(const [session,context] of [[b,a.reportContext],[b,'invalid'],[next,a.reportContext]]){const response=await get(path,session,context);assert.equal(response.status,409,path);assert.equal((await response.json()).sessionChanged,true);}
    }
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}if(dirname(resolve(dir))===resolve(tmpdir()))rmSync(dir,{recursive:true,force:true});}
});
