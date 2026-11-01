import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('빈 시험 서식은 외부 파일 없이 다섯 개의 인쇄 구역을 제공한다',()=>{
  const html=readFileSync(new URL('../public/offline-forms.html',import.meta.url),'utf8');assert.equal((html.match(/<section>/g)||[]).length,5);assert.equal((html.match(/J웹 시험용 빈 서식/g)||[]).length,5);assert.match(html,/@media print/);assert.doesNotMatch(html,/<script\b|<link\b|<img\b|<iframe\b|\bsrc\s*=|url\s*\(/i);assert.match(html,/공식 서식이나 실제 안전 업무 기록으로 사용할 수 없습니다/);
});

test('시험 서버는 별도 저장 가능한 서식과 제한된 페이지별 정책을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-offline-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,response=await fetch(`${base}/offline-forms.html`),body=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(response.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'/);assert.match(body,/오프라인 빈 시험 서식/);const regular=await fetch(`${base}/worker-guide.html`);assert.doesNotMatch(regular.headers.get('content-security-policy'),/unsafe-inline/);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
