import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';

test('교육 검색은 현장·종류·기간·검색어를 조합하고 미분류를 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),other=s.createSite({name:'다른 현장'}),add=(siteId,title,date,kind)=>s.createAuthorizedDocument({siteId,type:'education',title,date,details:kind?{kind}:{}}),regular=add(site.id,'가상 정기','2026-10-01','regular'),risk=add(site.id,'가상 위험','2026-10-02','risk'),empty=add(site.id,'미분류','2026-10-03',''),foreign=add(other.id,'다른 현장','2026-10-01','regular'),find=(kind='',query='',from='',to='')=>s.documents(site.id,'education',query,from,to,'','','','','','',kind).map(row=>row.id);
    assert.deepEqual(find('regular'),[regular.id]);assert.deepEqual(find('risk','가상'),[risk.id]);assert.deepEqual(find('regular','','2026-10-02'),[]);assert.deepEqual(find(),[empty.id,risk.id,regular.id]);assert.ok(!find('regular').includes(foreign.id));assert.throws(()=>find('invalid'),/교육 종류/);assert.throws(()=>s.documents(site.id,'tbm','','','','','','','','','','regular'),/교육 종류/);
  }finally{s.close();}
});

test('교육 검색 화면은 선택 종류를 전달하고 유형 변경 시 초기화한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),wire=source.slice(source.indexOf('function wireSearch()'),source.indexOf('\n',source.indexOf('function wireSearch()'))),load=source.slice(source.indexOf('async function loadDocuments()'),source.indexOf('\n',source.indexOf('async function loadDocuments()'))),nodes={'#search':{},'#query':{value:'가상'},'#type-filter':{value:'education'},'#education-kind-filter':{value:'regular'},'#document-from':{value:'2026-10-01'},'#document-to':{value:'2026-10-31'}},state={page:'documents',siteId:1,type:'education'},calls=[],context={state,$:selector=>nodes[selector],content:{querySelectorAll:()=>[]},render:async()=>{},showError(){},flash(){},api:async path=>{calls.push(path);return [];},URLSearchParams};
  runInNewContext(wire+'\n'+load+'\nglobalThis.wireSearch=wireSearch;globalThis.loadDocuments=loadDocuments;',context);context.wireSearch();nodes['#search'].onclick();await context.loadDocuments();assert.match(calls[0],/educationKind=regular/);assert.match(calls[0],/from=2026-10-01/);nodes['#type-filter'].value='tbm';nodes['#search'].onclick();await context.loadDocuments();assert.doesNotMatch(calls[1],/educationKind/);assert.equal(state.educationKind,'');
});

test('교육 종류 검색 API는 관리자 인증과 종류를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-education-search-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},cookie)).json(),doc=await (await call('/api/documents','POST',{siteId:site.id,type:'education',title:'가상 교육',date:'2026-10-01',details:{kind:'regular'}},cookie)).json(),path=`/api/documents?siteId=${site.id}&type=education&educationKind=regular`;
    assert.equal((await call(path)).status,401);assert.deepEqual((await (await call(path,'GET',null,cookie)).json()).map(row=>row.id),[doc.id]);assert.equal((await call(path.replace('regular','invalid'),'GET',null,cookie)).status,400);assert.equal((await call(path.replace('type=education','type=tbm'),'GET',null,cookie)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
