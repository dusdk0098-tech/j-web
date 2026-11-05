import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
const activity={kind:'weekly',date:'2026-11-03',periodFrom:'2026-11-01',periodTo:'2026-11-07',entryMode:'scan',place:'',host:'',participants:'',content:''};

test('활동 GIF와 회의록 파일의 형식·크기 경계를 검사한다',()=>{
 const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'평가',date:activity.date}),id=s.saveRiskActivity(doc.id,activity),photo=s.addRiskActivityPhoto(doc.id,id,'가상.gif',gif),minutes=s.addRiskActivityPhoto(doc.id,id,'회의.gif',gif,'minutes');assert.deepEqual(s.riskActivityPhotos(doc.id,id).map(x=>x.image_type),['image/gif','image/gif']);assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,minutes).data),gif);assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'잘못된.gif',Buffer.from('GIF89a')),/PNG/);const limit=Buffer.alloc(50*1024*1024,0x20);limit.write('%PDF-1.4');const max=s.addRiskActivityPhoto(doc.id,id,'최대.pdf',limit,'minutes');assert.equal(s.riskActivityPhotos(doc.id,id).find(row=>row.id===max).size,50*1024*1024);assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'큰 파일',Buffer.alloc(50*1024*1024+1),'minutes'),/50MB/);assert.equal(s.riskActivityPhotos(doc.id,id).length,3);assert.ok(photo);}finally{s.close();}
});

test('관리자 HTTP로 GIF와 2MB 초과 회의록을 저장하고 결재 사본에 보존한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-risk-files-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',value,cookie)=>fetch(base+path,{method,headers:{...(value?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(value?{body:JSON.stringify(value)}:{})}),cookie=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await call('/api/sites','POST',{name:'가상'},cookie)).json(),doc=await(await call('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:activity.date},cookie)).json(),path=`/api/documents/${doc.id}/risk-activities`,id=(await(await call(path,'POST',activity,cookie)).json()).id;
 const read=async()=>(await(await call(path,'GET',null,cookie)).json()).find(x=>x.id===id),upload=async(bytes,purpose)=>fetch(base+path+'/'+id+'/photos?purpose='+purpose,{method:'POST',headers:{cookie,'x-file-name':'virtual','x-risk-revision':(await read()).revision},body:bytes});
 assert.equal((await upload(Buffer.from('GIF89a'),'photo')).status,400);assert.equal((await upload(gif,'photo')).status,201);const pdf=Buffer.alloc(3*1024*1024,0x20);pdf.write('%PDF-1.4');const response=await upload(pdf,'minutes');assert.equal(response.status,201);const file=(await response.json()).id;assert.deepEqual(Buffer.from(await(await call(path+'/'+id+'/photos/'+file,'GET',null,cookie)).arrayBuffer()),pdf);const before=await(await call(`/api/documents/${doc.id}`,'GET',null,cookie)).json();assert.equal((await call(`/api/documents/${doc.id}/transition`,'POST',{action:'submit',expectedEditVersion:before.edit_version},cookie)).status,200);const record=await(await call(`/api/documents/${doc.id}`,'GET',null,cookie)).json(),snapshot=await call(`/api/documents/${doc.id}/approval-cycles/${record.approval_cycle_id}/files/risk/${id}/${file}`,'GET',null,cookie);assert.equal(snapshot.status,200);assert.deepEqual(Buffer.from(await snapshot.arrayBuffer()),pdf);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
