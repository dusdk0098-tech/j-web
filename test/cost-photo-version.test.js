import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('증빙 목록은 표시된 사진의 확인값을 다운로드와 삭제 요청에 포함한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    let photoEpoch=0;document.querySelectorAll('[data-cost-photos]')"),end=source.indexOf("\n    $('#new-cost').onclick",start),button={dataset:{costPhotos:'7'},click(){}},remove={dataset:{deleteCostPhoto:'9'}},panel={isConnected:true,innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[remove]},photo={id:9,name:'가상.png',kind:'photo',version:'a'.repeat(32)},calls=[],state={siteId:1,page:'safety-costs'};assert.ok(start>=0&&end>start);const context={state,siteId:1,epoch:2,detailEpoch:2,data:{rows:[{id:7,description:'가상'}]},document:{querySelectorAll:()=>[button]},$:()=>panel,api:async(path,options)=>{calls.push({path,options});return options?{}:[photo];},esc:String,encodeURIComponent,confirm:()=>true,showError:error=>{throw error;}};runInNewContext(source.slice(start,end),context);await button.onclick();assert.match(panel.innerHTML,/&amp;version=a{32}/);await remove.onclick();assert.match(calls[1].path,/&version=a{32}$/);assert.equal(calls[1].options.method,'DELETE');
});

test('사진 번호가 재사용돼도 이전 화면의 다운로드와 삭제는 새 사진을 변경하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-photo-version-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),cost=await (await call('/api/safety-costs','POST',{siteId:site.id,category:'2',date:'2026-10-29',description:'가상',note:'',unitPrice:'1000',quantity:'1',unit:'개'},admin)).json(),list='/api/safety-costs/'+cost.id+'/photos?siteId='+site.id,bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),upload=()=>fetch(base+list,{method:'POST',headers:{cookie:admin,'x-file-name':'virtual.png'},body:bytes}),getList=async()=>await (await call(list,'GET',null,admin)).json();
    assert.equal((await upload()).status,201);const first=(await getList())[0],path='/api/safety-costs/'+cost.id+'/photos/'+first.id+'?siteId='+site.id+'&version='+first.version;assert.match(first.version,/^[a-f0-9]{32}$/);assert.equal((await call(path,'GET',null,admin)).status,200);assert.equal((await call(path,'DELETE',null,admin)).status,200);assert.equal((await upload()).status,201);const second=(await getList())[0];assert.equal(second.id,first.id);assert.notEqual(second.version,first.version);assert.equal((await call(path,'GET',null,admin)).status,409);assert.equal((await call(path,'DELETE',null,admin)).status,409);assert.equal((await getList()).length,1);assert.equal((await call(path.replace(first.version,second.version),'DELETE',null,admin)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
