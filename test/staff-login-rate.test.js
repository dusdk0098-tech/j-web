import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginFailures } from '../login-failures.js';
import { Store } from '../store.js';
import { ClientAccounts } from '../client-accounts.js';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer } from 'node:net';

test('실패 기록 상한은 기존 제한을 보존하고 새 주소·계정을 거절하며 5분 후 회복한다',()=>{
  const rates=new LoginFailures(),now=1000;
  for(let i=0;i<10000;i++){rates.peers.set('p'+i,[now]);rates.accounts.set('a'+i,[now]);}
  rates.peers.set('p0',Array(100).fill(now));rates.accounts.set('a0',Array(10).fill(now));
  for(const [peer,account] of [['new','a1'],['p1','new'],['p0','a1'],['p1','a0']])assert.throws(()=>rates.check(peer,account,now),e=>e.sessionStatus===429);
  assert.doesNotThrow(()=>rates.check('p1','a1',now));
  assert.equal(rates.peers.size,10000);assert.equal(rates.accounts.size,10000);
  assert.equal(rates.peers.get('p0').length,100);assert.equal(rates.accounts.get('a0').length,10);
  rates.check('new','new',now+300000);assert.equal(rates.peers.size,0);assert.equal(rates.accounts.size,0);
  rates.record('new','new',now+300000);assert.equal(rates.accounts.get('new').length,1);
  for(const peer of [null,undefined,'','x'.repeat(65)])assert.throws(()=>rates.check(peer,'a',now),e=>e.sessionStatus===503);
});

test('관리자·발주처·결재자 HTTP 주소 격리, 계정 합산, 위조 헤더, 검증 중계, 만료',{timeout:120000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-staff-rate-')),clock=join(dir,'clock'),password='virtual-password-123',secret='virtual-proxy-secret-for-tests-123456';
  let child;
  try{
    writeFileSync(clock,'0');
    const store=new Store(join(dir,'jweb.sqlite'));
    try{
      const site=store.createSite({name:'가상 제한 시험'});
      store.createReviewer({siteId:site.id,loginId:'review_test',name:'가상 직원',password});
      new ClientAccounts(store.db).register({kind:'individual',loginId:'client_test',password,confirmPassword:password,name:'가상 발주처',email:'test@example.invalid',phone:'010-0000-0000',acknowledged:true});
    }finally{store.close();}
    const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
    const preload=`import {readFileSync} from 'node:fs';const original=Date.now;Date.now=()=>original()+Number(readFileSync(${JSON.stringify(clock)},'utf8'));`;
    child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password,JWEB_PUBLIC_ORIGIN:'',JWEB_PROXY_SECRET:secret},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);
    const send=(path,loginId,pass=password,peer='127.0.0.1',headers={})=>new Promise((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port,path,method:'POST',localAddress:peer,agent:false,headers:{'content-type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']}));});req.on('error',reject);req.end(JSON.stringify({loginId,password:pass}));
    });
    let offset=0;
    for(const [path,id] of [['/api/login','admin'],['/api/client/login','client_test'],['/api/reviewer/login','review_test']]){
      assert.equal((await send(path,id)).status,200);
      for(let i=0;i<100;i++)assert.equal((await send(path,'missing_'+i,'wrong','127.0.0.1',{'x-forwarded-for':'192.0.2.'+(i+1)})).status,401);
      assert.equal((await send(path,id)).status,429);
      assert.equal((await send(path,id,password,'127.0.0.2')).status,200);
      const results=await Promise.all(Array.from({length:20},()=>send(path,id,'wrong','127.0.0.2')));
      const guesses=results.filter(r=>r.status===401).length;assert.ok(guesses>0&&guesses<=10);assert.ok(results.some(r=>r.status===503));assert.ok(results.every(r=>[401,429,503].includes(r.status)));
      for(let i=guesses;i<10;i++)assert.equal((await send(path,id,'wrong','127.0.0.2')).status,401);
      assert.equal((await send(path,id,password,'127.0.0.3')).status,429);
      writeFileSync(clock,String(offset+=300001));assert.equal((await send(path,id)).status,200);
      for(const headers of [{'x-jweb-client-address':'192.0.2.1','x-jweb-proxy-secret':'forged'},{'x-jweb-client-address':'invalid','x-jweb-proxy-secret':secret}]){const result=await send(path,id,password,'127.0.0.1',headers);assert.equal(result.status,503);assert.equal(result.cookie,undefined);}
      const bridge=address=>({'x-jweb-client-address':address,'x-jweb-proxy-secret':secret});
      for(let i=0;i<100;i++)assert.equal((await send(path,'missing_'+i,'wrong','127.0.0.1',bridge('192.0.2.1'))).status,401);
      assert.equal((await send(path,id,password,'127.0.0.1',bridge('192.0.2.1'))).status,429);
      assert.equal((await send(path,id,password,'127.0.0.1',bridge('192.0.2.2'))).status,200);
      assert.equal((await send(path,id,password,'127.0.0.2',bridge('192.0.2.1'))).status,200,'비로컬 연결은 전용 헤더를 신뢰하지 않음');
      writeFileSync(clock,String(offset+=300001));
    }
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});
  }
});
