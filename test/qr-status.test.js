import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';

test('QR 상태 확인은 교체된 이미지 인쇄를 막고 닫힌 창의 응답을 무시한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),lines=source.split(/\r?\n/),setup=lines.find(line=>line.includes('const signupStatus=')),check=lines.find(line=>line.includes("$('#check-site-qr-status').onclick")),submit=lines.find(line=>line.includes("dialog.dataset.qrPrint='access'"));assert.ok(setup&&check&&submit);
  const make=()=>{const nodes={},node=id=>nodes[id]??={textContent:'',isConnected:true},dialog={open:true,dataset:{},showModal(){}},access={accessFingerprint:'첫 지문',registrationExpiresAt:null},state={accessFingerprint:'첫 지문',registrationExpiresAt:null};let release,rejectStatus,printed=0;const session={status:()=>new Promise((resolve,reject)=>{release=resolve;rejectStatus=reject;})},context={$:node,dialog,access,session,Date,printSiteQr:()=>{printed++;}};runInNewContext(`${setup}\n${check}\n${submit}`,context);return {nodes,dialog,state,release:()=>release,reject:()=>rejectStatus,printed:()=>printed};};
  const ui=make(),event={preventDefault(){}};let pending=ui.nodes['#check-site-qr-status'].onclick();ui.nodes['#dialog-form'].onsubmit(event);assert.equal(ui.printed(),0);assert.match(ui.nodes['#dialog-error'].textContent,/확인/);ui.release()({accessFingerprint:'다른 지문',registrationExpiresAt:null});await pending;ui.nodes['#dialog-form'].onsubmit(event);assert.equal(ui.printed(),0);assert.match(ui.nodes['#site-qr-status'].textContent,/교체/);
  pending=ui.nodes['#check-site-qr-status'].onclick();ui.release()({accessFingerprint:'첫 지문',registrationExpiresAt:null});await pending;ui.nodes['#dialog-form'].onsubmit(event);assert.equal(ui.printed(),1);
  pending=ui.nodes['#check-site-qr-status'].onclick();ui.reject()(Error('시험 조회 오류'));await pending;ui.nodes['#dialog-form'].onsubmit(event);assert.equal(ui.printed(),1);assert.match(ui.nodes['#site-qr-status'].textContent,/확인하지 못했습니다/);
  pending=ui.nodes['#check-site-qr-status'].onclick();ui.nodes['#login-qr-image'].isConnected=false;ui.nodes['#site-qr-status'].textContent='새 창';ui.release()({accessFingerprint:'다른 지문',registrationExpiresAt:null});await pending;assert.equal(ui.nodes['#site-qr-status'].textContent,'새 창');
});

test('QR 상태 API는 관리자에게 교체·가입 중지를 확인하되 접속 주소를 반환하지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-status-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},cookie)).json(),path=`/api/sites/${site.id}/access`,access=await (await call(path,'POST',{},cookie)).json(),key=new URL(access.link).searchParams.get('site');
    assert.equal((await call(`${path}/status`)).status,401);const initial=await (await call(`${path}/status`,'GET',null,cookie)).json();assert.equal(initial.accessFingerprint,access.accessFingerprint);assert.equal(initial.registrationExpiresAt,null);assert.equal(JSON.stringify(initial).includes(key),false);
    await call(`${path}/registration`,'POST',{},cookie);assert.ok((await (await call(`${path}/status`,'GET',null,cookie)).json()).registrationExpiresAt);await call(`/api/sites/${site.id}/invitation`,'DELETE',null,cookie);assert.equal((await (await call(`${path}/status`,'GET',null,cookie)).json()).registrationExpiresAt,null);
    const rotated=await (await call(`${path}/rotate`,'POST',{},cookie)).json(),current=await (await call(`${path}/status`,'GET',null,cookie)).json();assert.notEqual(current.accessFingerprint,initial.accessFingerprint);assert.equal(current.accessFingerprint,rotated.accessFingerprint);assert.equal((await call(`/api/worker/site?key=${key}`)).status,404);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
