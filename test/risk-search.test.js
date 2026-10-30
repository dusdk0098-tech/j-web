import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('위험성평가 검색은 현장, 종류, 등록 협력사와 기간을 함께 지킨다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),a=s.createCompany({siteId:site.id,name:'가상 A',trade:'가상'}),b=s.createCompany({siteId:site.id,name:'가상 B',trade:'가상'}),foreign=s.createCompany({siteId:other.id,name:'가상 A',trade:'가상'});
    const add=(title,kind,details,date='2026-10-30')=>s.createDocument({siteId:site.id,type:'risk',title,date,details:{kind,...details}}),one=add('일반 위험','initial',{items:[{contractorId:a.id,task:'가상'}]}),two=add('근골격 위험','regular',{items:[],musculoskeletalItems:[{contractorId:a.id,selected:true,task:'가상'}]}),three=add('다른 업체','regular',{items:[{contractorId:b.id,task:'가상'}]}),direct=add('직접 입력','regular',{items:[{contractor:'가상 A',task:'가상'}]}),old=add('이전 형식','regular',{contractorId:a.id,task:'가상'},'2026-10-29');
    s.createDocument({siteId:other.id,type:'risk',title:'외부 평가',date:'2026-10-30',details:{kind:'regular',items:[{contractorId:foreign.id}]}});s.createDocument({siteId:site.id,type:'notice',title:'가상 공지',date:'2026-10-30'});
    const find=(kind='',company='',from='',to='',q='')=>s.documents(site.id,'risk',q,from,to,kind,company).map(row=>row.id);
    assert.deepEqual(find('regular',String(a.id)),[two.id,old.id]);assert.deepEqual(find('',String(a.id),'2026-10-30','2026-10-30'),[two.id,one.id]);assert.deepEqual(find('regular',String(b.id)),[three.id]);assert.deepEqual(find('regular','','','','직접'),[direct.id]);
    assert.throws(()=>find('bad'),/종류/);assert.throws(()=>find('',String(foreign.id)),/협력사/);assert.throws(()=>find('','01'),/협력사/);assert.throws(()=>s.documents(site.id,'notice','','','','regular'),/조건/);
  }finally{s.close();}
});

test('위험성평가 검색 API는 관리자 인증과 현장별 조건을 적용한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-search-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),company=await (await call('/api/companies','POST',{siteId:site.id,name:'가상 협력사',trade:'가상'},admin)).json();
    const doc=await (await call('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-30',details:{kind:'initial',items:[{contractorId:company.id,task:'가상 작업'}]}},admin)).json(),query=`/api/documents?siteId=${site.id}&type=risk&riskKind=initial&riskContractorId=${company.id}`;
    assert.equal((await call(query)).status,401);const response=await call(query,'GET',null,admin);assert.equal(response.status,200);assert.deepEqual((await response.json()).map(row=>row.id),[doc.id]);assert.deepEqual(await (await call(query.replace('initial','regular'),'GET',null,admin)).json(),[]);
    assert.equal((await call(query.replace('initial','invalid'),'GET',null,admin)).status,400);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
