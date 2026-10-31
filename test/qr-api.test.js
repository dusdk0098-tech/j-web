import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('QR 생성 중 로그아웃하면 주소 교체와 초대 활성화를 취소한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const source=pathToFileURL(join(process.cwd(),'node_modules/qrcode/lib/index.js')).href;
  const trace=`import qr from ${JSON.stringify(source)};const original=qr.toDataURL;let release;qr.toDataURL=(...args)=>{process.stdout.write('QR_STARTED\\n');return new Promise(resolve=>{release=()=>resolve(original(...args));});};process.stdin.on('data',()=>{if(release){const run=release;release=null;run();}});`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['pipe','pipe','pipe']});let db;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)}),login=async()=>(await send('/api/login',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0];
    const admin=await login(),site=await (await send('/api/sites',{name:'가상 현장'},admin)).json();
    let started=once(child.stdout,'data'),pending=send(`/api/sites/${site.id}/access`,{},admin);assert.match(String((await started)[0]),/QR_STARTED/);child.stdin.write('go\n');const initial=await pending;assert.equal(initial.status,200);const old=new URL((await initial.json()).link).searchParams.get('site');
    db=new DatabaseSync(join(dir,'jweb.sqlite'));started=once(child.stdout,'data');pending=send(`/api/sites/${site.id}/access/rotate`,{},admin);assert.match(String((await started)[0]),/QR_STARTED/);assert.equal((await send('/api/logout',{},admin)).status,200);child.stdin.write('go\n');assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT access_key FROM site_access WHERE site_id=?').get(site.id).access_key,old);
    const next=await login();started=once(child.stdout,'data');pending=send(`/api/sites/${site.id}/invitation`,{},next);assert.match(String((await started)[0]),/QR_STARTED/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE pending=1 AND revoked=0').get().n,1);assert.equal((await send('/api/logout',{},next)).status,200);child.stdin.write('go\n');assert.equal((await pending).status,401);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE revoked=0 AND pending=0').get().n,0);
    for(const suffix of ['access','invitation']){
      const active=await login(),fresh=await (await send('/api/sites',{name:'새 가상 현장'},active)).json();
      started=once(child.stdout,'data');pending=send(`/api/sites/${fresh.id}/${suffix}`,{},active);assert.match(String((await started)[0]),/QR_STARTED/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_access WHERE site_id=?').get(fresh.id).n,0);
      assert.equal((await send('/api/logout',{},active)).status,200);child.stdin.write('go\n');assert.equal((await pending).status,401);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_access WHERE site_id=?').get(fresh.id).n,0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE site_id=? AND revoked=0').get(fresh.id).n,0);
    }
    const active=await login(),fresh=await (await send('/api/sites',{name:'가입 가상 현장'},active)).json();
    started=once(child.stdout,'data');pending=send(`/api/sites/${fresh.id}/invitation`,{},active);assert.match(String((await started)[0]),/QR_STARTED/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_access WHERE site_id=?').get(fresh.id).n,0);
    child.stdin.write('go\n');const issued=await pending;assert.equal(issued.status,201);const token=new URL((await issued.json()).link).searchParams.get('token');
    const joinResponse=await send('/api/join',{token,acknowledged:true,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'qr_virtual',password:'virtual-password-123',profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    assert.equal(joinResponse.status,201);assert.equal((await joinResponse.json()).siteKey,db.prepare('SELECT access_key FROM site_access WHERE site_id=?').get(fresh.id).access_key);
  }finally{if(db)db.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
