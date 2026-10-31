import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {PNG} from 'pngjs';

test('교육 작성 권한은 두 문서 유형에 적용되고 다른 작성자의 문서는 보이지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),invite=s.createInvitation(site.id),make=id=>s.join(invite.token,{name:'가상 '+id,category:'직영',occupation:'목공',loginId:id,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),one=make('training_one'),two=make('training_two'),input={type:'tbm',title:'가상 TBM',date:'2026-11-01',details:{weather:'맑음'}};
    assert.throws(()=>s.createWorkerDocument(site.id,one.id,input),/권한/);s.setWorkerPermissions(site.id,one.id,['training']);s.setWorkerPermissions(site.id,two.id,['training']);
    const first=s.createWorkerDocument(site.id,one.id,input),second=s.createWorkerDocument(site.id,one.id,{...input,type:'education',details:{kind:'other',otherTitle:'가상 교육',audience:'가상 대상'}});
    assert.deepEqual(s.workerDocuments(site.id,one.id).map(doc=>doc.id).sort((a,b)=>a-b),[first.id,second.id]);assert.deepEqual(s.workerDocuments(site.id,two.id),[]);assert.throws(()=>s.workerDocument(site.id,two.id,first.id),/권한/);
    assert.throws(()=>s.createWorkerDocument(site.id,one.id,{...input,type:'risk'}),/권한/);assert.throws(()=>s.createWorkerDocument(site.id,one.id,{...input,type:'education',details:{kind:'other'}}),/기타 교육명/);
    s.updateWorkerDocument(site.id,one.id,second.id,{...input,type:'education',title:'수정 교육',details:{kind:'regular'}});assert.equal(s.workerDocument(site.id,one.id,second.id).title,'수정 교육');s.setWorkerPermissions(site.id,one.id,[]);assert.deepEqual(s.workerDocuments(site.id,one.id),[]);assert.throws(()=>s.updateWorkerDocument(site.id,one.id,first.id,input),/권한/);
  }finally{s.close();}
});

test('가상 근로자 교육 문서는 API로 작성하고 권한 회수 후 접근할 수 없다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-training-author-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상',category:'직영',occupation:'목공',loginId:'training_test',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await call('/api/join','POST',person)).status,201);const logged=await call('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password}),cookie=logged.headers.get('set-cookie').split(';')[0],worker=(await logged.json()).worker,permission=`/api/workers/${worker.id}/permissions`,input={type:'tbm',title:'가상 TBM',date:'2026-11-01',details:{weather:'가상'}};
    const monthPath=`/api/attendance/month?siteId=${site.id}&month=2026-11`;assert.equal((await call(monthPath,'GET',null,cookie)).status,401);const monthRows=await (await call(monthPath,'GET',null,admin)).json();assert.equal(monthRows.find(row=>row.id===worker.id).phone,'010-0000-0000');
    assert.equal((await call('/api/worker/documents','POST',input,cookie)).status,400);assert.equal((await call(permission,'PUT',{siteId:site.id,permissions:['training']},admin)).status,200);assert.equal((await call('/api/worker/document-options?type=tbm','GET',null,cookie)).status,200);
    const created=await call('/api/worker/documents','POST',input,cookie);assert.equal(created.status,201);const doc=await created.json(),path=`/api/worker/documents/${doc.id}/training`,initial=await (await call(path,'GET',null,cookie)).json();assert.equal(initial.targets.configured,false);assert.equal(initial.hasSignature,false);
    assert.equal((await call(path,'PUT',{workerIds:[worker.id],expectedVersion:initial.version},cookie)).status,200);assert.equal((await call(path,'PUT',{workerIds:[],expectedVersion:initial.version},cookie)).status,409);
    let state=await (await call(path,'GET',null,cookie)).json();assert.equal(state.targets.configured,true);assert.deepEqual(state.targets.workers.filter(row=>row.selected).map(row=>row.id),[worker.id]);const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    assert.equal((await call(`${path}/signature`,'POST',{signature,expectedVersion:state.version},cookie)).status,200);assert.equal((await call(`${path}/signature`,'GET',null,cookie)).status,200);assert.equal((await call(`${path}/signature`,'POST',{signature,expectedVersion:state.version},cookie)).status,409);state=await (await call(path,'GET',null,cookie)).json();assert.equal(state.hasSignature,true);assert.equal((await call(path,'PUT',{workerIds:[],expectedVersion:state.version},cookie)).status,200);state=await (await call(path,'GET',null,cookie)).json();assert.equal(state.hasSignature,false);
    assert.equal((await call(`/api/worker/documents/${doc.id}/transition`,'POST',{action:'submit'},cookie)).status,200);assert.equal((await call(path,'PUT',{workerIds:[worker.id],expectedVersion:state.version},cookie)).status,409);assert.equal((await call('/api/worker/documents','GET',null,cookie)).status,200);
    assert.equal((await call(permission,'PUT',{siteId:site.id,permissions:[]},admin)).status,200);assert.deepEqual(await (await call('/api/worker/documents','GET',null,cookie)).json(),[]);assert.equal((await call(`/api/worker/documents/${doc.id}`,'GET',null,cookie)).status,400);assert.equal((await call(path,'GET',null,cookie)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
