import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

test('지시 목록·첨부·사진 조회는 다른 로그인 문맥을 거절하고 기존 호출과 정상 문맥을 허용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-instruction-context-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie,context)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{}),...(context!==undefined?{'x-worker-report-context':typeof context==='string'?context:JSON.stringify(context)}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await(await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token');
    const sessions=[];
    for(const loginId of ['context_a','context_b']){
      assert.equal((await call('/api/join','POST',{token,name:'가상 근로자',category:'직영',occupation:'가상 직종',loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
      const response=await call('/api/worker/login','POST',{token,loginId,password:'virtual-password-123'});assert.equal(response.status,200);sessions.push({cookie:response.headers.get('set-cookie').split(';')[0],...await response.json()});
    }
    const [a,b]=sessions,doc=await(await call('/api/documents','POST',{siteId:site.id,type:'instruction',title:'가상 지시',date:'2030-01-01'},admin)).json();assert.ok(doc.id,JSON.stringify(doc));
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.prepare("UPDATE documents SET status='approved',details=? WHERE id=?").run(JSON.stringify({recipientId:b.worker.id}),doc.id);db.prepare("INSERT INTO instruction_results(document_id,date,actor,content,source) VALUES(?,?,'가상','가상 조치','worker')").run(doc.id,'2030-01-01');
    for(const path of ['/api/worker/instructions',`/api/worker/instructions/${doc.id}/attachments`,`/api/worker/instructions/${doc.id}/photos`]){
      for(const context of [a.reportContext,{...b.reportContext,siteId:9999},'{invalid']){const response=await call(path,'GET',null,b.cookie,context);assert.equal(response.status,409);assert.equal((await response.json()).sessionChanged,true);}
      for(const context of [undefined,b.reportContext]){const response=await call(path,'GET',null,b.cookie,context);assert.equal(response.status,200);assert.ok(Array.isArray(await response.json()));}
    }
    for(const suffix of ['attachments/1','photos/1'])assert.equal((await call(`/api/worker/instructions/${doc.id}/${suffix}`,'GET',null,b.cookie,a.reportContext)).status,409);
    db.prepare("UPDATE documents SET status='draft' WHERE id=?").run(doc.id);assert.deepEqual(await(await call('/api/worker/instructions','GET',null,b.cookie,b.reportContext)).json(),[]);
    assert.equal((await call(`/api/worker/instructions/${doc.id}/attachments`,'GET',null,b.cookie,b.reportContext)).status,400);
  }finally{db?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
