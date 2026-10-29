import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';

test('별도 시험 결재자는 자기 차례의 현장 문서만 열고 순서대로 승인한다',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,session)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(session?{cookie:session}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),login=await send('/api/login','POST',{password:'virtual-admin-password'}),admin=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/review')).status,200);assert.equal((await send('/review.js')).status,200);assert.equal((await send('/api/reviewer/documents')).status,401);
    const site=await (await send('/api/sites','POST',{name:'가상 A'},admin)).json(),other=await (await send('/api/sites','POST',{name:'가상 B'},admin)).json();
    const create=async(siteId,loginId)=>{const res=await send('/api/reviewers','POST',{siteId,loginId,name:loginId,password:'virtual-password-123'},admin);assert.equal(res.status,201);return res.json();};
    const first=await create(site.id,'virtual_first'),second=await create(site.id,'virtual_second'),outsider=await create(other.id,'virtual_other');
    assert.equal((await send('/api/reviewers','POST',{siteId:site.id,loginId:'virtual_first',name:'중복',password:'virtual-password-123'},admin)).status,400);
    const doc=await (await send('/api/documents','POST',{siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29',body:'가상 내용'},admin)).json(),path=`/api/documents/${doc.id}`;
    const uploaded=await fetch(`${base}${path}/attachments`,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'가상 첨부'});assert.equal(uploaded.status,201);const fileId=(await uploaded.json()).id;
    assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[first.id,outsider.id]},admin)).status,400);assert.equal((await send(`${path}/approval-line`,'PUT',{reviewerIds:[first.id,second.id]},admin)).status,200);assert.equal((await send(`${path}/transition`,'POST',{action:'submit'},admin)).status,200);
    const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;
    assert.equal((await send(`${path}/transition`,'POST',{action:'approve',signature},admin)).status,400);assert.equal((await send('/api/documents/batch-approve','POST',{siteId:site.id,ids:[doc.id],signature},admin)).status,400);
    const reviewLogin=async loginId=>{const res=await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];};
    const firstCookie=await reviewLogin('virtual_first'),secondCookie=await reviewLogin('virtual_second'),otherCookie=await reviewLogin('virtual_other'),reviewPath=`/api/reviewer/documents/${doc.id}`;
    assert.equal((await send('/api/sites','GET',undefined,firstCookie)).status,401);assert.equal((await send(reviewPath,'GET',undefined,secondCookie)).status,404);assert.equal((await send(reviewPath,'GET',undefined,otherCookie)).status,404);
    assert.deepEqual((await (await send('/api/reviewer/documents','GET',undefined,firstCookie)).json()).map(item=>item.id),[doc.id]);assert.equal((await (await send(reviewPath,'GET',undefined,firstCookie)).json()).document.title,'가상 교육');
    assert.equal(await (await send(`${reviewPath}/attachments/${fileId}`,'GET',undefined,firstCookie)).text(),'가상 첨부');assert.equal((await send(`${reviewPath}/decision`,'POST',{action:'approve'},firstCookie)).status,400);assert.equal((await send(`${reviewPath}/decision`,'POST',{action:'approve',signature},secondCookie)).status,404);
    assert.equal((await send(`${reviewPath}/decision`,'POST',{action:'approve',signature,opinion:'시험 의견'},firstCookie)).status,200);assert.equal((await (await send(path,'GET',undefined,admin)).json()).status,'pending');assert.equal((await send(reviewPath,'GET',undefined,firstCookie)).status,404);
    assert.equal((await send(`${reviewPath}/decision`,'POST',{action:'approve',signature},secondCookie)).status,200);assert.equal((await (await send(path,'GET',undefined,admin)).json()).status,'approved');const events=await (await send(`${path}/events`,'GET',undefined,admin)).json();assert.deepEqual(events.filter(e=>e.action==='approve').map(e=>e.reviewer_name),['virtual_first','virtual_second']);assert.deepEqual(Buffer.from(await (await send(`${path}/events/${events.at(-1).id}/signature`,'GET',undefined,admin)).arrayBuffer()),bytes);
    assert.equal((await send(`/api/reviewers/${first.id}`,'PUT',{siteId:other.id,active:false},admin)).status,400);assert.equal((await send(`/api/reviewers/${first.id}`,'PUT',{siteId:site.id,password:'short'},admin)).status,400);assert.equal((await send('/api/reviewer/session','GET',undefined,firstCookie)).status,200);
    assert.equal((await send(`/api/reviewers/${first.id}`,'PUT',{siteId:site.id,active:false},admin)).status,200);assert.equal((await send('/api/reviewer/session','GET',undefined,firstCookie)).status,401);assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'virtual-password-123'})).status,401);
    assert.equal((await send(`/api/reviewers/${first.id}`,'PUT',{siteId:site.id,active:true},admin)).status,200);const newFirstCookie=await reviewLogin('virtual_first');assert.equal((await send(`/api/reviewers/${first.id}`,'PUT',{siteId:site.id,password:'virtual-password-456'},admin)).status,200);assert.equal((await send('/api/reviewer/session','GET',undefined,newFirstCookie)).status,401);assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'virtual-password-123'})).status,401);
    const renewed=await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'virtual-password-456'});assert.equal(renewed.status,200);const renewedCookie=renewed.headers.get('set-cookie').split(';')[0];assert.equal((await send('/api/reviewer/logout','POST',{},renewedCookie)).status,200);assert.equal((await send('/api/reviewer/session','GET',undefined,renewedCookie)).status,401);
    for(let i=0;i<10;i++)assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'wrong'})).status,401);assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'virtual-password-456'})).status,429);assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_second',password:'virtual-password-123'})).status,200);assert.equal((await send('/api/reviewer/login','POST',{loginId:'virtual_first',password:'virtual-password-456'})).status,429);
  }finally{child.kill();await once(child,'exit').catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
