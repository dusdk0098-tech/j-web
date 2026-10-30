import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';
import { officeSourceContent } from '../public/office-template.js';

const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

test('업무 문서 복사는 같은 현장의 내용과 연결만 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-copy-')),file=join(dir,'test.sqlite');let s=new Store(file);
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),base={siteId:a.id,type:'office',title:'가상 품의',date:'2026-10-30',body:'가상 내용',details:{kind:'품의서'}},ref=s.createDocument(base),source=s.createDocument({...base,title:'가상 경비',details:{kind:'경비청구',referenceId:ref.id}}),reviewer=s.createReviewer({siteId:a.id,loginId:'copy_reviewer',name:'가상 결재자',password:'virtual-password-123'});s.addAttachment(source.id,'가상.txt',Buffer.from('가상 첨부'));s.setApprovalLine(source.id,[reviewer.id]);s.setOfficeReferences(source.id,[reviewer.id]);s.saveMeetingSignature(source.id,signature);
    const before=s.documents(a.id,'office').length;assert.throws(()=>s.copyOfficeDocument(source.id,{siteId:b.id,title:'복사',date:'2026-10-31'}),/현장/);assert.throws(()=>s.copyOfficeDocument(source.id,{siteId:a.id,title:'',date:'2026-10-31'}));assert.equal(s.documents(a.id,'office').length,before);
    const copy=s.copyOfficeDocument(source.id,{siteId:a.id,title:'새 가상 문서',date:'2026-10-31'});assert.equal(copy.copied_from,source.id);assert.equal(copy.status,'draft');assert.equal(copy.body,'가상 내용');assert.equal(JSON.parse(copy.details).referenceId,ref.id);assert.deepEqual(s.attachments(copy.id),[]);assert.deepEqual(s.approvalLine(copy.id),[]);assert.deepEqual(s.officeReferences(copy.id),[]);assert.equal(s.meetingSignature(copy.id),null);assert.deepEqual(s.events(copy.id),[]);
    assert.equal(s.documents(a.id,'office').find(row=>row.id===copy.id).copied_from,source.id);s.close();s=new Store(file);assert.equal(s.document(copy.id).copied_from,source.id);
    s.updateDocument(ref.id,{...base,details:{kind:'기타',otherKind:'가상 구분'}});assert.throws(()=>s.copyOfficeDocument(source.id,{siteId:a.id,title:'다시 복사',date:'2026-10-31'}),/품의서/);assert.equal(s.documents(a.id,'office').length,before+1);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('업무 문서 복사 API는 관리자와 같은 현장으로 제한한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-office-copy-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 현장'},admin)).json(),reviewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'copy_review',name:'가상 결재자',password:'virtual-password-123'},admin)).json(),review=(await send('/api/reviewer/login','POST',{loginId:reviewer.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],doc=await (await send('/api/documents','POST',{siteId:site.id,type:'office',title:'가상 문서',date:'2026-10-30',body:'가상 내용',details:{kind:'품의서'}},admin)).json(),path=`/api/documents/${doc.id}/copy-office`,input={siteId:site.id,title:'가상 복사',date:'2026-10-31'};
    assert.equal((await send(`/api/documents/${doc.id}`)).status,401);const fetched=await (await send(`/api/documents/${doc.id}`,'GET',undefined,admin)).json();assert.deepEqual(officeSourceContent(fetched,site.id),{title:'가상 문서',body:'가상 내용',rich:null});assert.throws(()=>officeSourceContent(fetched,other.id),/현장/);
    assert.equal((await send(path,'POST',input)).status,401);assert.equal((await send(path,'POST',input,review)).status,401);assert.equal((await send(path,'POST',{...input,siteId:other.id},admin)).status,400);const result=await send(path,'POST',input,admin);assert.equal(result.status,201);const copy=await result.json();assert.equal(copy.copied_from,doc.id);assert.equal(copy.status,'draft');assert.equal(copy.body,'가상 내용');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
