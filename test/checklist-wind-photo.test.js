import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const input=(siteId,kind='wind')=>({siteId,type:'checklist',title:'가상 점검',date:'2026-11-06',details:{kind,answers:Array.from({length:kind==='wind'?9:7},()=>({answer:'O',note:''})),...(kind==='wind'?{photoNote:'가상 사진 비고'}:{})}});
const png=()=>{const image=new PNG({width:1,height:1});image.data[3]=255;return PNG.sync.write(image);};

test('점검 사진은 형식·종류를 확인하고 종류 변경 시 보존한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),wind=s.createDocument(input(site.id)),rain=s.createDocument(input(site.id,'rain')),bytes=png();
  assert.throws(()=>s.addAttachment(rain.id,'가상.png',bytes,'wind_check_photo'),/첨부 구분/);
  assert.throws(()=>s.addAttachment(wind.id,'가상.png',Buffer.from('invalid'),'wind_check_photo'),/PNG/);
  const id=s.addAttachment(wind.id,'가상.png',bytes,'wind_check_photo');assert.equal(s.attachments(wind.id)[0].category,'wind_check_photo');
  assert.throws(()=>s.updateDocument(wind.id,input(site.id,'rain')),/사진을 삭제/);assert.equal(JSON.parse(s.document(wind.id).details).kind,'wind');
  s.transition(wind.id,'submit');const cycle=s.document(wind.id).approval_cycle_id,snapshot=s.approvalCycle(wind.id,cycle);assert.equal(snapshot.attachments[0].category,'wind_check_photo');assert.deepEqual(Buffer.from(s.approvalCycleFile(wind.id,cycle,'document',0,id).data),bytes);assert.throws(()=>s.deleteAttachment(id),/첨부파일/);
  s.transition(wind.id,'withdraw');s.deleteAttachment(id);s.updateDocument(wind.id,input(site.id,'rain'));assert.equal(JSON.parse(s.document(wind.id).details).kind,'rain');assert.deepEqual(Buffer.from(s.approvalCycleFile(wind.id,cycle,'document',0,id).data),bytes);
 }finally{s.close();}
});

test('태풍 점검 사진은 문서 범위와 로그인 권한을 확인해 표시된다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-wind-photo-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',body,cookie)=>fetch(base+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const login=await send('/api/login','POST',{password:'virtual-admin-password'}),cookie=login.headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},cookie)).json();
  const wind=await(await send('/api/documents','POST',input(site.id),cookie)).json(),other=await(await send('/api/documents','POST',input(site.id,'rain'),cookie)).json(),bytes=png();
  const upload=await fetch(base+`/api/documents/${wind.id}/attachments?category=wind_check_photo`,{method:'POST',headers:{cookie,'x-file-name':'virtual.png'},body:bytes});assert.equal(upload.status,201);const file=await upload.json(),url=`/api/documents/${wind.id}/checklist-photos/${file.id}`;
  assert.equal((await send(url)).status,401);const response=await send(url,'GET',undefined,cookie);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await send(`/api/documents/${other.id}/checklist-photos/${file.id}`,'GET',undefined,cookie)).status,404);
  const photos=await(await send(`/api/documents/${wind.id}/attachments`,'GET',undefined,cookie)).json();assert.equal(photos[0].category,'wind_check_photo');
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});

test('점검 상세에는 연결된 항목 사진만 안전하게 표시한다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(String.fromCharCode(10)).find(item=>item.includes("['morning','wind'].includes(details.kind)")&&item.includes('const morning='));assert.ok(line);
 let html='';const content={querySelector:()=>({insertAdjacentHTML:(_where,value)=>{html+=value;}})},esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 runInNewContext(line,{doc:{id:7,type:'checklist'},details:{kind:'wind'},attachments:[{id:5,category:'wind_check_photo',name:'<가상>.png'},{id:6,category:'general',name:'일반.png'}],content,esc});
 assert.match(html,/10번 항목 시험 사진/);assert.match(html,/checklist-photos\/5/);assert.match(html,/&lt;가상&gt;/);assert.doesNotMatch(html,/<가상>|일반\.png/);
});

test('결재 참조 화면은 항목 사진의 구분을 표시한다',async()=>{
 const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),line=source.split(String.fromCharCode(10)).find(item=>item.startsWith('async function openReference('));assert.ok(line);
 const detail={dataset:{}},esc=value=>String(value??''),api=async()=>({document:{id:2,type:'checklist',title:'가상',date:'2026-11-06'},attachments:[{id:5,name:'가상.png',category:'wind_check_photo'}],linked:null});
 await runInNewContext(line+';openReference(2)',{detail,esc,api,displayDocumentDetails:()=>'',planLinks:()=>''});assert.match(detail.innerHTML,/10번 항목 사진/);
});
