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
import {AdminAccounts} from '../admin-accounts.js';
import {trainingRoster} from '../public/training-groups.js';

test('교육 사진만 상세와 일괄 미리보기용 이미지로 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(line=>line.includes("file.category==='education_photo'")&&line.includes('insertAdjacentHTML'));assert.ok(line);
  let html='';const doc={id:7,type:'education'},attachments=[{id:3,category:'education_photo',name:'<가상>.png'},{id:4,category:'general',name:'일반.txt'}],content={querySelector:()=>({insertAdjacentHTML(_where,value){html=value;}})},esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');
  runInNewContext(line,{doc,attachments,content,esc});assert.match(html,/attachments\/3\?preview=1/);assert.match(html,/&lt;가상&gt;/);assert.doesNotMatch(html,/일반\.txt|<가상>/);
});

test('교육 대상 인원은 실제 선택된 근로자와 표시 가능한 직원을 따로 센다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(line=>line.includes('조회 시점 교육 대상'));assert.ok(line);
  const targets={configured:true,workers:[{id:1,selected:1},{id:2,selected:0}],managers:[{selected:1},{selected:0}]},roster=trainingRoster(targets),doc={type:'education'};let html='';const content={lastElementChild:{insertAdjacentHTML(_where,value){html=value;}}};
  runInNewContext(line,{doc,targets,roster,content,managerTargets:true});assert.match(html,/근로자 1명 · 직원 1명/);
  runInNewContext(line,{doc,targets,roster,content,managerTargets:false});assert.match(html,/근로자 1명/);assert.doesNotMatch(html,/직원/);
  targets.configured=false;runInNewContext(line,{doc,targets,roster:trainingRoster(targets),content,managerTargets:true});assert.match(html,/근로자 2명 · 직원 1명/);
});

test('교육 사진 미리보기는 로그인과 문서·첨부 일치를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-education-photo-')),store=new Store(join(dir,'jweb.sqlite'));
  const site=store.createSite({name:'가상'}),foreign=store.createSite({name:'다른 현장'}),auth=new AdminAccounts(store.db);auth.bootstrap('virtual-password-123');auth.create({loginId:'site_admin',name:'가상 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]});auth.create({loginId:'other_site_admin',name:'다른 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[foreign.id]});
  const doc=store.createDocument({siteId:site.id,type:'education',title:'가상 교육',date:'2026-11-01'}),other=store.createDocument({siteId:site.id,type:'education',title:'다른 교육',date:'2026-11-01'}),png=Buffer.from('89504e470d0a1a0a','hex'),photo=store.addAttachment(doc.id,'가상.png',png,'education_photo'),jpeg=store.addAttachment(doc.id,'가상.jpg',Buffer.from('ffd8ff','hex'),'education_photo'),general=store.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-password-123'})}),cookie=login.headers.get('set-cookie').split(';')[0],path=`/api/documents/${doc.id}/attachments/${photo}?preview=1`,get=(url,authenticated=true)=>fetch(base+url,{headers:authenticated?{cookie}:{}});
    assert.equal((await get(path,false)).status,401);const response=await get(path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    assert.equal((await get(`/api/documents/${other.id}/attachments/${photo}?preview=1`)).status,404);assert.equal((await get(`/api/documents/${doc.id}/attachments/${general}?preview=1`)).headers.get('content-type'),'application/octet-stream');assert.equal((await get(path.replace('?preview=1',''))).headers.get('content-type'),'application/octet-stream');assert.equal((await get(`/api/documents/${doc.id}/attachments/${jpeg}?preview=1`)).headers.get('content-type'),'image/jpeg');
    const restrictedLogin=async loginId=>(await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId,password:'virtual-password-123'})})).headers.get('set-cookie').split(';')[0];
    const own=await restrictedLogin('site_admin'),restrictedCookie=await restrictedLogin('other_site_admin');assert.equal((await fetch(base+path,{headers:{cookie:own}})).status,200);assert.equal((await fetch(base+path,{headers:{cookie:restrictedCookie}})).status,403);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
