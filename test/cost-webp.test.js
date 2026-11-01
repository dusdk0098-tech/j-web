import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {costImageType} from '../cost-image.js';

const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
test('WebP 표식과 크기를 확인하고 잘못된 파일은 거절한다',()=>{
  assert.equal(costImageType(webp),'image/webp');const malformed=Buffer.from(webp);malformed[4]=0;assert.equal(costImageType(malformed),null);assert.equal(costImageType(Buffer.from('RIFF0000WEBP','ascii')),null);
});
test('WebP 증빙과 월간 서류는 보존 사본과 결재 미리보기에서 제공된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-webp-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),worker=await (await call('/api/reviewers','POST',{siteId:site.id,loginId:'webp_reviewer',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),cost=await (await call('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'가상',note:'',unitPrice:'1000',quantity:'1',unit:'개'},admin)).json();
    const photo='/api/safety-costs/'+cost.id+'/photos?siteId='+site.id,month='/api/safety-cost-month-files?siteId='+site.id+'&month=2026-10&date=2026-10-29&note=',upload=(path,data)=>fetch(base+path,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.webp'},body:data});assert.equal((await upload(photo,webp)).status,201);assert.equal((await upload(month,webp)).status,201);assert.equal((await upload(photo,Buffer.from('RIFF0000WEBP'))).status,400);
    const report=await (await call('/api/safety-cost-reports','POST',{siteId:site.id,month:'2026-10',date:'2026-10-31',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'10000',budget:'3000',progressAmount:'1500',progress:'50'},admin)).json(),path='/api/documents/'+report.id,photos=await (await call('/api/safety-cost-reports/'+report.id+'/photos','GET',null,admin)).json();assert.equal(photos.length,2);for(const item of photos){const res=await call('/api/safety-cost-reports/'+report.id+'/photos/'+item.id+'?preview=1','GET',null,admin);assert.equal(res.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await res.arrayBuffer()),webp);}
    const image=new PNG({width:1,height:1});image.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(image).toString('base64');assert.equal((await call(path+'/meeting-signature','POST',{signature},admin)).status,200);assert.equal((await call(path+'/approval-line','PUT',{reviewerIds:[worker.id]},admin)).status,200);assert.equal((await call(path+'/transition','POST',{action:'submit'},admin)).status,200);const reviewer=(await call('/api/reviewer/login','POST',{loginId:'webp_reviewer',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];for(const item of photos){const res=await call('/api/reviewer/documents/'+report.id+'/linked/cost-photo/'+item.cost_id+'/'+item.id+'?preview=1','GET',null,reviewer);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await res.arrayBuffer()),webp);}
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
