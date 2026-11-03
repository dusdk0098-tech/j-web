import { fetchWithWorkerSession as fetch } from './helpers/worker-session-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {costImageType,safetyCostImageType} from '../cost-image.js';
import {freezeBatchImages} from '../public/batch-images.js';
import {createHash} from 'node:crypto';

const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
test('GIF 증빙은 형식·크기·종결 표식을 확인하고 다른 이미지 경로를 바꾸지 않는다',()=>{
  assert.equal(safetyCostImageType(gif),'image/gif');assert.equal(costImageType(gif),null);
  for(const bytes of [gif.subarray(0,13),Buffer.from('GIF89a'),Buffer.from(gif)]){if(bytes.length===gif.length)bytes[6]=0;assert.equal(safetyCostImageType(bytes),null);}
  const incomplete=Buffer.from(gif);incomplete[incomplete.length-1]=0;assert.equal(safetyCostImageType(incomplete),null);
});
test('일괄 출력 이미지 준비는 WebP를 허용하고 다른 형식은 거절한다',async()=>{
  const image={getAttribute:()=>'/api/virtual',decode:async()=>{}},urls={createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},digest=async bytes=>createHash('sha256').update(Buffer.from(bytes)).digest();
  const fetchImage=type=>async()=>({ok:true,blob:async()=>new Blob([Buffer.from('virtual')],{type})});
  const frozen=await freezeBatchImages([image],()=>true,{fetchImage:fetchImage('image/webp'),urls,digest});assert.equal(image.src,'blob:virtual');await frozen.check();frozen.dispose();
  await assert.rejects(freezeBatchImages([image],()=>true,{fetchImage:fetchImage('image/svg+xml'),urls,digest}),/형식/);
});
test('GIF 증빙과 월간 서류는 저장·보존 사본·지정 결재자 미리보기로 이어진다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-gif-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),reviewer=await (await call('/api/reviewers','POST',{siteId:site.id,loginId:'gif_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),cost=await (await call('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'가상',note:'',unitPrice:'1000',quantity:'1',unit:'개'},admin)).json();
    const photo='/api/safety-costs/'+cost.id+'/photos?siteId='+site.id,month='/api/safety-cost-month-files?siteId='+site.id+'&month=2026-10&date=2026-10-29&note=',upload=(path,data,cookie=admin)=>fetch(base+path,{method:'POST',headers:{...(cookie?{cookie}:{}),'x-file-name':'virtual.gif'},body:data});
    assert.equal((await upload(photo,gif,null)).status,401);assert.equal((await upload(photo,gif)).status,201);assert.equal((await upload(month,gif)).status,201);assert.equal((await upload(photo,Buffer.from('GIF89a'))).status,400);
    const report=await (await call('/api/safety-cost-reports','POST',{siteId:site.id,month:'2026-10',date:'2026-10-31',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'10000',budget:'3000',progressAmount:'1500',progress:'50'},admin)).json(),path='/api/documents/'+report.id,photos=await (await call('/api/safety-cost-reports/'+report.id+'/photos','GET',null,admin)).json();assert.equal(photos.length,2);
    for(const item of photos){const url='/api/safety-cost-reports/'+report.id+'/photos/'+item.id+'?preview=1',res=await call(url,'GET',null,admin);assert.equal(res.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await res.arrayBuffer()),gif);const image={getAttribute:()=>url,decode:async()=>{}};const frozen=await freezeBatchImages([image],()=>true,{fetchImage:source=>call(source,'GET',null,admin),urls:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},digest:async bytes=>createHash('sha256').update(Buffer.from(bytes)).digest()});assert.equal(image.src,'blob:virtual');await frozen.check();frozen.dispose();}
    const image=new PNG({width:1,height:1});image.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(image).toString('base64');assert.equal((await call(path+'/meeting-signature','POST',{signature},admin)).status,200);assert.equal((await call(path+'/approval-line','PUT',{reviewerIds:[reviewer.id]},admin)).status,200);assert.equal((await call(path+'/transition','POST',{action:'submit'},admin)).status,200);const cookie=(await call('/api/reviewer/login','POST',{loginId:'gif_reviewer',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    for(const item of photos){const file='/api/reviewer/documents/'+report.id+'/linked/cost-photo/'+item.cost_id+'/'+item.id+'?preview=1';assert.equal((await call(file)).status,401);const res=await call(file,'GET',null,cookie);assert.equal(res.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await res.arrayBuffer()),gif);}
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
