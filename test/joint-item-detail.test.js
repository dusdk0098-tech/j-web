import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { recordInput } from '../domain.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('합동 점검 항목별 보완과 조치는 수정·결재 사본에 보존되고 구형 수정에서 손실되지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'joint_inspection',title:'시험 점검',date:'2026-11-05',details:{items:[{name:'가상 항목',result:'보완사항',issueDetail:' 가상 문제 ',action:' 가상 조치 '}]}};
    const doc=s.createDocument(input),read=()=>JSON.parse(s.document(doc.id).details).items[0];
    assert.deepEqual(read(),{name:'가상 항목',result:'보완사항',issueDetail:'가상 문제',action:'가상 조치'});
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{name:'가상 항목',result:'양호'}]}}),/보존/);
    assert.equal(read().issueDetail,'가상 문제');
    s.updateDocument(doc.id,{...input,details:{items:[{...input.details.items[0],action:'새 조치'}]}});s.transition(doc.id,'submit');
    const saved=s.document(doc.id),snapshot=s.approvalCycle(doc.id,saved.approval_cycle_id);
    assert.equal(JSON.parse(snapshot.document.details).items[0].action,'새 조치');
    for(const bad of [null,7,'x'.repeat(2001)])assert.throws(()=>recordInput({...input,details:{items:[{...input.details.items[0],action:bad}]}}),/점검 항목/);
  }finally{s.close();}
});

test('작성 화면은 항목별 입력을 안전하게 표시하고 저장 요청에 포함한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('const addItem=item=>'),end=source.indexOf('\n',start);
  assert.ok(start>=0&&end>start);let html='';const remove={};
  const list={insertAdjacentHTML(_where,value){html=value;},lastElementChild:{querySelector(){return remove;}}};
  const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const add=runInNewContext(source.slice(start,end)+';addItem',{esc,$:()=>list});
  add({name:'<항목>',result:'보완사항',issueDetail:'<문제>',action:'<조치>'});
  assert.match(html,/&lt;항목&gt;/);assert.match(html,/data-joint-issue[^>]*>&lt;문제&gt;/);assert.match(html,/data-joint-action[^>]*>&lt;조치&gt;/);
  const expression=source.match(/items:\[\.\.\.document\.querySelectorAll\('\[data-joint-item\]'\)\]\.map\(row=>\(\{[^}]+\}\)\)/)?.[0];assert.ok(expression);
  const fields={input:{value:'항목'},select:{value:'보완사항'},'[data-joint-issue]':{value:'문제'},'[data-joint-action]':{value:'조치'}},row={querySelector:key=>fields[key]};
  const payload=runInNewContext(`({${expression}})`,{document:{querySelectorAll:()=>[row]}});
  assert.deepEqual(JSON.parse(JSON.stringify(payload.items)),[{name:'항목',result:'보완사항',issueDetail:'문제',action:'조치'}]);
});

test('HTTP에서 항목별 내용을 저장하고 구형 수정 요청에 의한 손실을 차단한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-joint-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json();
    const input={siteId:site.id,type:'joint_inspection',title:'시험 점검',date:'2026-11-05',details:{items:[{name:'가상 항목',result:'보완사항',issueDetail:'가상 문제',action:'가상 조치'}]}};
    assert.equal((await call('/api/documents','POST',input)).status,401);const created=await call('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json(),path=`/api/documents/${doc.id}`;
    assert.equal((await call(path,'PUT',{...input,expectedEditVersion:doc.edit_version,details:{items:[{name:'가상 항목',result:'양호'}]}},admin)).status,400);
    const current=await (await call(path,'GET',null,admin)).json();assert.equal(JSON.parse((current.document||current).details).items[0].issueDetail,'가상 문제');
    const updated=await call(path,'PUT',{...input,expectedEditVersion:doc.edit_version,details:{items:[{...input.details.items[0],action:'새 조치'}]}},admin);assert.equal(updated.status,200);assert.equal(JSON.parse((await updated.json()).details).items[0].action,'새 조치');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
