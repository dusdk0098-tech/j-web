import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';

test('월별 결재서류는 현장과 월을 분리하고 문서·결재 사본을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-month-file-')),path=join(dir,'test.sqlite'),bytes=Buffer.from('89504e470d0a1a0a00000000','hex');let s;
  try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),cost=s.createSafetyCost({siteId:site.id,category:'2',date:'2026-10-29',description:'가상 내역',note:'',unitPrice:'1000',quantity:'1',unit:'개'}),id=s.addSafetyCostMonthFile(site.id,'2026-10-10','가상 메모','가상.png',bytes);s.addSafetyCostMonthFile(site.id,'2026-11-01','','다음 달.png',bytes);s.addSafetyCostMonthFile(other.id,'2026-10-10','','다른 현장.png',bytes);
    assert.equal(s.safetyCostMonthFiles(site.id,'2026-10').length,1);assert.equal(s.safetyCostMonthFile(other.id,id),null);assert.throws(()=>s.addSafetyCostMonthFile(site.id,'2026-10-10','','x.png',bytes,()=>{throw Error('세션 만료');}),/세션 만료/);assert.throws(()=>s.deleteSafetyCostMonthFile(site.id,id,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.safetyCostMonthFiles(site.id,'2026-10').length,1);
    const report=s.createSafetyCostReport({siteId:site.id,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1000',progress:'50'}),photos=s.safetyCostReportPhotos(report.id),cycle=s.captureApprovalCycle(report);assert.equal(photos.length,1);assert.equal(photos[0].cost_id,0);assert.equal(photos[0].source_date,'2026-10-10');assert.equal(photos[0].note,'가상 메모');assert.equal(s.approvalCycle(report.id,cycle).linked.photos[0].cost_id,0);
    s.deleteSafetyCostMonthFile(site.id,id);assert.deepEqual(Buffer.from(s.safetyCostReportPhoto(report.id,photos[0].id).data),bytes);assert.deepEqual(Buffer.from(s.approvalCycleFile(report.id,cycle,'cost-photo',0,photos[0].id).data),bytes);assert.equal(JSON.parse(report.details).rows[0].id,cost.id);s.close();s=new Store(path);assert.equal(s.safetyCostReportPhotos(report.id)[0].note,'가상 메모');
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('월별 결재서류 API는 관리자·현장·날짜를 검증한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-month-file-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,json=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)}),cookie=(await json('/api/login',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await json('/api/sites',{name:'가상 현장'},cookie)).json(),other=await(await json('/api/sites',{name:'다른 현장'},cookie)).json(),image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image),params=new URLSearchParams({siteId:String(site.id),month:'2026-10',date:'2026-10-10',note:'가상'}),path=`/api/safety-cost-month-files?${params}`,upload=(url,auth)=>fetch(base+url,{method:'POST',headers:{...(auth?{cookie}:{}),'x-file-name':'virtual.png'},body:bytes});
    assert.equal((await upload(path,false)).status,401);assert.equal((await upload(path.replace('2026-10-10','2026-11-01'),true)).status,400);const response=await upload(path,true);assert.equal(response.status,201);const {id}=await response.json(),list=await(await fetch(`${base}/api/safety-cost-month-files?siteId=${site.id}&month=2026-10`,{headers:{cookie}})).json();assert.equal(list.length,1);assert.equal(list[0].note,'가상');assert.equal((await fetch(`${base}/api/safety-cost-month-files/${id}?siteId=${other.id}`,{headers:{cookie}})).status,404);assert.equal((await fetch(`${base}/api/safety-cost-month-files/${id}?siteId=${site.id}`)).status,401);assert.deepEqual(Buffer.from(await(await fetch(`${base}/api/safety-cost-month-files/${id}?siteId=${site.id}`,{headers:{cookie}})).arrayBuffer()),bytes);assert.equal((await fetch(`${base}/api/safety-cost-month-files/${id}?siteId=${other.id}`,{method:'DELETE',headers:{cookie}})).status,400);assert.equal((await fetch(`${base}/api/safety-cost-month-files/${id}?siteId=${site.id}`,{method:'DELETE',headers:{cookie}})).status,200);
  }finally{if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
