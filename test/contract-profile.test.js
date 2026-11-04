import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {ContractProfile} from '../contract-profile.js';
import {mountContractProfile,closeContractPreview} from '../public/contract-profile-view.js';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';

const input={employer:'가상 업체',address:'가상 주소',phone:'000-0000',representative:'가상 대표',workplace:'가상 현장',version:''};
test('계약 설정 조회 지연과 실패가 일괄 출력 목록을 막지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    const contract=document.createElement('section')"),end=source.indexOf('\n',source.indexOf('    mountSiteBatchResults(',start));assert.ok(start>=0&&end>start);
  let reject,mounted=0,live=true;const section={isConnected:true},state={siteId:1},context={document:{createElement:()=>section},content:{append(){}},state,current:()=>live,api(){},adminSession:Promise.resolve({}),mountContractProfile:()=>new Promise((_,fail)=>{reject=fail;}),mountSiteBatchResults:()=>{mounted++;},$:()=>({}),sites:[],esc:String,showError(){},showBatchPreview(){}};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);assert.equal(mounted,1);reject(Error('조회 오류'));await new Promise(resolve=>setImmediate(resolve));assert.match(section.textContent,/조회 오류/);
});
test('미리보기는 저장하지 않은 입력과 변경된 출력 정보를 차단한다',async()=>{
  let current={site:{id:1,name:'<가상>'},profile:{...input,version:'v1'}},prints=0,dialog,wait=false,release;
  const form={elements:Object.fromEntries(Object.entries(input).filter(([key])=>key!=='version').map(([key,value])=>[key,{value}]))},status={},preview={},buttons={};
  const document={defaultView:{print(){prints++;}},body:{append(value){dialog=value;}},createElement(){return {open:false,set innerHTML(value){this.html=value;},querySelector(selector){return buttons[selector]??={};},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){}};}};
  const target={ownerDocument:document,set innerHTML(value){this.html=value;},querySelector(selector){return {'[data-profile]':form,'[data-status]':status,'[data-preview]':preview}[selector];}};
  const api=async()=>structuredClone(current);await mountContractProfile({target,siteId:1,api,active:()=>true,sessionCheck:async()=>{if(wait)await new Promise(resolve=>{release=resolve;});}});
  form.elements.employer.value='미저장';await preview.onclick();assert.match(status.textContent,/저장/);assert.equal(dialog,undefined);
  form.elements.employer.value=input.employer;await preview.onclick();assert.match(dialog.html,/&lt;가상&gt;/);for(const label of ['가상 근로자 주소','연락처','근로 시작일','종료일','업무 및 직종','휴게','근무일','주휴일','가상 일급 또는 월급','수당','임금 지급일','지급방법','연차휴가','사회보험','작성일','사업주 시험 서명','근로자 시험 서명'])assert.ok(dialog.html.includes(label),label);await buttons['[data-print]'].onclick();assert.equal(prints,1);
  current.profile.version='v2';await buttons['[data-print]'].onclick();assert.equal(prints,1);assert.match(buttons['[data-print-status]'].textContent,/변경/);
  current.profile.version='v1';wait=true;const pending=buttons['[data-print]'].onclick();await new Promise(resolve=>setImmediate(resolve));document.querySelector=()=>dialog.open?dialog:null;closeContractPreview(document);wait=false;release();await pending;assert.equal(dialog.open,false);assert.equal(prints,1);
});
test('현장별 출력 정보는 변경 충돌과 권한 실패 시 보존된다',()=>{
  const store=new Store(':memory:');try{const a=store.createSite({name:'첫 현장'}),b=store.createSite({name:'다른 현장'}),profiles=new ContractProfile(store.db);
    assert.equal(profiles.get(a.id).profile.version,'');const saved=profiles.save(a.id,input);assert.equal(saved.profile.employer,input.employer);assert.equal(profiles.get(b.id).profile.employer,'');
    assert.throws(()=>profiles.save(a.id,input),/변경/);assert.throws(()=>profiles.save(a.id,{...input,version:saved.profile.version},()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.equal(profiles.get(a.id).profile.version,saved.profile.version);assert.throws(()=>profiles.save(a.id,{...input,version:saved.profile.version,phone:'bad\nvalue'}),/확인/);assert.throws(()=>profiles.get(999),/현장/);
  }finally{store.close();}
});
test('가상 서버의 출력 정보는 전역 관리자만 저장하고 재조회한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-contract-')),listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const start=()=>spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let child=start();
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base=`http://127.0.0.1:${port}`,request=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await request('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await request('/api/sites','POST',{name:'시험 현장'},admin)).json(),path=`/api/sites/${site.id}/contract-profile`;
    assert.equal((await request(path)).status,401);const saved=await request(path,'PUT',input,admin);assert.equal(saved.status,200);assert.equal((await saved.json()).profile.employer,input.employer);assert.equal((await request(path,'PUT',input,admin)).status,409);
    const created=await request('/api/admin-accounts','POST',{loginId:'profile_limited',name:'가상 제한',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]},admin);assert.equal(created.status,201);const limited=(await request('/api/login','POST',{loginId:'profile_limited',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];assert.equal((await request(path,'GET',null,limited)).status,403);assert.equal((await request(path,'PUT',input,limited)).status,403);
    const exited=once(child,'exit');child.kill();await exited;child=start();await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 재시작 실패');})]);const restored=await request(path,'GET',null,admin);assert.equal(restored.status,200);assert.equal((await restored.json()).profile.employer,input.employer);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
