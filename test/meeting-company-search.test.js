import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingHasCompany} from '../public/meeting-company-search.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('안전간담회에서 저장된 참석자 소속을 검색한다',()=>{
  const doc={details:JSON.stringify({workerSnapshot:[{company:'가상 협력사 A'}],managerSnapshot:[{company:'가상 관리자 업체'}]})};
  assert.equal(meetingHasCompany(doc,' 협력사 a '),true);
  assert.equal(meetingHasCompany(doc,'관리자 업체'),true);
  assert.equal(meetingHasCompany(doc,'다른 업체'),false);
  assert.equal(meetingHasCompany({details:'{}'},'가상'),false);
  assert.equal(meetingHasCompany({details:'{}'},''),true);
  assert.equal(meetingHasCompany({details:'null'},'가상'),false);
});

test('검색 버튼이 소속·기간을 적용하고 다른 문서 유형으로 전환하면 소속을 초기화한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(item=>item.startsWith('function wireSearch()'));assert.ok(line);
  const nodes={'#search':{},'#query':{value:'가상'},'#type-filter':{value:'safety_meeting'},'#document-from':{value:'2026-10-01'},'#document-to':{value:'2026-10-31'},'#meeting-company-filter':{value:' 가상 업체 '}},state={};let renders=0;
  const context={state,$:selector=>nodes[selector],content:{querySelectorAll:()=>[]},render:async()=>{renders++;},showError:error=>{throw error;},flash:()=>{},dateRangePreset:()=>{},today:()=>''};
  runInNewContext(line+'\nwireSearch();',context);nodes['#search'].onclick();assert.equal(state.meetingCompany,'가상 업체');assert.equal(state.documentFrom,'2026-10-01');assert.equal(state.query,'가상');assert.equal(renders,1);
  nodes['#type-filter'].value='education';nodes['#search'].onclick();assert.equal(state.meetingCompany,'');assert.equal(renders,2);
});

test('등록 협력사 선택은 소속 이름을 검색에 넣고 현장 변경은 조건을 지운다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),lines=source.split(/\r?\n/),markup=lines.find(line=>line.includes("state.type==='safety_meeting')$('#search').insertAdjacentHTML")),wiring=lines.find(line=>line.includes("if($('#meeting-company-filter')){const input")),siteChange=lines.find(line=>line.startsWith('siteSelect.onchange='));assert.ok(markup&&wiring&&siteChange);
  let html='',searched=0,selected='';const choice={get value(){return selected;},set value(value){selected=['','가상 <업체>','다른 업체'].includes(value)?value:'';}},nodes={'#search':{insertAdjacentHTML:(_pos,value)=>{html=value;},click:()=>searched++},'#meeting-company-filter':{value:''},'#meeting-company-choice':choice},state={page:'documents',type:'safety_meeting',siteId:1,meetingCompany:''},context={state,$:key=>nodes[key],riskCompanies:[{name:'가상 <업체>'},{name:'가상 <업체>'},{name:'다른 업체'}],esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),wireSearch(){},wireDocLinks(){},siteSelect:{value:'2'},render:async()=>{},showError:error=>{throw error;}};
  runInNewContext(markup+'\n'+wiring+'\n'+siteChange,context);assert.equal((html.match(/가상 &lt;업체&gt;<\/option>/g)||[]).length,1);assert.match(html,/이름이 같은 업체는 구분하지 않습니다/);choice.value='가상 <업체>';choice.onchange();assert.equal(nodes['#meeting-company-filter'].value,'가상 <업체>');nodes['#meeting-company-filter'].value='직접 입력';nodes['#meeting-company-filter'].oninput();assert.equal(choice.value,'');nodes['#meeting-company-filter'].onkeydown({key:'Enter'});assert.equal(searched,1);state.meetingCompany='이전 현장';context.siteSelect.onchange();assert.equal(state.meetingCompany,'');assert.equal(state.siteId,2);
});

test('저장된 참석자 소속과 현장·기간·내용 조건을 함께 적용한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const add=(siteId,date,company)=>{const worker=store.createWorker({siteId,name:'가상 근로자',category:'직영',company,occupation:'가상 직종'});store.setAttendance({siteId,workerId:worker.id,date,present:true});return {worker,doc:store.createDocument({siteId,type:'safety_meeting',title:'가상 회의',date,details:{workerIds:[worker.id]}})};};
    const target=add(site.id,'2026-10-02','가상 소속'),different=add(site.id,'2026-10-03','다른 소속');add(site.id,'2026-09-01','가상 소속');add(other.id,'2026-10-02','가상 소속');
    store.db.prepare('UPDATE workers SET company=? WHERE id=?').run('변경된 소속',target.worker.id);
    const docs=store.documents(site.id,'safety_meeting','가상','2026-10-01','2026-10-31');assert.equal(docs.length,2);
    const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(item=>item.includes('const author=state.page')&&item.includes('meetingHasCompany'));assert.ok(line);
    const context={state:{page:'documents',type:'safety_meeting',meetingCompany:'가상 소속'},docs,meetingHasCompany};runInNewContext(line+'\nglobalThis.result=filtered;',context);
    assert.deepEqual(Array.from(context.result,doc=>doc.id),[target.doc.id]);assert.ok(!context.result.some(doc=>doc.id===different.doc.id));
  }finally{store.close();}
});

test('실제 서버의 간담회 저장·조회와 소속 검색이 연결된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meeting-search-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const response=await send('/meeting-company-search.js');assert.equal(response.status,200);assert.match(await response.text(),/meetingHasCompany/);
    const login=await send('/api/login','POST',{password:'virtual-admin-password'}),admin=login.headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),worker=await(await send('/api/workers','POST',{siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 소속',occupation:'가상 직종'},admin)).json(),date='2026-10-02';
    assert.equal((await send('/api/attendance','POST',{siteId:site.id,workerId:worker.id,date,present:true},admin)).status,200);
    const created=await send('/api/documents','POST',{siteId:site.id,type:'safety_meeting',title:'가상 회의',date,details:{workerIds:[worker.id]}},admin);assert.equal(created.status,201);const doc=await created.json();
    const path=`/api/documents?siteId=${site.id}&type=safety_meeting&from=2026-10-01&to=2026-10-31`;assert.equal((await send(path)).status,401);const rows=await(await send(path,'GET',null,admin)).json();assert.deepEqual(rows.filter(row=>meetingHasCompany(row,'가상 소속')).map(row=>row.id),[doc.id]);assert.deepEqual(rows.filter(row=>meetingHasCompany(row,'다른 소속')),[]);
  }
  finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
