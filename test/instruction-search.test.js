import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { instructionRecipientAudit } from '../public/instruction-recipients.js';

test('작업 지시서 검색은 현장, 협력사, 기간과 검색어를 함께 적용한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),a=store.createCompany({siteId:site.id,name:'가상 A',trade:'가상'}),b=store.createCompany({siteId:site.id,name:'가상 B',trade:'가상'}),foreign=store.createCompany({siteId:other.id,name:'가상 A',trade:'가상'});
    const add=(siteId,title,date,companyId)=>store.createDocument({siteId,type:'instruction',title,date,details:{companyId}});
    const one=add(site.id,'가상 첫 지시','2026-10-30',a.id),old=add(site.id,'가상 지난 지시','2026-10-29',a.id);
    add(site.id,'다른 협력사','2026-10-30',b.id);add(site.id,'미선택','2026-10-30',0);add(other.id,'다른 현장','2026-10-30',foreign.id);
    const find=(id,from='',to='',query='')=>store.documents(site.id,'instruction',query,from,to,'','',id).map(row=>row.id);
    assert.deepEqual(find(String(a.id)),[one.id,old.id]);
    assert.deepEqual(find(String(a.id),'2026-10-30','2026-10-30'),[one.id]);
    assert.equal(store.documents(site.id,'instruction').find(row=>row.id===one.id).has_instruction_result,0);
    store.transition(one.id,'submit');store.transition(one.id,'approve');store.addInstructionResult(one.id,{date:'2026-10-30',actor:'가상 담당자',content:'가상 조치'});
    assert.equal(store.documents(site.id,'instruction').find(row=>row.id===one.id).has_instruction_result,1);
    assert.equal(store.documents(site.id,'instruction').find(row=>row.id===old.id).has_instruction_result,0);
    assert.deepEqual(find(String(a.id),'','','지난'),[old.id]);
    assert.throws(()=>find(String(foreign.id)),/협력사/);
    assert.throws(()=>find('01'),/협력사/);
    assert.throws(()=>store.documents(site.id,'risk','','','','','',String(a.id)),/조건/);
  }finally{store.close();}
});

test('작업 지시서 협력사 검색 API는 관리자 인증과 현장 경계를 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-instruction-search-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),company=await (await call('/api/companies','POST',{siteId:site.id,name:'가상 협력사',trade:'가상'},admin)).json();
    const doc=await (await call('/api/documents','POST',{siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-10-30',details:{companyId:company.id}},admin)).json(),query=`/api/documents?siteId=${site.id}&type=instruction&instructionCompanyId=${company.id}`;
    assert.equal((await call(query)).status,401);
    const response=await call(query,'GET',null,admin);assert.equal(response.status,200);assert.deepEqual((await response.json()).map(row=>row.id),[doc.id]);
    assert.equal((await call(query.replace('type=instruction','type=risk'),'GET',null,admin)).status,400);
    assert.equal((await call(query.replace(`instructionCompanyId=${company.id}`,'instructionCompanyId=999999'),'GET',null,admin)).status,400);
    const baseWorker={siteId:site.id,category:'직영',company:company.name,occupation:'가상 직종'},legacy=await(await call('/api/workers','POST',{...baseWorker,name:'가상 이전 근로자'},admin)).json();
    const old=await(await call('/api/documents','POST',{siteId:site.id,type:'instruction',title:'가상 이전 지시',date:'2026-10-30',details:{companyId:company.id,recipientId:legacy.id}},admin)).json();
    const duplicate=await (await call('/api/companies','POST',{siteId:site.id,name:company.name,trade:'다른 공종'},admin)).json(),first=await(await call('/api/workers','POST',{...baseWorker,name:'가상 첫 근로자',companyId:company.id},admin)).json(),second=await(await call('/api/workers','POST',{...baseWorker,name:'가상 둘째 근로자',companyId:duplicate.id},admin)).json();
    const instruction=recipientId=>({siteId:site.id,type:'instruction',title:'가상 수신',date:'2026-10-30',details:{companyId:company.id,recipientId}});
    assert.equal((await call('/api/documents','POST',instruction(first.id),admin)).status,201);assert.equal((await call('/api/documents','POST',instruction(second.id),admin)).status,400);assert.equal((await call('/api/documents','POST',instruction(legacy.id),admin)).status,400);assert.equal((await call('/instruction-recipients.js')).status,200);
    const paths=[`/api/documents?siteId=${site.id}&type=instruction`,`/api/workers?siteId=${site.id}`,`/api/companies?siteId=${site.id}`];
    for(const path of paths)assert.equal((await call(path)).status,401);
    const data=await Promise.all(paths.map(async path=>(await call(path,'GET',null,admin)).json()));
    assert.ok(instructionRecipientAudit(...data).some(row=>row.id===old.id&&row.reason==='담당자의 등록 업체 미연결'));
    assert.equal((await call('/instruction-recipient-audit.js')).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
