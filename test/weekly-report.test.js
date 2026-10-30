import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('주간 보고서는 현장과 날짜별 보호구 지급 및 체크리스트를 나눈다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 현장 A'}),b=s.createSite({name:'가상 현장 B'}),worker=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=worker(a.id),other=worker(b.id);
    const add=(siteId,workerId,date,item,quantity)=>s.addPpeIssue({siteId,workerId,date,item,quantity});add(a.id,one.id,'2024-02-29','안전모','2');add(a.id,one.id,'2024-02-29','안전모','1');add(a.id,one.id,'2024-03-01','안전화','1');add(a.id,one.id,'2024-03-05','안전모','3');add(b.id,other.id,'2024-02-29','안전모','9');
    const checklist=s.createDocument({siteId:a.id,type:'checklist',title:'가상 점검',date:'2024-02-29'}),foreign=s.createDocument({siteId:b.id,type:'checklist',title:'다른 현장',date:'2024-02-29'}),next=s.createDocument({siteId:a.id,type:'checklist',title:'다음 날 점검',date:'2024-03-01'});s.transition(next.id,'submit');
    const rows=s.weeklyActivity(a.id,'2024-02-27'),leap=rows[2],march=rows[3];assert.deepEqual(leap.ppeIssues,[{item:'안전모',quantity:3}]);assert.deepEqual(march.ppeIssues,[{item:'안전화',quantity:1}]);assert.deepEqual(leap.checklists,[{id:checklist.id,title:'가상 점검',status:'draft'}]);assert.deepEqual(march.checklists,[{id:next.id,title:'다음 날 점검',status:'pending'}]);assert.equal(rows[6].date,'2024-03-04');assert.ok(rows.every(row=>!row.checklists.some(doc=>doc.id===foreign.id)));assert.deepEqual(s.weeklyActivity(b.id,'2024-02-27')[2].ppeIssues,[{item:'안전모',quantity:9}]);assert.deepEqual(rows[0].ppeIssues,[]);
  }finally{s.close();}
});

test('주간 보고서 API는 관리자 인증과 현장별 집계를 적용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-weekly-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),worker=await (await call('/api/workers','POST',{siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'},admin)).json();
    assert.equal((await call('/api/ppe-issues','POST',{siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'안전모',quantity:'2'},admin)).status,201);const doc=await (await call('/api/documents','POST',{siteId:site.id,type:'checklist',title:'가상 점검',date:'2024-02-29'},admin)).json(),path=`/api/weekly-activity?siteId=${site.id}&start=2024-02-27`;
    assert.equal((await call(path)).status,401);const response=await call(path,'GET',null,admin);assert.equal(response.status,200);const day=(await response.json())[2];assert.deepEqual(day.ppeIssues,[{item:'안전모',quantity:2}]);assert.deepEqual(day.checklists,[{id:doc.id,title:'가상 점검',status:'draft'}]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('전체 현장 월별 활동은 달과 겹치는 일요일부터 토요일까지 정확히 분리한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=worker(a.id),two=worker(b.id);for(const [siteId,workerId,date] of [[a.id,one.id,'2024-01-28'],[a.id,one.id,'2024-03-02'],[b.id,two.id,'2024-02-29']])s.setAttendance({siteId,workerId,date,present:true});
    s.createDocument({siteId:a.id,type:'tbm',title:'가상 교육',date:'2024-02-29'});s.createDocument({siteId:b.id,type:'risk',title:'가상 평가',date:'2024-02-29'});s.createDocument({siteId:a.id,type:'office',title:'업무 문서',date:'2024-02-29',details:{kind:'기타',otherKind:'가상 구분'}});s.createDocument({siteId:a.id,type:'tbm',title:'범위 밖',date:'2024-03-03'});
    const result=s.monthlySiteActivity('2024-02'),siteA=result.sites.find(site=>site.id===a.id),siteB=result.sites.find(site=>site.id===b.id);assert.deepEqual(result.weeks,[{start:'2024-01-28',end:'2024-02-03'},{start:'2024-02-04',end:'2024-02-10'},{start:'2024-02-11',end:'2024-02-17'},{start:'2024-02-18',end:'2024-02-24'},{start:'2024-02-25',end:'2024-03-02'}]);assert.deepEqual(siteA.weeks.map(w=>[w.attendance,w.documents]),[[1,0],[0,0],[0,0],[0,0],[1,1]]);assert.deepEqual(siteB.weeks.map(w=>[w.attendance,w.documents]),[[0,0],[0,0],[0,0],[0,0],[1,1]]);assert.deepEqual(s.monthlySiteActivity('2025-01').weeks[0],{start:'2024-12-29',end:'2025-01-04'});assert.equal(s.monthlySiteActivity('2025-03').weeks.length,6);assert.throws(()=>s.monthlySiteActivity('2024-13'),/월/);assert.throws(()=>s.monthlySiteActivity('9999-12'),/월/);
  }finally{s.close();}
});

test('전체 현장 주간 활동 API는 관리자만 조회한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-site-weeks-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),path='/api/monthly-site-activity?month=2024-02';assert.equal((await call(path)).status,401);assert.equal((await call('/api/monthly-site-activity?month=2024-13','GET',null,admin)).status,400);const result=await (await call(path,'GET',null,admin)).json();assert.equal(result.sites[0].id,site.id);assert.equal(result.weeks.length,5);assert.ok(result.sites[0].weeks.every(week=>week.attendance===0&&week.documents===0));
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
