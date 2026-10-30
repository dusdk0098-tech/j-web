import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { rememberWorker } from '../public/remember-worker.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function memoryStorage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('시험 아이디는 현장별로 확인하고 암호나 현장 주소는 저장하지 않는다',async()=>{
  const storage=memoryStorage(),remember=rememberWorker(storage,webcrypto),a='A'.repeat(43),b='B'.repeat(43);assert.equal(await remember.load(a),null);await remember.save(a,'virtual_worker');const raw=[...storage.values.values()][0],record=JSON.parse(raw);assert.deepEqual(Object.keys(record).sort(),['loginId','site']);assert.equal(record.loginId,'virtual_worker');assert.equal(raw.includes(a),false);assert.equal(raw.includes('password'),false);assert.equal(await remember.load(a),'virtual_worker');assert.equal(await remember.load(b),null);
  await remember.clear(b);assert.equal(await remember.load(a),'virtual_worker');await assert.rejects(remember.save(a,'!'),/아이디/);await assert.rejects(remember.save('bad','virtual_worker'),/현장/);await remember.clear(a);assert.equal(await remember.load(a),null);
  await remember.save(b,'second_worker');remember.clearAll();assert.equal(storage.values.size,0);storage.setItem('jweb.worker.remembered','{bad');assert.equal(await remember.load(a),null);
  const failing=rememberWorker({getItem(){throw Error('차단됨');},setItem(){throw Error('차단됨');},removeItem(){throw Error('차단됨');}},webcrypto);await assert.rejects(failing.load(a),/차단됨/);await assert.rejects(failing.save(a,'virtual_worker'),/차단됨/);assert.throws(()=>failing.clearAll(),/차단됨/);
});

test('저장이나 삭제가 지연되는 중 선택이 취소되면 이전 작업은 반영되지 않는다',async()=>{
  const storage=memoryStorage(),site='A'.repeat(43),normal=rememberWorker(storage,webcrypto);let release,allowed=true;const delayed={subtle:{digest:(...args)=>new Promise(resolve=>{release=()=>resolve(webcrypto.subtle.digest(...args));})}},slow=rememberWorker(storage,delayed);
  const saving=slow.save(site,'virtual_worker',()=>allowed);allowed=false;release();await saving;assert.equal(storage.values.size,0);
  await normal.save(site,'virtual_worker');allowed=true;const clearing=slow.clear(site,()=>allowed);allowed=false;release();await clearing;assert.equal(await normal.load(site),'virtual_worker');
});

test('현장 선택 페이지는 직원 시험 로그인과 저장 모듈을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-login-ui-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,page=await fetch(base+'/join'),html=await page.text();assert.match(html,/<a href="\/review">직원 시험 계정 로그인<\/a>/);const module=await fetch(base+'/remember-worker.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);assert.equal((await fetch(base+'/review')).status,200);}finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
