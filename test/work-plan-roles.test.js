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

test('신호 방법은 여러 값을 보존하고 이전 화면과 잘못된 입력으로 지워지지 않는다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),row={workerId:worker.id,role:'신호수',training:'',qualification:'',signalMethods:['수신호','무전']},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers:[row]}},doc=s.createDocument(input),copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'가상 복사',date:'2026-11-05'});
    assert.deepEqual(JSON.parse(copy.details).workers[0].signalMethods,['수신호','무전']);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{workerId:worker.id,role:'신호수',training:'',qualification:''}]}}),/신호 방법/);for(const signalMethods of [['무전','무전'],['잘못된 신호'],'무전'])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,signalMethods}]}}),/신호 방법/);assert.deepEqual(JSON.parse(s.document(doc.id).details).workers[0].signalMethods,['수신호','무전']);s.updateDocument(doc.id,{...input,details:{workers:[{...row,signalMethods:[]}]}});assert.deepEqual(JSON.parse(s.document(doc.id).details).workers[0].signalMethods,[]);
  }finally{s.close();}
});

test('작업자 교육 구분은 복수 선택을 보존하고 이전 화면의 누락을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),row={workerId:worker.id,role:'운전원',training:'이전 자유 입력',qualification:'',trainingTypes:['특별교육','기초안전보건교육']},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers:[row]}},doc=s.createDocument(input),copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'가상 복사',date:'2026-11-05'});
    assert.deepEqual(JSON.parse(copy.details).workers[0].trainingTypes,row.trainingTypes);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{workerId:worker.id,role:'운전원',training:'이전 자유 입력',qualification:''}]}}),/교육 구분/);for(const trainingTypes of [['특별교육','특별교육'],['알 수 없는 교육'],'특별교육'])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,trainingTypes}]}}),/교육 구분/);assert.equal(JSON.parse(s.document(doc.id).details).workers[0].training,'이전 자유 입력');s.updateDocument(doc.id,{...input,details:{workers:[{...row,trainingTypes:[]}]}});assert.deepEqual(JSON.parse(s.document(doc.id).details).workers[0].trainingTypes,[]);
  }finally{s.close();}
});

test('작업자 기타 설명은 복사하며 오래된 화면의 누락을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),row={workerId:worker.id,role:'신호수',training:'',qualification:'',trainingTypes:['기타'],signalMethods:['기타'],trainingOther:'가상 교육',signalOther:'가상 신호'},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers:[row]}},doc=s.createDocument(input),copy=s.copyWorkPlan(doc.id,{siteId:site.id,title:'가상 복사',date:'2026-11-05'}),saved=JSON.parse(copy.details).workers[0];
    assert.equal(saved.trainingOther,'가상 교육');assert.equal(saved.signalOther,'가상 신호');const {trainingOther,...old}=row;assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[old]}}),/기타 설명/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,signalOther:'가'.repeat(501)}]}}),/기타 항목/);assert.equal(JSON.parse(s.document(doc.id).details).workers[0].signalOther,'가상 신호');s.updateDocument(doc.id,{...input,details:{workers:[{...row,trainingOther:'',signalOther:''}]}});assert.equal(JSON.parse(s.document(doc.id).details).workers[0].trainingOther,'');
  }finally{s.close();}
});

test('근로자 작성 권한으로 두 역할을 HTTP에 저장하고 다시 조회한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-plan-roles-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    assert.equal((await send('/plan-worker-other.js')).status,200);
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,'POST',{},admin)).json(),token=new URL(invite.link).searchParams.get('token'),person={token,name:'가상 근로자',loginId:'plan_roles',password:'virtual-password-123',category:'직영',company:'가상 업체',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};assert.equal((await send('/api/join','POST',person)).status,201);
    const login=await send('/api/worker/login','POST',{token,loginId:person.loginId,password:person.password}),cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json(),worker=session.worker;assert.equal((await send(`/api/workers/${worker.id}/permissions`,'PUT',{siteId:site.id,permissions:['work_plan']},admin)).status,200);
    const area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'',obstacles:'',protection:''},place=await (await send('/api/work-places','POST',{siteId:site.id,name:'가상 장소',work:area,route:area},admin)).json();
    const workers=['신호수','운전원(직영)'].map(role=>({workerId:worker.id,role,training:'',qualification:'',trainingTypes:['특별교육','기타'],signalMethods:['육성','깃발'],trainingOther:'가상 교육',signalOther:'가상 신호'})),created=await send('/api/worker/documents','POST',{type:'work_plan',title:'가상 계획',date:'2026-11-04',details:{workers,routeDescription:'가상 진입로',workSequence:'가상 작업순서',managementPoints:'가상 중점관리',additionalCharts:[{workPlaceId:place.id,routeDescription:'추가 경로',workSequence:'추가 순서',managementPoints:'추가 관리'}]},reportContext:session.reportContext},cookie);assert.equal(created.status,201);const doc=await created.json(),saved=await (await send(`/api/worker/documents/${doc.id}`,'GET',undefined,cookie)).json();assert.deepEqual(JSON.parse(saved.details).workers.map(row=>row.role),['신호수','운전원(직영)']);assert.deepEqual(JSON.parse(saved.details).workers[0].signalMethods,['육성','깃발']);assert.deepEqual(JSON.parse(saved.details).workers[0].trainingTypes,['특별교육','기타']);assert.equal(JSON.parse(saved.details).workers[0].trainingOther,'가상 교육');assert.equal(JSON.parse(saved.details).workers[0].signalOther,'가상 신호');assert.equal(JSON.parse(saved.details).routeDescription,'가상 진입로');assert.equal(JSON.parse(saved.details).workSequence,'가상 작업순서');assert.equal(JSON.parse(saved.details).managementPoints,'가상 중점관리');assert.equal(JSON.parse(saved.details).additionalCharts[0].placeName,'가상 장소');assert.equal(JSON.parse(saved.details).additionalCharts[0].routeDescription,'추가 경로');
    const png=Buffer.alloc(3*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(png);
    for(const [path,auth,headers] of [[`/api/documents/${doc.id}/attachments?category=plan_diagram`,admin,{}],[`/api/worker/documents/${doc.id}/attachments?category=plan_diagram`,cookie,{'X-Worker-Report-Context':JSON.stringify(session.reportContext)}]]){
      const response=await fetch(`http://127.0.0.1:${port}`+path,{method:'POST',headers:{cookie:auth,'Content-Type':'application/octet-stream','X-File-Name':'image.png',...headers},body:png});assert.equal(response.status,201);
    }
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
