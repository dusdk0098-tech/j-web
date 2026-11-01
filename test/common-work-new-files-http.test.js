import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { newWorkWithFiles } from '../public/common-work-view.js';

const input={date:'2026-11-01',title:'가상 첨부 HTTP 검증',category:'공정회의',content:'가상 내용',status:'published'};
const files=[{name:'가상1.txt',size:3},{name:'가상2.txt',size:3}];
test('실제 HTTP 신규 두 첨부·게시와 세션·버전·작성자·현장 경계',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-new-files-')),reservation=createServer();
  await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,signal:AbortSignal.timeout(5000),headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const read=async response=>{const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{status:response.status});return data;};
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];
    const site=await read(await call('/api/sites','POST',{name:'가상 첨부 현장'},admin)),other=await read(await call('/api/sites','POST',{name:'다른 가상 현장'},admin));
    const make=async(siteId,loginId)=>{
      await read(await call('/api/reviewers','POST',{siteId,loginId,name:loginId,password:'virtual-password-123'},admin));
      return (await call('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    };
    const author=await make(site.id,'files_author'),peer=await make(site.id,'files_peer'),foreign=await make(other.id,'files_foreign');
    const path='/api/reviewer/common-work',list=async cookie=>read(await call(path,'GET',null,cookie));
    const workflow=(cookie,{afterUpload=async()=>{}}={})=>{
      const events=[],versions=[];
      const save=newWorkWithFiles({
        create:async data=>{events.push('create');return read(await call(path,'POST',{...data,siteId:other.id},cookie));},
        upload:async(row,file)=>{
          events.push('upload');versions.push(row.version);
          const result=await read(await fetch(base+`${path}/${row.id}/files?version=${encodeURIComponent(row.version)}&siteId=${other.id}`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{cookie,'x-file-name':encodeURIComponent(file.name)},body:'abc'}));
          await afterUpload(row,result,events.filter(event=>event==='upload').length);return result;
        },
        publish:async(row,data)=>{events.push('publish');versions.push(data.version);return read(await call(`${path}/${row.id}`,'PUT',data,cookie));}
      });return {save,events,versions};
    };
    const success=workflow(author);await success.save(input,files);assert.deepEqual(success.events,['create','upload','upload','publish']);assert.equal(new Set(success.versions).size,3);
    const row=(await list(author))[0];assert.equal(row.status,'published');assert.equal(row.site_id,site.id);assert.deepEqual(row.files.map(file=>file.name),files.map(file=>file.name));
    await assert.rejects(success.save(input,files),/이미 저장/);assert.equal((await list(author)).length,1);assert.equal((await list(peer)).length,1);assert.deepEqual(await list(foreign),[]);
    for(const file of row.files){assert.equal(await (await call(`${path}/${row.id}/files/${file.id}`,'GET',null,peer)).text(),'abc');assert.equal((await call(`${path}/${row.id}/files/${file.id}`,'GET',null,foreign)).status,404);}
    assert.equal((await call(`${path}/${row.id}`,'PUT',{...input,title:'무권한 변경',version:row.version},peer)).status,400);
    const conflict=workflow(author,{afterUpload:async(saved,result,count)=>{if(count===2)await read(await call(`${path}/${saved.id}`,'PUT',{...input,status:'draft',title:'다른 변경',version:result.version},author));}});
    await assert.rejects(conflict.save({...input,title:'버전 경계'},files),error=>error.cause.status===409);assert.deepEqual(conflict.events,['create','upload','upload','publish']);
    const conflicted=(await list(author)).find(item=>item.title==='다른 변경');assert.equal(conflicted.status,'draft');assert.equal(conflicted.files.length,2);
    const expired=workflow(author,{afterUpload:async(saved,result,count)=>{if(count===1)assert.equal((await call('/api/reviewer/logout','POST',null,author)).status,200);}});
    await assert.rejects(expired.save({...input,title:'세션 경계'},files),error=>error.cause.status===401);assert.deepEqual(expired.events,['create','upload','upload']);
    await assert.rejects(expired.save(input,files),/이미 저장/);
    const all=await read(await call(`/api/common-work?siteId=${site.id}`,'GET',null,admin)),partial=all.find(item=>item.title==='세션 경계');assert.equal(partial.status,'draft');assert.equal(partial.files.length,1);assert.equal(all.length,3);
    assert.deepEqual((await list(peer)).map(item=>item.id),[row.id]);assert.deepEqual(await list(foreign),[]);
  }finally{
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});
