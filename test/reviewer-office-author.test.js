import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
const input={title:'가상 업무 문서',date:'2026-10-31',body:'가상 본문',details:{kind:'품의서'}};

test('직원 문서의 소유권과 변경 상태는 저장 중 다시 확인된다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),author=store.createReviewer({siteId:site.id,loginId:'author_lock',name:'가상 작성자',password:'virtual-password-123'}),other=store.createReviewer({siteId:site.id,loginId:'other_lock',name:'가상 직원',password:'virtual-password-123'});
    assert.throws(()=>store.createReviewerOfficeDocument(author.id,input,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.reviewerOfficeDocuments(author.id).length,0);
    const doc=store.createReviewerOfficeDocument(author.id,input),version=store.reviewerOfficeDetail(author.id,doc.id).version;assert.throws(()=>store.reviewerOfficeDocument(other.id,doc.id),/본인/);
    assert.throws(()=>store.updateReviewerOfficeDocument(author.id,doc.id,{...input,title:'변경'},version,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.document(doc.id).title,input.title);
    store.updateReviewerOfficeDocument(author.id,doc.id,{...input,title:'변경'},version);assert.throws(()=>store.updateReviewerOfficeDocument(author.id,doc.id,input,version),/변경/);assert.equal(store.document(doc.id).title,'변경');
    assert.throws(()=>store.setApprovalLine(doc.id,[author.id]),/작성자/);
  }finally{store.close();}
});

