import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {siteQrSession,siteQrPrintAction} from '../public/site-qr.js';

test('인쇄 전 확인은 별도 클릭·한 번만 인쇄하며 교체·실패·지연·전환을 차단한다',async()=>{
  for(const mode of ['access','invite']){
    let resolve,reject,time=1000,current=true,printed=0,calls=0;const session=siteQrSession(1,'가상 현장',()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});});
    const image={complete:true,naturalWidth:512,src:'virtual'},dialog={querySelector:()=>image},button={},status={},error={};
    const action=siteQrPrintAction({dialog,mode,session,qr:()=>({accessFingerprint:'first',link:'https://example.test/join?token=virtual'}),current:()=>current,button,status,error,print:()=>printed++,now:()=>time});
    const good=()=>mode==='access'?{accessFingerprint:'first'}:{valid:true,expiresAt:time+60000};
    let pending=action();await action();assert.equal(calls,1);assert.equal(printed,0);resolve(good());await pending;assert.equal(printed,0);
    const printing=action();assert.equal(printed,1,'인쇄는 두 번째 클릭의 동기 구간');await printing;
    pending=action();resolve(mode==='access'?{accessFingerprint:'other'}:{valid:false});await pending;assert.equal(printed,1);assert.match(error.textContent,/교체/);
    pending=action();reject(Error('가상 장애'));await pending;assert.equal(printed,1);assert.match(error.textContent,/장애/);
    pending=action();time+=15000;resolve(good());await pending;assert.match(error.textContent,/늦었/);
    pending=action();resolve(good());await pending;time+=15000;pending=action();assert.equal(printed,1);resolve(good());await pending;
    const mutation=session.revoke();resolve({});await mutation;pending=action();assert.equal(printed,1);resolve(good());await pending;
    current=false;await action();assert.equal(printed,1);current=true;
    time+=15000;pending=action();current=false;status.textContent='다른 현장';resolve(good());await pending;assert.equal(status.textContent,'다른 현장');assert.equal(printed,1);
  }
});

test('QR 상태 API는 관리자에게 교체·가입 중지를 확인하되 접속 주소를 반환하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-status-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},cookie)).json(),path=`/api/sites/${site.id}/access`,access=await (await call(path,'POST',{},cookie)).json(),key=new URL(access.link).searchParams.get('site');
    assert.equal((await call(`${path}/status`)).status,401);const initial=await (await call(`${path}/status`,'GET',null,cookie)).json();assert.equal(initial.accessFingerprint,access.accessFingerprint);assert.equal(initial.registrationExpiresAt,null);assert.equal(JSON.stringify(initial).includes(key),false);
    await call(`${path}/registration`,'POST',{},cookie);assert.ok((await (await call(`${path}/status`,'GET',null,cookie)).json()).registrationExpiresAt);await call(`/api/sites/${site.id}/invitation`,'DELETE',null,cookie);assert.equal((await (await call(`${path}/status`,'GET',null,cookie)).json()).registrationExpiresAt,null);
    const rotated=await (await call(`${path}/rotate`,'POST',{},cookie)).json(),current=await (await call(`${path}/status`,'GET',null,cookie)).json();assert.notEqual(current.accessFingerprint,initial.accessFingerprint);assert.equal(current.accessFingerprint,rotated.accessFingerprint);assert.equal((await call(`/api/worker/site?key=${key}`)).status,404);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('일반 관리자 실제 제출 핸들러도 첫 클릭 확인·다음 클릭 인쇄와 현장 변경 차단을 연결한다',async()=>{
  const lines=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split(/\r?\n/),setup=lines.find(line=>line.includes('const signupStatus=')),submit=lines.find(line=>line.includes("dialog.dataset.qrPrint='access'"));
  let printed=0,resolve;const nodes={},node=id=>nodes[id]??={isConnected:true,complete:true,naturalWidth:512,src:'virtual'};
  const admin={},state={siteId:1,admin},session=siteQrSession(1,'가상 현장',()=>new Promise(done=>{resolve=done;})),dialog={open:true,dataset:{},querySelector:node,showModal(){}};
  runInNewContext(setup+'\n'+submit,{$:node,dialog,state,admin,epoch:1,detailEpoch:1,session,access:{accessFingerprint:'first'},siteQrPrintAction:options=>siteQrPrintAction({...options,print:()=>printed++})});
  const pending=node('#dialog-form').onsubmit({preventDefault(){}});assert.equal(printed,0);resolve({accessFingerprint:'first'});await pending;node('#dialog-form').onsubmit({preventDefault(){}});assert.equal(printed,1);
  state.siteId=2;await node('#dialog-form').onsubmit({preventDefault(){}});assert.equal(printed,1);
});
