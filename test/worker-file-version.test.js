import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {workerPreviewArticles} from '../public/worker-preview.js';

test('일괄 출력은 이미지 원문만 포함하고 다른 파일은 별도 확인으로 표시한다',()=>{
  const worker={id:1,site_id:2,name:'가상',category:'직영',ppe:[],files:[{id:3,name:'가상.png',category:'other',imageType:'image/png',version:'a'.repeat(32)},{id:4,name:'가상.pdf',category:'other',imageType:null,version:'b'.repeat(32)}]};
  const html=workerPreviewArticles([worker],{includeImages:true});assert.match(html,/\/api\/workers\/1\/files\/3\?siteId=2&amp;version=a{32}&amp;preview=1/);assert.match(html,/가상.pdf · 원문 별도 확인/);assert.doesNotMatch(workerPreviewArticles([worker]),/preview=1/);
});

test('기존 서류를 이관하고 번호가 재사용돼도 이전 버전으로 삭제하지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-file-')),path=join(dir,'db.sqlite');let store;
  try{store=new Store(path);const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종'});store.addWorkerFile(site.id,worker.id,'other','가상.txt',Buffer.from('이전'));store.close();store=null;
    const legacy=new DatabaseSync(path);legacy.exec('ALTER TABLE worker_files DROP COLUMN version');legacy.close();store=new Store(path);const first=store.workerFiles(site.id,worker.id)[0];assert.match(first.version,/^[a-f0-9]{32}$/);store.close();store=new Store(path);assert.equal(store.workerFiles(site.id,worker.id)[0].version,first.version);
    assert.throws(()=>store.deleteWorkerFile(site.id,worker.id,first.id,first.version,()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.workerFiles(site.id,worker.id).length,1);store.deleteWorkerFile(site.id,worker.id,first.id,first.version);store.addWorkerFile(site.id,worker.id,'other','가상.txt',Buffer.from('신규'));const next=store.workerFiles(site.id,worker.id)[0];assert.equal(next.id,first.id);assert.notEqual(next.version,first.version);assert.throws(()=>store.deleteWorkerFile(site.id,worker.id,next.id,first.version),e=>e.sessionStatus===409);assert.equal(store.workerFiles(site.id,worker.id).length,1);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('서류 다운로드와 삭제는 이전 화면의 파일 버전을 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-file-http-')),reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),worker=await (await call('/api/workers','POST',{siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종'},admin)).json(),path=`/api/workers/${worker.id}/files?siteId=${site.id}`,upload=()=>fetch(base+path+'&category=other',{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.txt'},body:'test'}),list=async()=>await (await call(path,'GET',null,admin)).json();
    assert.equal((await upload()).status,201);const first=(await list())[0],file=`/api/workers/${worker.id}/files/${first.id}?siteId=${site.id}&version=${first.version}`;assert.equal((await call(file,'GET',null,admin)).status,200);assert.equal((await call(file+'&preview=1','GET',null,admin)).status,415);assert.equal((await call(file,'DELETE',null,admin)).status,200);assert.equal((await upload()).status,201);assert.equal((await list())[0].id,first.id);assert.equal((await call(file,'GET',null,admin)).status,409);assert.equal((await call(file,'DELETE',null,admin)).status,409);assert.equal((await list()).length,1);assert.equal((await call(file)).status,401);
    const png=Buffer.from('89504e470d0a1a0a00000000','hex');assert.equal((await fetch(base+path+'&category=other',{method:'POST',headers:{cookie:admin,'x-file-name':'image.png'},body:png})).status,201);const image=(await list())[1];assert.equal(image.imageType,'image/png');const imagePath=`/api/workers/${worker.id}/files/${image.id}?siteId=${site.id}`;assert.equal((await call(imagePath+'&preview=1','GET',null,admin)).status,400);const preview=await call(imagePath+'&version='+image.version+'&preview=1','GET',null,admin);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),png);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
