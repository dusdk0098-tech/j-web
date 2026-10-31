import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { dailyReportPhotos } from '../public/daily-report-photos.js';

test('일보 사진 목록은 파일명과 설명을 안전하게 표시한다',()=>{
  const photo={kind:'site',id:8,name:'<가상 사진>.png',description:'<script>설명</script>',version:'a'.repeat(64)},html=dailyReportPhotos(2,3,[photo]);
  assert.match(html,/\/api\/sites\/2\/daily-reports\/3\/print-photos\/site\/8\?version=a{64}/);assert.match(html,/&lt;가상 사진&gt;\.png/);assert.match(html,/&lt;script&gt;설명&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(dailyReportPhotos(2,3,[]),/사진이 없습니다/);assert.throws(()=>dailyReportPhotos(2,3,[{...photo,version:'잘못된 값'}]),/다시 조회/);assert.throws(()=>dailyReportPhotos(2,3,[{...photo,kind:'../site'}]),/다시 조회/);
});

test('일보 사진 포함 출력은 현장·날짜·내용 변경을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-daily-photo-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0];
    const site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json(),input={siteId:site.id,type:'daily_report',title:'가상 일보',date:'2026-10-30'},doc=await (await call('/api/documents','POST',input,admin)).json(),different=await (await call('/api/documents','POST',{...input,type:'notice',title:'가상 공지'},admin)).json();
    const reviewer=await (await call('/api/reviewers','POST',{siteId:site.id,loginId:'photo_reviewer',name:'시험 계정',password:'virtual-password-123'},admin)).json(),reviewerCookie=(await call('/api/reviewer/login','POST',{loginId:reviewer.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),upload=async(path,name,data)=>{const response=await fetch(base+path,{method:'POST',headers:{cookie:admin,'x-file-name':encodeURIComponent(name)},body:data});assert.equal(response.status,201);return (await response.json()).id;};
    const attachments=`/api/documents/${doc.id}/attachments`,nonImage=await upload(attachments,'가상.txt',Buffer.from('<svg>')),photoId=await upload(attachments,'가상 일보.png',bytes),sitePhoto=await upload(`/api/site-photos?siteId=${site.id}`,'가상 현장.png',bytes),otherDate=await upload(`/api/site-photos?siteId=${site.id}`,'다른 날짜.png',bytes),otherSite=await upload(`/api/site-photos?siteId=${other.id}`,'다른 현장.png',bytes);
    const editPhoto=(id,siteId,date,description)=>call(`/api/site-photos/${id}?siteId=${siteId}`,'PUT',{date,description},admin);assert.equal((await editPhoto(sitePhoto,site.id,input.date,'가상 설명')).status,200);assert.equal((await editPhoto(otherDate,site.id,'2026-10-29','')).status,200);assert.equal((await editPhoto(otherSite,other.id,input.date,'')).status,200);
    const path=`/api/sites/${site.id}/daily-reports/${doc.id}/print-photos`;assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',null,reviewerCookie)).status,401);assert.equal((await call(path.replace(`/sites/${site.id}/`,`/sites/${other.id}/`),'GET',null,admin)).status,404);assert.equal((await call(path.replace(`/daily-reports/${doc.id}/`,`/daily-reports/${different.id}/`),'GET',null,admin)).status,404);
    const response=await call(path,'GET',null,admin);assert.equal(response.status,200);const photos=await response.json();assert.deepEqual(photos.map(({kind,id})=>({kind,id})),[{kind:'attachment',id:photoId},{kind:'site',id:sitePhoto}]);assert.ok(photos.every(photo=>!('bytes' in photo)&&photo.type==='image/png'));assert.equal(photos[1].description,'가상 설명');assert.equal((await call(`${path}/attachment/${nonImage}?version=${'a'.repeat(64)}`,'GET',null,admin)).status,404);
    const asset=await call('/daily-report-photos.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
    const photoPath=photo=>`${path}/${photo.kind}/${photo.id}?version=${photo.version}`,image=await call(photoPath(photos[1]),'GET',null,admin);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);assert.equal((await call(photoPath(photos[1]))).status,401);
    assert.equal((await editPhoto(sitePhoto,site.id,input.date,'수정된 설명')).status,200);assert.equal((await call(photoPath(photos[1]),'GET',null,admin)).status,409);assert.equal((await editPhoto(sitePhoto,site.id,'2026-10-29','수정된 설명')).status,200);assert.equal((await call(photoPath(photos[1]),'GET',null,admin)).status,404);
    assert.equal((await call(`/api/attachments/${photoId}`,'DELETE',null,admin)).status,200);png.data[0]=255;const replaced=await upload(attachments,'새 사진.png',PNG.sync.write(png));assert.equal(replaced,photoId);assert.equal((await call(photoPath(photos[0]),'GET',null,admin)).status,409);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
