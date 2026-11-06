import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {Store} from '../store.js';
import {mountWorkerTransfer} from '../public/worker-transfer-view.js';

test('출역 전환 API는 관리자 권한과 변경 확인을 검사하고 감사 기록을 보존한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-transfer-')),store=new Store(join(dir,'jweb.sqlite'));
 const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 가상 현장'}),make=name=>store.createWorker({siteId:site.id,name,category:'직영',company:'가상',occupation:'가상'}),source=make('기존'),target=make('대상'),source2=make('화면 기존'),target2=make('화면 대상'),date='2026-11-01';
 store.setAttendance({siteId:site.id,workerId:source.id,date,present:true});store.setAttendance({siteId:site.id,workerId:source2.id,date,present:true});const prior=new PNG({width:1,height:1});prior.data[3]=255;const priorSignature=PNG.sync.write(prior);store.db.prepare('INSERT INTO worker_self_checks(worker_id,date,signature,answers) VALUES(?,?,?,?)').run(source.id,date,priorSignature,'{}');store.close();
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
  const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie,headers={})=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),path='/api/attendance/transfers',params={siteId:site.id,sourceId:source.id,targetId:target.id,date};
  assert.equal((await call(path+'/preview','POST',params)).status,401);
  const login=await call('/api/login','POST',{password:'virtual-admin-password'}),admin=login.headers.get('set-cookie').split(';')[0];
  const created=await call('/api/admin-accounts','POST',{loginId:'restricted_transfer',name:'가상 제한 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]},admin);assert.equal(created.status,201);
  const restricted=(await call('/api/login','POST',{loginId:'restricted_transfer',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
  assert.equal((await call(path+'/preview','POST',params,restricted)).status,403);
  assert.equal((await call(path,'POST',params,restricted)).status,403);
  let preview=await (await call(path+'/preview','POST',params,admin)).json();assert.equal(preview.counts.attendance,1);assert.deepEqual(preview.conflicts,[]);
  const png=new PNG({width:1,height:1});png.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64'),input={...params,version:preview.version,requestId:'00000000-0000-4000-8000-000000000001',signature};
  assert.equal((await call(path,'POST',input,admin,{origin:base})).status,409);
  assert.equal((await call('/api/attendance/units','PUT',{siteId:site.id,workerId:source.id,date,units:'1.25'},admin)).status,200);
  assert.equal((await call(path,'POST',input,admin)).status,409);preview=await (await call(path+'/preview','POST',params,admin)).json();input.version=preview.version;
  const response=await call(path,'POST',input,admin);assert.equal(response.status,200);const event=await response.json();assert.ok(event.id>0);
  assert.equal((await (await call(path,'POST',input,admin)).json()).id,event.id);
  assert.equal((await call(path,'POST',{...input,targetId:source.id},admin)).status,409);
  assert.equal((await call(`${path}/${event.id}?siteId=${site.id}`,'GET',null,restricted)).status,403);
  assert.equal((await call(`${path}/${event.id}?siteId=${other.id}`,'GET',null,admin)).status,404);
  assert.equal((await call(`${path}?siteId=${site.id}&date=${date}`,'GET',null,restricted)).status,403);
  const history=await (await call(`${path}?siteId=${site.id}&date=${date}`,'GET',null,admin)).json();assert.equal(history.length,1);assert.equal(history[0].id,event.id);
  assert.deepEqual(await (await call(`${path}?siteId=${other.id}&date=${date}`,'GET',null,admin)).json(),[]);
  assert.deepEqual(await (await call(`${path}?siteId=${site.id}&date=2026-11-02`,'GET',null,admin)).json(),[]);
  const auditResponse=await call(`${path}/${event.id}?siteId=${site.id}`,'GET',null,admin),audit=await auditResponse.json();assert.equal(auditResponse.status,200);assert.equal(audit.source_id,source.id);assert.equal(audit.target_id,target.id);assert.equal(audit.records[0].kind,'attendance');assert.equal(audit.signature,undefined);
  const consent=`${path}/${event.id}/signature?siteId=${site.id}`,saved=await call(consent,'GET',null,admin);assert.equal(saved.status,200);assert.deepEqual(Buffer.from(await saved.arrayBuffer()),PNG.sync.write(png));assert.equal((await call(consent)).status,401);assert.equal((await call(consent,'GET',null,restricted)).status,403);assert.equal((await call(`${path}/${event.id}/signature?siteId=${other.id}`,'GET',null,admin)).status,404);
  const record=audit.records.find(row=>row.kind==='selfChecks'),query=new URLSearchParams({siteId:String(site.id),kind:record.kind,key:record.record_key}),previous=await call(`${path}/${event.id}/signature?${query}`,'GET',null,admin);assert.equal(previous.status,200);assert.deepEqual(Buffer.from(await previous.arrayBuffer()),priorSignature);assert.equal((await call(`${path}/${event.id}/signature?${new URLSearchParams({siteId:String(site.id),kind:'selfChecks',key:'[\"다른 날짜\"]'})}`,'GET',null,admin)).status,404);assert.equal((await call(`${path}/${event.id}/signature?${new URLSearchParams({siteId:String(site.id),kind:'unknown',key:'[]'})}`,'GET',null,admin)).status,400);
  const keys=['[data-source]','[data-target]','[data-preview]','[data-result]','[data-sign]','[data-submit]','[data-clear]','[data-refresh]','canvas','[data-sign-title]'],nodes=Object.fromEntries(keys.map(key=>[key,{value:'',disabled:false,hidden:false,textContent:'',style:{},selectedOptions:[{textContent:'화면 대상'}],click(){this.onclick?.();}}])),panel={isConnected:true,innerHTML:'',querySelector:key=>nodes[key]};let completed;
  const uiApi=async(url,options)=>{const result=await call(url,options.method||'GET',options.body?JSON.parse(options.body):null,admin),data=await result.json();if(!result.ok)throw Error(data.error);return data;};
  mountWorkerTransfer({panel,rows:[source2,target2],siteId:site.id,date,esc:String,api:uiApi,signaturePad:(_canvas,clear)=>{clear.onclick=()=>{};return()=>signature;},current:()=>true,onComplete:async result=>{completed=result;},onRefresh:()=>{}});
  nodes['[data-source]'].value=String(source2.id);nodes['[data-target]'].value=String(target2.id);await nodes['[data-preview]'].onclick();assert.equal(nodes['[data-sign]'].hidden,false);await nodes['[data-submit]'].onclick();assert.ok(completed.id>event.id);
  const screenAudit=await (await call(`${path}/${completed.id}?siteId=${site.id}`,'GET',null,admin)).json();assert.equal(screenAudit.source_id,source2.id);assert.equal(screenAudit.target_id,target2.id);

 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
