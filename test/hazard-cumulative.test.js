import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {adminSitePolicy} from '../admin-site-policy.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('의견·위험신고 누적 건수는 선택일을 포함하고 현장별로 구분한다',()=>{
  const store=new Store(':memory:');
  try{
    const first=store.createSite({name:'가상 현장'}),second=store.createSite({name:'다른 현장'});
    const add=(site,date)=>{const id=store.createHazardReport(site.id,{title:'가상 신고',body:'가상 내용',reporter:'가상 신고자'});store.db.prepare('UPDATE hazard_reports SET created_at=? WHERE id=?').run(`${date} 12:00:00`,id);};
    add(first,'2026-09-30');add(first,'2026-10-01');add(first,'2026-10-02');add(second,'2026-10-01');
    assert.equal(store.hazardReportCount(first.id,'2026-10-01'),2);
    assert.equal(store.hazardReportCount(first.id,'2026-10-31'),3);
    assert.equal(store.hazardReportCount(second.id,'2026-10-01'),1);
    assert.throws(()=>store.hazardReportCount(first.id,'2026-02-30'),/날짜/);
    assert.throws(()=>store.hazardReportCount(99999,'2026-10-01'),/현장/);
  }finally{store.close();}
});

test('누적 신고 API는 관리자 인증을 확인하고 건수만 반환한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-count-')),store=new Store(join(dir,'jweb.sqlite'));
  const site=store.createSite({name:'가상 현장'}),id=store.createHazardReport(site.id,{title:'가상 신고',body:'가상 내용',reporter:'가상 신고자'});
  store.db.prepare('UPDATE hazard_reports SET created_at=? WHERE id=?').run('2026-10-01 12:00:00',id);
  const url=new URL(`http://localhost/api/sites/${site.id}/hazard-report-count?to=2026-10-01`);
  assert.equal(adminSitePolicy(store.db,{method:'GET'},url,()=>({scope:'site',siteIds:[site.id]})).status,403);
  store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,path=url.pathname+url.search;
    assert.equal((await fetch(base+path)).status,401);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-admin-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await fetch(base+path,{headers:{cookie}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{count:1});
    assert.equal((await fetch(base+url.pathname+'?to=2026-02-30',{headers:{cookie}})).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
