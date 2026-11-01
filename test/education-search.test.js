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
import {educationKinds} from '../public/education-kinds.js';

test('관리감독자 교육은 네 종류를 저장·검색하고 이전 구분을 유지한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상 근로자',category:'직영',occupation:'목공',loginId:'education_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});s.setWorkerPermissions(site.id,worker.id,['training']);const kinds=['supervisor_new','supervisor_regular','supervisor_special','supervisor_changed'],legacy=s.createAuthorizedDocument({siteId:site.id,type:'education',title:'이전 가상 교육',date:'2026-10-01',details:{kind:'supervisor'}});for(const kind of kinds){const doc=s.createWorkerDocument(site.id,worker.id,{type:'education',title:'가상 교육',date:'2026-10-01',details:{kind}});assert.equal(JSON.parse(s.workerDocument(site.id,worker.id,doc.id).details).kind,kind);assert.deepEqual(s.documents(site.id,'education','','','','','','','','','',kind).map(row=>row.id),[doc.id]);assert.match(educationKinds[kind],/관리감독자/);}assert.deepEqual(s.documents(site.id,'education','','','','','','','','','','supervisor').map(row=>row.id),[legacy.id]);assert.match(educationKinds.supervisor,/미기록/);
  }finally{s.close();}
});

test('근로자 교육 열람은 관리감독자 세부 유형의 이름을 표시한다',async()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('    const loadTraining=async'),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);const trainingList={items:[],replaceChildren(){this.items=[];},append(node){this.items.push(node);}},document={createElement(){return {children:[],append(...items){this.children.push(...items);},setAttribute(){}};}},item={type:'education',title:'가상 교육',details:{kind:'supervisor_special'},body:'가상',files:[],has_signature:true},fetch=async()=>({ok:true,json:async()=>[item]});await runInNewContext(`(async()=>{${source.slice(start,end)} await loadTraining();})()`,{trainingList,document,fetch,educationKinds});assert.match(trainingList.items[0].children[1].textContent,/관리감독자 특별교육/);
});

test('결재 문서 상세는 교육 유형을 한국어로 표시하고 다른 문서 값은 보존한다',()=>{
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=source.indexOf('function displayFields('),end=source.indexOf('function pad(',start),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));assert.ok(start>=0&&end>start);const render=runInNewContext(source.slice(start,end)+';displayDocumentDetails',{educationKinds,esc,labels:{kind:'종류'},selectedMusculoskeletalItems:items=>items});assert.match(render({type:'education',details:JSON.stringify({kind:'supervisor_special'})}),/관리감독자 특별교육/);assert.match(render({type:'education',details:JSON.stringify({kind:'supervisor'})}),/세부 구분 미기록/);assert.match(render({type:'risk',details:JSON.stringify({kind:'supervisor_special'})}),/supervisor_special/);assert.doesNotMatch(render({type:'education',details:JSON.stringify({kind:'<가상>'})}),/<가상>/);assert.equal(render({type:'education',details:'null'}),'');
});

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
    assert.equal((await call(path)).status,401);assert.deepEqual((await (await call(path,'GET',null,cookie)).json()).map(row=>row.id),[doc.id]);assert.equal((await call(path.replace('regular','invalid'),'GET',null,cookie)).status,400);assert.equal((await call(path.replace('type=education','type=tbm'),'GET',null,cookie)).status,400);const asset=await call('/education-kinds.js');assert.equal(asset.status,200);assert.match(await asset.text(),/supervisor_special/);const created=await call('/api/documents','POST',{siteId:site.id,type:'education',title:'가상 감독 교육',date:'2026-10-02',details:{kind:'supervisor_special'}},cookie);assert.equal(created.status,201);const special=await created.json();assert.deepEqual((await (await call(path.replace('regular','supervisor_special'),'GET',null,cookie)).json()).map(row=>row.id),[special.id]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
