import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';

test('근골격계 개선 후 등급은 three-level 값만 저장하고 숫자 개선 항목은 저장하지 않는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),base={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-01'};
    for(const scale of ['','three-level','3x3','5x4']){
      for(const improvedGrade of ['', '상','중','하','보통','1',1,null,{},false]){
        const input={...base,details:{scale,items:[],musculoskeletalItems:[{task:'가상 작업',selected:true,improvedGrade}]}};
        if(improvedGrade===''||scale==='three-level'&&['상','중','하'].includes(improvedGrade))assert.equal(JSON.parse(store.createDocument(input).details).musculoskeletalItems[0].improvedGrade,improvedGrade);
        else assert.throws(()=>store.createDocument(input),/척도/);
      }
      const old=store.createDocument({...base,details:{scale,items:[],musculoskeletalItems:[{selected:true}]}});
      assert.equal(Object.hasOwn(JSON.parse(old.details).musculoskeletalItems[0],'improvedGrade'),false);
    }
    const numeric=store.createDocument({...base,details:{scale:'3x3',items:[],musculoskeletalItems:[{selected:true,improvedGrade:'',improvedLikelihood:'2',improvedSeverity:'3',improvedScore:999}]}});
    for(const key of ['improvedLikelihood','improvedSeverity','improvedScore'])assert.equal(Object.hasOwn(JSON.parse(numeric.details).musculoskeletalItems[0],key),false);
  }finally{store.close();}
});

for(const role of ['관리자','근로자'])test(`${role} 근골격계 등급은 누락 요청을 거부하고 재정렬·빈값·항목 삭제 및 결재 사본을 보존한다`,()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id),worker=store.join(invite.token,{name:'가상 근로자',category:'직영',company:'',occupation:'가상 직종',loginId:'muscle_grade',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    store.setWorkerPermissions(site.id,worker.id,['risk']);
    const base={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-01'},rows=[{task:'첫 작업',selected:true,grade:'상',improvedGrade:'중'},{task:'둘째 작업',selected:false,grade:'중',improvedGrade:'하'}],input=items=>({...base,details:{scale:'three-level',items:[],musculoskeletalItems:items}});
    const doc=role==='관리자'?store.createDocument(input(rows)):store.createWorkerDocument(site.id,worker.id,input(rows));
    const update=data=>role==='관리자'?store.updateDocument(doc.id,data):store.updateWorkerDocument(site.id,worker.id,doc.id,data),load=()=>JSON.parse(store.document(doc.id).details).musculoskeletalItems;
    assert.deepEqual(load().map(row=>row.improvedGrade),['중','하']);
    const saved=store.document(doc.id).details;
    for(const bad of [input(rows.map(({improvedGrade,...row})=>row)),input([{...rows[0],improvedGrade:undefined},rows[1]]),{...base,details:{scale:'three-level',items:[]}},input(null),input([{...rows[0],improvedGrade:'보통'}]),input([{...rows[0],improvedGrade:null}])]){
      assert.throws(()=>update(bad));assert.equal(store.document(doc.id).details,saved);
    }
    update(input([...rows].reverse()));assert.deepEqual(load().map(row=>[row.task,row.improvedGrade]),[['둘째 작업','하'],['첫 작업','중']]);
    const submitted=role==='관리자'?store.transition(doc.id,'submit'):store.transitionWorkerDocument(site.id,worker.id,doc.id,'submit');
    if(role==='관리자')store.transition(doc.id,'withdraw');else store.transitionWorkerDocument(site.id,worker.id,doc.id,'withdraw');
    update(input([{...rows[1],improvedGrade:''}]));assert.equal(load().length,1);assert.equal(load()[0].improvedGrade,'');
    update(input([rows[0]]));update(input([]));assert.deepEqual(load(),[]);
    assert.deepEqual(JSON.parse(store.approvalCycle(doc.id,submitted.approval_cycle_id).document.details).musculoskeletalItems.map(row=>[row.task,row.improvedGrade]),[['둘째 작업','하'],['첫 작업','중']]);
  }finally{store.close();}
});

test('관리자·근로자 HTTP 저장은 개선 등급 누락을 거부하고 서버 재시작 후 값을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-muscle-grade-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}child=null;};
  try{
    await start();const call=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0];
    let admin=await login();const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await call(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),credentials={token,loginId:'muscle_api',password:'virtual-password-123'};
    assert.equal((await call('/api/join','POST',{...credentials,name:'가상 근로자',category:'직영',company:'',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}})).status,201);
    const workers=await (await call(`/api/workers?siteId=${site.id}`,'GET',undefined,admin)).json();assert.equal((await call(`/api/workers/${workers[0].id}/permissions`,'PUT',{siteId:site.id,permissions:['risk']},admin)).status,200);
    const workerLogin=async()=>(await call('/api/worker/login','POST',credentials)).headers.get('set-cookie').split(';')[0];let worker=await workerLogin();
    const input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-01',details:{scale:'three-level',items:[],musculoskeletalItems:[{task:'가상 작업',selected:true,grade:'상',improvedGrade:'중'}]}},documents=[];
    for(const [path,cookie] of [['/api/documents',admin],['/api/worker/documents',worker]]){
      const response=await call(path,'POST',input,cookie);assert.equal(response.status,201);const doc=await response.json();assert.equal(JSON.parse(doc.details).musculoskeletalItems[0].improvedGrade,'중');documents.push({path,id:doc.id});
      const omitted=structuredClone(input);delete omitted.details.musculoskeletalItems[0].improvedGrade;
      const rejected=await call(`${path}/${doc.id}`,'PUT',omitted,cookie);assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/근골격계 개선 후 등급/);
      const updated=structuredClone(input);updated.details.musculoskeletalItems[0].improvedGrade='하';assert.equal((await call(`${path}/${doc.id}`,'PUT',updated,cookie)).status,200);
    }
    await stop();await start();admin=await login();worker=await workerLogin();
    for(const doc of documents){const response=await call(`${doc.path}/${doc.id}`,'GET',undefined,doc.path.includes('/worker/')?worker:admin);assert.equal(response.status,200);assert.equal(JSON.parse((await response.json()).details).musculoskeletalItems[0].improvedGrade,'하');}
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
