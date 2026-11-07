import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {PNG} from 'pngjs';

test('점검 사진은 해당 문서에만 저장하며 서명과 결재 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01',details:{rows:[{inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'없음'}]}}),other=s.createDocument({siteId:site.id,type:'education',title:'가상 교육',date:'2026-11-01'}),image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image),signature='data:image/png;base64,'+bytes.toString('base64');
    assert.throws(()=>s.addAttachment(other.id,'사진.png',bytes,'inspection_photo'),/첨부 구분/);assert.throws(()=>s.addAttachment(doc.id,'위조.png',Buffer.from('가상'),'inspection_photo'),/PNG/);
    s.saveMeetingSignature(doc.id,signature);const photo=s.addAttachment(doc.id,'사진.png',bytes,'inspection_photo');assert.equal(s.meetingSignature(doc.id),null);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');const cycle=s.approvalCycle(doc.id,s.document(doc.id).approval_cycle_id);assert.equal(cycle.attachments.find(file=>file.id===Number(photo)).category,'inspection_photo');assert.throws(()=>s.deleteAttachment(photo),/임시저장/);
  }finally{s.close();}
});

test('점검 사진만 상세 및 미리보기용 이미지로 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(line=>line.includes("file.category==='inspection_photo'")&&line.includes('insertAdjacentHTML'));assert.ok(line);let html='';
  const doc={id:7,type:'inspection'},attachments=[{id:3,category:'inspection_photo',name:'<사진>.png'},{id:4,category:'general',name:'일반.txt'}],content={querySelector:()=>({insertAdjacentHTML(_where,value){html=value;}})},esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');runInNewContext(line,{doc,attachments,content,esc});
  assert.match(html,/attachments\/3\?preview=1/);assert.match(html,/&lt;사진&gt;/);assert.doesNotMatch(html,/일반\.txt|<사진>/);
});

test('결재자 화면은 보존된 요청의 점검 사진만 표시한다',()=>{
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(line=>line.includes("file.category==='inspection_photo'")&&line.includes('insertAdjacentHTML'));assert.ok(line);let html='';
  const id=7,doc={type:'inspection',approval_cycle_id:22},result={frozen:true,attachments:[{id:3,category:'inspection_photo',name:'<사진>.png'},{id:4,category:'general',name:'일반.txt'}]},detail={querySelector:()=>({insertAdjacentHTML(_where,value){html=value;}})},esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');
  runInNewContext(line,{id,doc,result,detail,esc});assert.match(html,/attachments\/3\?preview=1&amp;cycle=22/);assert.match(html,/&lt;사진&gt;/);assert.doesNotMatch(html,/일반\.txt|<사진>/);html='';result.frozen=false;runInNewContext(line,{id,doc,result,detail,esc});assert.equal(html,'');
});

test('결재자 사진은 요청 당시 사본과 결재 차수 및 권한을 검사한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-inspection-review-')),s=new Store(join(dir,'jweb.sqlite')),site=s.createSite({name:'가상'}),password='virtual-password-123',reviewer=s.createReviewer({siteId:site.id,loginId:'photo_reviewer',name:'가상 결재자',password}),other=s.createReviewer({siteId:site.id,loginId:'other_reviewer',name:'다른 결재자',password}),doc=s.createDocument({siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01',details:{rows:[{inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'없음'}]}}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),photo=s.addAttachment(doc.id,'사진.png',bytes,'inspection_photo');s.saveMeetingSignature(doc.id,'data:image/png;base64,'+bytes.toString('base64'));s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.db.prepare('UPDATE attachments SET data=? WHERE id=?').run(Buffer.from('ffd8ff','hex'),photo);s.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=async loginId=>(await fetch(base+'/api/reviewer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId,password})})).headers.get('set-cookie').split(';')[0],cookie=await login('photo_reviewer'),foreign=await login('other_reviewer'),path=`/api/reviewer/documents/${doc.id}/attachments/${photo}`,get=(url,c)=>fetch(base+url,{headers:c?{cookie:c}:{}});
    assert.equal((await get(`${path}?preview=1&cycle=${cycle}`)).status,401);assert.equal((await get(`${path}?preview=1&cycle=${cycle}`,foreign)).status,404);assert.equal((await get(`${path}?preview=1&cycle=${Number(cycle)+1}`,cookie)).status,409);assert.equal((await get(`${path}?preview=1`,cookie)).status,409);
    const response=await get(`${path}?preview=1&cycle=${cycle}`,cookie);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal((await get(path,cookie)).headers.get('content-type'),'application/octet-stream');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('점검 사진 HTTP는 인증과 문서 일치를 검사한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-inspection-photo-')),s=new Store(join(dir,'jweb.sqlite')),site=s.createSite({name:'가상'}),doc=s.createDocument({siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01',details:{rows:[{inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'없음'}]}}),other=s.createDocument({siteId:site.id,type:'inspection',title:'다른 점검',date:'2026-11-01'}),photo=s.addAttachment(doc.id,'사진.jpg',Buffer.from('ffd8ff','hex'),'inspection_photo');s.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-password-123'})}),cookie=login.headers.get('set-cookie').split(';')[0],path=`/api/documents/${doc.id}/attachments/${photo}?preview=1`;
    assert.equal((await fetch(base+path)).status,401);const response=await fetch(base+path,{headers:{cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal((await fetch(base+`/api/documents/${other.id}/attachments/${photo}?preview=1`,{headers:{cookie}})).status,404);
    const upload=`${base}/api/documents/${doc.id}/attachments?category=inspection_photo`,image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image),headers={'x-file-name':encodeURIComponent('가상.png')};
    assert.equal((await fetch(upload,{method:'POST',headers,body:bytes})).status,401);const created=await fetch(upload,{method:'POST',headers:{...headers,cookie},body:bytes});assert.equal(created.status,201);const id=(await created.json()).id,preview=await fetch(`${base}/api/documents/${doc.id}/attachments/${id}?preview=1`,{headers:{cookie}});assert.equal(preview.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
    assert.equal((await fetch(upload,{method:'POST',headers:{...headers,cookie},body:Buffer.from('잘못된 파일')})).status,400);assert.equal((await(await fetch(`${base}/api/documents/${doc.id}/attachments`,{headers:{cookie}})).json()).length,2);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
