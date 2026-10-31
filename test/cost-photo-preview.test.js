import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {PNG} from 'pngjs';

test('월간 문서 사진은 여섯 장씩 표시하고 설명을 안전하게 넣는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(doc.type==='cost'&&Array.isArray(details.rows)){const photos="),end=source.indexOf('\n',start);assert.ok(start>=0);
  let html='';const photos=Array.from({length:7},(_,i)=>({id:i+1,cost_id:1,name:'<가상>.png'})),context={doc:{type:'cost',id:9},details:{rows:[{id:1,description:'<시험>'}]},api:async()=>photos,content:{querySelector:()=>({insertAdjacentHTML:(_position,value)=>{html=value;}})},esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;')};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.equal((html.match(/class="cost-photo-page"/g)||[]).length,2);assert.equal((html.match(/\?preview=1/g)||[]).length,7);assert.match(html,/&lt;시험&gt;/);assert.doesNotMatch(html,/<시험>/);
});

test('영수증은 별도 페이지로 나누고 일반 사진 순서를 유지한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(doc.type==='cost'&&Array.isArray(details.rows)){const photos="),end=source.indexOf('\n',start);assert.ok(start>=0);
  let html='';const photos=[{id:1,cost_id:1,name:'사진.png',kind:'photo'},{id:2,cost_id:1,name:'영수증.png',kind:'receipt'},{id:3,cost_id:1,name:'사진2.png',kind:'photo'}],context={doc:{type:'cost',id:9},details:{rows:[{id:1,description:'가상'}]},api:async()=>photos,content:{querySelector:()=>({insertAdjacentHTML:(_position,value)=>{html=value;}})},esc:String};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);assert.equal((html.match(/class="cost-photo-page"/g)||[]).length,2);assert.equal((html.match(/class="cost-photo-page receipt"/g)||[]).length,1);assert.ok(html.indexOf('사진.png')<html.indexOf('영수증.png'));assert.ok(html.indexOf('영수증.png')<html.indexOf('사진2.png'));
});

test('문서 사진 미리보기는 관리자에게만 이미지로 제공하고 다운로드를 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-preview-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),cookie=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},cookie)).json(),cost=await(await send('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'가상 내역',note:'',unitPrice:'1000',quantity:'1',unit:'개'},cookie)).json();
    const image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image);assert.equal((await fetch(`${base}/api/safety-costs/${cost.id}/photos?siteId=${site.id}`,{method:'POST',headers:{cookie,'x-file-name':'virtual.png'},body:bytes})).status,201);assert.equal((await fetch(`${base}/api/safety-costs/${cost.id}/photos?siteId=${site.id}`,{method:'POST',headers:{cookie,'x-file-name':'receipt.png','x-cost-photo-kind':'receipt'},body:bytes})).status,201);assert.equal((await fetch(`${base}/api/safety-costs/${cost.id}/photos?siteId=${site.id}`,{method:'POST',headers:{cookie,'x-file-name':'bad.png','x-cost-photo-kind':'invalid'},body:bytes})).status,400);
    const report=await(await send('/api/safety-cost-reports','POST',{siteId:site.id,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1000',progress:'50'},cookie)).json(),photos=await(await send(`/api/safety-cost-reports/${report.id}/photos`,'GET',undefined,cookie)).json(),path=`/api/safety-cost-reports/${report.id}/photos/${photos[0].id}`;
    assert.deepEqual(photos.map(photo=>photo.kind),['photo','receipt']);assert.equal((await send(`${path}?preview=1`)).status,401);const preview=await send(`${path}?preview=1`,'GET',undefined,cookie);assert.equal(preview.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);const download=await send(path,'GET',undefined,cookie);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  }finally{if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
