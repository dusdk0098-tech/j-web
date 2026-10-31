import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';

test('허가서 업체 검색은 직영·협력사·현장·기간을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),a=s.createCompany({siteId:site.id,name:'가상 업체',trade:'가상'}),foreign=s.createCompany({siteId:other.id,name:'다른 업체',trade:'가상'}),add=(title,date,details)=>s.createAuthorizedDocument({siteId:site.id,type:'permit',title,date,details});
    const direct=add('직영 가상','2026-10-30',{directWork:true,companyId:0}),linked=add('업체 가상','2026-10-29',{companyId:a.id}),manual=add('직접 입력','2026-10-30',{company:'직접 업체'}),find=(company,from='',to='',query='')=>s.documents(site.id,'permit',query,from,to,'','','',company).map(row=>row.id);
    assert.deepEqual(find('direct'),[direct.id]);assert.deepEqual(find(String(a.id)),[linked.id]);assert.deepEqual(find(String(a.id),'2026-10-30','2026-10-30'),[]);assert.deepEqual(find('','','','직접 업체'),[manual.id]);
    assert.throws(()=>find(String(foreign.id)),/협력사/);assert.throws(()=>find('01'),/협력사/);assert.throws(()=>s.documents(site.id,'risk','','','','','','','direct'),/검색 조건/);
  }finally{s.close();}
});

test('검색 입력은 업체를 요청에 담고 다른 유형에서는 제외한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),wire=source.slice(source.indexOf('function wireSearch()'),source.indexOf('\n',source.indexOf('function wireSearch()'))),load=source.slice(source.indexOf('async function loadDocuments()'),source.indexOf('\n',source.indexOf('async function loadDocuments()')));
  const nodes={'#search':{},'#query':{value:'가상'},'#type-filter':{value:'permit'},'#document-from':{value:''},'#document-to':{value:''},'#permit-company-filter':{value:'direct'}},state={page:'documents',siteId:2,type:'permit'},calls=[],context={state,$:key=>nodes[key],content:{querySelectorAll:()=>[]},render:async()=>{},showError(){},flash(){},api:async path=>{calls.push(path);return [];},URLSearchParams};
  runInNewContext(wire+'\n'+load+'\nglobalThis.wireSearch=wireSearch;globalThis.loadDocuments=loadDocuments;',context);context.wireSearch();nodes['#search'].onclick();await context.loadDocuments();assert.match(calls[0],/permitCompany=direct/);
  nodes['#type-filter'].value='risk';nodes['#search'].onclick();await context.loadDocuments();assert.doesNotMatch(calls[1],/permitCompany/);
});

test('허가서 업체 검색 API는 관리자 인증과 현장을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-search-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await(await call('/api/sites','POST',{name:'가상 현장'},cookie)).json(),doc=await(await call('/api/documents','POST',{siteId:site.id,type:'permit',title:'가상 직영',date:'2026-10-30',details:{directWork:true,companyId:0}},cookie)).json(),path=`/api/documents?siteId=${site.id}&type=permit&permitCompany=direct`;
    assert.equal((await call(path)).status,401);const response=await call(path,'GET',null,cookie);assert.equal(response.status,200);assert.deepEqual((await response.json()).map(row=>row.id),[doc.id]);assert.equal((await call(path.replace('type=permit','type=risk'),'GET',null,cookie)).status,400);assert.equal((await call(path.replace('direct','999999'),'GET',null,cookie)).status,400);
  }finally{if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
