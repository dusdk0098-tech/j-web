import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';

test('작업자 역할은 계획서 저장과 복사에 보존되며 다른 현장은 거절한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),input={siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'},worker=s.createWorker(input),foreign=s.createWorker({...input,siteId:other.id}),rows=['신호수','운전원(직영)'].map(role=>({workerId:worker.id,role,training:'가상 교육',qualification:'가상 자격'})),plan={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers:rows}},doc=s.createDocument(plan);
    assert.deepEqual(JSON.parse(doc.details).workers.map(row=>row.role),['신호수','운전원(직영)']);const copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'가상 복사',date:'2026-11-05'});assert.deepEqual(JSON.parse(copy.details).workers.map(row=>row.role),['신호수','운전원(직영)']);assert.throws(()=>s.createDocument({...plan,details:{workers:[{...rows[0],workerId:foreign.id}]}}),/현장/);assert.throws(()=>s.createDocument({...plan,details:{workers:[{...rows[0],role:'다른 역할'}]}}),/작업자/);
  }finally{s.close();}
  for(const file of ['../public/app.js','../public/worker-documents.js']){const text=readFileSync(new URL(file,import.meta.url),'utf8');assert.match(text,/\['운전원','유도자','신호수','작업지휘자','운전원\(직영\)'\]/);}
});

test('근로자 작성 권한으로 두 역할을 HTTP에 저장하고 다시 조회한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-plan-roles-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상 근로자',loginId:'plan_roles',password:'virtual-password-123',category:'직영',company:'가상 업체',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',person)).status,201);
    const login=await send('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password}),cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json(),worker=session.worker;assert.equal((await send(`/api/workers/${worker.id}/permissions`,'PUT',{siteId:site.id,permissions:['work_plan']},admin)).status,200);
    const workers=['신호수','운전원(직영)'].map(role=>({workerId:worker.id,role,training:'',qualification:''})),created=await send('/api/worker/documents','POST',{type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers},reportContext:session.reportContext},cookie);assert.equal(created.status,201);const doc=await created.json(),saved=await (await send(`/api/worker/documents/${doc.id}`,'GET',undefined,cookie)).json();assert.deepEqual(JSON.parse(saved.details).workers.map(row=>row.role),['신호수','운전원(직영)']);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
