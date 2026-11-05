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

test('순회 사진은 문서 종류와 이미지 형식을 검사하고 서명을 초기화한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),doc=s.createDocument({siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-11-01'}),other=s.createDocument({siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01'}),image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image),signature='data:image/png;base64,'+bytes.toString('base64');
    assert.throws(()=>s.addAttachment(other.id,'사진.png',bytes,'patrol_photo'),/첨부 구분/);assert.throws(()=>s.addAttachment(doc.id,'사진.png',Buffer.from('가상'),'patrol_photo'),/PNG/);
    s.saveMeetingSignature(doc.id,signature);const photo=s.addAttachment(doc.id,'사진.png',bytes,'patrol_photo');assert.equal(s.meetingSignature(doc.id),null);s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');const cycle=s.approvalCycle(doc.id,s.document(doc.id).approval_cycle_id);assert.equal(cycle.attachments.find(file=>file.id===Number(photo)).category,'patrol_photo');assert.throws(()=>s.deleteAttachment(photo),/임시저장/);
  }finally{s.close();}
});

test('순회 상세와 결재 화면은 해당 사진만 안전하게 표시한다',()=>{
  const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),attachments=[{id:3,category:'patrol_photo',name:'<사진>.png'},{id:4,category:'general',name:'일반.txt'}],doc={id:7,type:'patrol',approval_cycle_id:22};let html='';const element={querySelector:()=>({insertAdjacentHTML(_where,value){html=value;}})};
  const line=file=>readFileSync(new URL(file,import.meta.url),'utf8').split(/\r?\n/).find(value=>value.includes("file.category==='patrol_photo'")&&value.includes('insertAdjacentHTML'));
  runInNewContext(line('../public/app.js'),{doc,attachments,content:element,esc});assert.match(html,/attachments\/3\?preview=1/);assert.match(html,/&lt;사진&gt;/);assert.doesNotMatch(html,/일반\.txt|<사진>/);
  html='';const result={frozen:true,attachments};runInNewContext(line('../public/review.js'),{id:7,doc,result,detail:element,esc});assert.match(html,/attachments\/3\?preview=1&amp;cycle=22/);assert.doesNotMatch(html,/일반\.txt|<사진>/);html='';result.frozen=false;runInNewContext(line('../public/review.js'),{id:7,doc,result,detail:element,esc});assert.equal(html,'');
});

test('순회 사진 HTTP는 권한과 결재 차수를 검사하며 요청 당시 사본을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-patrol-photo-')),s=new Store(join(dir,'jweb.sqlite')),site=s.createSite({name:'가상'}),password='virtual-password-123',reviewer=s.createReviewer({siteId:site.id,loginId:'patrol_reviewer',name:'가상 결재자',password});s.createReviewer({siteId:site.id,loginId:'other_reviewer',name:'다른 결재자',password});const doc=s.createDocument({siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-11-01'}),draft=s.createDocument({siteId:site.id,type:'patrol',title:'다른 순회',date:'2026-11-01'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),photo=s.addAttachment(doc.id,'사진.png',bytes,'patrol_photo');s.saveMeetingSignature(doc.id,'data:image/png;base64,'+bytes.toString('base64'));s.setApprovalLine(doc.id,[reviewer.id]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.db.prepare('UPDATE attachments SET data=? WHERE id=?').run(Buffer.from('ffd8ff','hex'),photo);s.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=async(loginId)=>(await fetch(base+'/api/reviewer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId,password})})).headers.get('set-cookie').split(';')[0],cookie=await login('patrol_reviewer'),foreign=await login('other_reviewer'),path=`/api/reviewer/documents/${doc.id}/attachments/${photo}`,get=(url,c)=>fetch(base+url,{headers:c?{cookie:c}:{}});
    assert.equal((await get(`${path}?preview=1&cycle=${cycle}`)).status,401);assert.equal((await get(`${path}?preview=1&cycle=${cycle}`,foreign)).status,404);assert.equal((await get(`${path}?preview=1`,cookie)).status,409);assert.equal((await get(`${path}?preview=1&cycle=${Number(cycle)+1}`,cookie)).status,409);const response=await get(`${path}?preview=1&cycle=${cycle}`,cookie);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    const admin=(await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})})).headers.get('set-cookie').split(';')[0],adminPath=`/api/documents/${doc.id}/attachments/${photo}?preview=1`;assert.equal((await get(adminPath)).status,401);assert.equal((await get(adminPath,admin)).headers.get('content-type'),'image/jpeg');assert.equal((await get(`/api/documents/${draft.id}/attachments/${photo}?preview=1`,admin)).status,404);
    const upload=`${base}/api/documents/${draft.id}/attachments?category=patrol_photo`,headers={'x-file-name':encodeURIComponent('가상.png')};assert.equal((await fetch(upload,{method:'POST',headers,body:bytes})).status,401);const created=await fetch(upload,{method:'POST',headers:{...headers,cookie:admin},body:bytes});assert.equal(created.status,201);const preview=await get(`/api/documents/${draft.id}/attachments/${(await created.json()).id}?preview=1`,admin);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);assert.equal((await fetch(upload,{method:'POST',headers:{...headers,cookie:admin},body:Buffer.from('잘못된 파일')})).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('전역 순회 점검 상세는 항목별 판정과 개선 내용을 표로 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(String.fromCharCode(10)).find(line=>line.includes("if(doc.type==='patrol')")&&line.includes('순회 점검 내용'));assert.ok(line);let html='';
  const doc={type:'patrol'},details={inspector:'가상 <점검자>',items:[{name:'가상 <항목>',result:'X',note:'가상 <조치>'}]},content={querySelector:()=>({insertAdjacentHTML(_where,value){html=value;}})},esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');runInNewContext(line,{doc,details,content,esc});for(const text of ['<th>점검 항목</th>','<th>결과</th>','<th>개선대책 지시 / 비고</th>','가상 &lt;점검자&gt;','가상 &lt;항목&gt;','가상 &lt;조치&gt;'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/<항목>|<조치>/);
});
