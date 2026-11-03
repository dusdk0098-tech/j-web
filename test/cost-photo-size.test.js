import {fetchWithWorkerSession as fetch} from './helpers/worker-session-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomFillSync} from 'node:crypto';
import {PNG} from 'pngjs';
import {Store} from '../store.js';
import {freezeBatchImages} from '../public/batch-images.js';

test('비용 증빙과 현장 사진은 10MB 제한을 지킨다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-limit-'));let store;
  try{store=new Store(join(dir,'test.sqlite'));const site=store.createSite({name:'가상'}),cost=store.createSafetyCost({siteId:site.id,category:'2',date:'2026-10-29',description:'가상',note:'',unitPrice:'1000',quantity:'1',unit:'개'}),tooLarge=Buffer.alloc(10*1024*1024+1);
    assert.throws(()=>store.addSafetyCostPhoto(site.id,cost.id,'large.png',tooLarge),/10MB/);assert.throws(()=>store.addSafetyCostMonthFile(site.id,'2026-10-29','','large.png',tooLarge),/10MB/);assert.throws(()=>store.addSitePhoto(site.id,'large.png',tooLarge),/10MB/);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('2MB를 넘는 가상 PNG 여섯 장이 첨부·문서·결재 사본과 출력 준비에 전달된다',{timeout:30000},async()=>{
  const png=new PNG({width:1400,height:1200});randomFillSync(png.data);const bytes=PNG.sync.write(png);assert.ok(bytes.length>5*1024*1024&&bytes.length<=10*1024*1024);
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-large-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),cost=await (await call('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'가상',note:'',unitPrice:'1000',quantity:'1',unit:'개'},admin)).json();
    const upload=path=>fetch(base+path,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.png'},body:bytes});for(let i=0;i<5;i++)assert.equal((await upload(`/api/safety-costs/${cost.id}/photos?siteId=${site.id}`)).status,201);assert.equal((await upload(`/api/safety-cost-month-files?siteId=${site.id}&month=2026-10&date=2026-10-29`)).status,201);
    const report=await (await call('/api/safety-cost-reports','POST',{siteId:site.id,month:'2026-10',date:'2026-10-31',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'10000',budget:'3000',progressAmount:'1500',progress:'50'},admin)).json(),photos=await (await call(`/api/safety-cost-reports/${report.id}/photos`,'GET',null,admin)).json();assert.equal(photos.length,6);
    const images=photos.map(photo=>{const url=`/api/safety-cost-reports/${report.id}/photos/${photo.id}?preview=1`;return {getAttribute:()=>url,decode:async()=>{}};}),frozen=await freezeBatchImages(images,()=>true,{fetchImage:path=>call(path,'GET',null,admin),urls:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},digest:async data=>createHash('sha256').update(Buffer.from(data)).digest()});assert.ok(images.every(image=>image.src==='blob:virtual'));await frozen.check();frozen.dispose();
    const reviewer=await (await call('/api/reviewers','POST',{siteId:site.id,loginId:'large_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),signatureImage=new PNG({width:1,height:1});signatureImage.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(signatureImage).toString('base64'),path=`/api/documents/${report.id}`;
    assert.equal((await call(path+'/meeting-signature','POST',{signature},admin)).status,200);assert.equal((await call(path+'/approval-line','PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await call(path+'/transition','POST',{action:'submit'},admin)).status,200);
    const cookie=(await call('/api/reviewer/login','POST',{loginId:'large_reviewer',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],expected=createHash('sha256').update(bytes).digest('hex');for(const photo of photos){const response=await call(`/api/reviewer/documents/${report.id}/linked/cost-photo/${photo.cost_id}/${photo.id}?preview=1`,'GET',null,cookie);assert.equal(response.status,200);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),expected);}
    const other={getAttribute:()=>'/api/other',decode:async()=>{}};await assert.rejects(freezeBatchImages([other],()=>true,{fetchImage:async()=>({ok:true,blob:async()=>new Blob([bytes],{type:'image/png'})}),urls:{createObjectURL(){throw Error('unexpected');},revokeObjectURL(){}},digest:async()=>Buffer.alloc(32)}),/크기/);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