test('직원은 본인 문서를 작성해 다른 직원에게 결재를 요청하고 결과를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reviewer-office-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(root+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const script=await fetch(root+'/reviewer-office.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/text\/javascript/);
    const site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),make=async(siteId,loginId)=>await (await send('/api/reviewers','POST',{siteId,loginId,name:loginId,password:'virtual-password-123'},admin)).json();
    const author=await make(site.id,'office_author'),reviewer=await make(site.id,'office_reviewer'),outside=await make(otherSite.id,'office_outside'),login=async person=>(await send('/api/reviewer/login','POST',{loginId:person.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],one=await login(author),two=await login(reviewer),foreign=await login(outside),base='/api/reviewer/office-documents';
    assert.equal((await send(base)).status,401);assert.deepEqual((await (await send(base+'/options','GET',undefined,one)).json()).people.map(person=>person.id),[reviewer.id]);
    const created=await send(base,'POST',{...input,siteId:otherSite.id,type:'risk'},one);assert.equal(created.status,201);let data=await created.json(),path=`${base}/${data.document.id}`;assert.equal(data.document.site_id,site.id);assert.equal(data.document.type,'office');
    assert.equal((await send(path,'GET',undefined,two)).status,400);assert.equal((await send(path,'GET',undefined,foreign)).status,400);assert.deepEqual(await (await send(base,'GET',undefined,two)).json(),[]);
    const outsideDoc=await (await send(base,'POST',input,two)).json(),adminDoc=await (await send('/api/documents','POST',{...input,type:'office',siteId:site.id},admin)).json();
    for(const referenceDocId of [outsideDoc.document.id,adminDoc.id])assert.equal((await send(base,'POST',{...input,details:{kind:'품의서',referenceDocId}},one)).status,400);
    const ownReference=await send(base,'POST',{...input,title:'가상 참조',details:{kind:'품의서',referenceDocId:data.document.id}},one);assert.equal(ownReference.status,201);
    const oldVersion=data.version,updated=await send(path,'PUT',{...input,title:'변경된 가상 문서',version:data.version},one);assert.equal(updated.status,200);data=await updated.json();assert.equal((await send(path,'PUT',{...input,version:oldVersion},one)).status,409);
    assert.equal((await send(path,'PUT',{...input,details:{kind:'품의서',referenceDocId:outsideDoc.document.id},version:data.version},one)).status,400);
    assert.equal((await send(path+'/line','POST',{ids:[author.id],version:data.version},one)).status,400);assert.equal((await send(`/api/documents/${data.document.id}/approval-line`,'PUT',{reviewerIds:[author.id]},admin)).status,400);
    let result=await send(path+'/line','POST',{ids:[reviewer.id],version:data.version},one);assert.equal(result.status,200);data=await result.json();
    result=await send(path+'/references','POST',{ids:[reviewer.id],version:data.version},one);assert.equal(result.status,200);data=await result.json();
    result=await send(path+'/signature','POST',{signature,version:data.version},one);assert.equal(result.status,200);data=await result.json();assert.equal(data.hasSignature,true);
    result=await fetch(`${root}${path}/attachments?version=${encodeURIComponent(data.version)}`,{method:'POST',headers:{cookie:one,'x-file-name':'virtual.txt'},body:'가상 첨부'});assert.equal(result.status,201);data=await result.json();assert.equal(data.hasSignature,false);const file=data.attachments[0].id;
    assert.equal((await send(`${path}/attachments/${file}`,'GET',undefined,two)).status,400);assert.equal(await (await send(`${path}/attachments/${file}`,'GET',undefined,one)).text(),'가상 첨부');
    assert.equal((await send(path+'/transition','POST',{action:'submit',version:data.version},one)).status,400);data=await (await send(path+'/signature','POST',{signature,version:data.version},one)).json();
    result=await send(path+'/transition','POST',{action:'submit',version:data.version},one);assert.equal(result.status,200);data=await result.json();assert.equal(data.document.status,'pending');
    const reviewPath=`/api/reviewer/documents/${data.document.id}`,snapshot=await (await send(reviewPath,'GET',undefined,two)).json();assert.equal(snapshot.frozen,true);assert.equal(snapshot.document.title,'변경된 가상 문서');assert.equal(await (await send(`${reviewPath}/attachments/${file}`,'GET',undefined,two)).text(),'가상 첨부');
    assert.equal((await send(reviewPath+'/comments','POST',{opinion:'가상 의견'},two)).status,201);assert.equal((await send(path+'/transition','POST',{action:'withdraw',version:data.version},one)).status,409);
    data=await (await send(path,'GET',undefined,one)).json();assert.equal(data.events.at(-1).opinion,'가상 의견');assert.equal((await send(reviewPath+'/decision','POST',{action:'approve',opinion:'승인 시험',signature},two)).status,200);
    data=await (await send(path,'GET',undefined,one)).json();assert.equal(data.document.status,'approved');assert.equal(data.events.at(-1).reviewer_name,reviewer.name);assert.equal((await send(path,'PUT',{...input,version:data.version},one)).status,400);
    const reworkPath=`${base}/${outsideDoc.document.id}`;let rework=outsideDoc;rework=await (await send(reworkPath+'/line','POST',{ids:[author.id],version:rework.version},two)).json();rework=await (await send(reworkPath+'/signature','POST',{signature,version:rework.version},two)).json();
    rework=await (await send(reworkPath+'/transition','POST',{action:'submit',version:rework.version},two)).json();assert.equal(rework.document.status,'pending');rework=await (await send(reworkPath+'/transition','POST',{action:'withdraw',version:rework.version},two)).json();assert.equal(rework.document.status,'draft');
    rework=await (await send(reworkPath+'/transition','POST',{action:'submit',version:rework.version},two)).json();assert.equal((await send(`/api/reviewer/documents/${rework.document.id}/decision`,'POST',{action:'reject',opinion:'수정 시험'},one)).status,200);rework=await (await send(reworkPath,'GET',undefined,two)).json();assert.equal(rework.document.status,'rejected');
    rework=await (await send(reworkPath+'/transition','POST',{action:'revise',version:rework.version},two)).json();assert.equal(rework.document.status,'draft');
    assert.equal((await send('/api/reviewer/logout','POST',{},one)).status,200);assert.equal((await send(path,'GET',undefined,one)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
