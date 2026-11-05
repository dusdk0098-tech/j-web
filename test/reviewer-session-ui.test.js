import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('직원 화면의 JSON·첨부 요청은 처음 확인한 세션을 유지한다',async()=>{
  const previousFetch=globalThis.fetch,previousLocation=globalThis.location,calls=[];let pendingResolve;
  globalThis.location=new URL('http://127.0.0.1:4173/review');
  globalThis.fetch=async(input,options={})=>{calls.push({input,options});if(String(input).includes('pending'))return new Promise(resolve=>{pendingResolve=resolve;});return new Response('{}',{status:200});};
  try{
    const {bindReviewerSession,clearReviewerSession}=await import('../public/reviewer-session.js?context-test');
    await fetch('/api/reviewer/session');assert.equal(calls.length,1);
    await assert.rejects(fetch('/api/reviewer/board-posts'),/세션/);assert.equal(calls.length,1);
    await fetch('/api/reviewer/login',{method:'POST'});assert.equal(calls.length,2);
    const first='a'.repeat(64),second='b'.repeat(64);assert.throws(()=>bindReviewerSession('잘못된 세션'),/세션/);bindReviewerSession(first);
    await fetch('/api/reviewer/session');assert.equal(calls.at(-1).options.headers.get('X-Reviewer-Context'),first);
    await fetch('/api/reviewer/board-posts/1/attachments',{method:'POST',headers:{'x-file-name':'virtual.txt'},body:new Uint8Array([1])});assert.equal(calls.at(-1).options.headers.get('X-Reviewer-Context'),first);assert.equal(calls.at(-1).options.headers.get('x-file-name'),'virtual.txt');
    const request=new Request('http://127.0.0.1:4173/api/reviewer/documents',{headers:{'x-existing':'yes'}});await fetch(request);assert.equal(calls.at(-1).options.headers.get('x-existing'),'yes');assert.equal(calls.at(-1).options.headers.get('X-Reviewer-Context'),first);
    await fetch('https://example.invalid/api/reviewer/session');assert.equal(calls.at(-1).options.headers,undefined);
    assert.throws(()=>bindReviewerSession(second),/변경/);await fetch('/api/reviewer/documents');assert.equal(calls.at(-1).options.headers.get('X-Reviewer-Context'),first);
    const pending=fetch('/api/reviewer/pending');await Promise.resolve();const pendingHeaders=calls.at(-1).options.headers;clearReviewerSession();bindReviewerSession(second);pendingResolve(new Response('{}'));await pending;assert.equal(pendingHeaders.get('X-Reviewer-Context'),first);await fetch('/api/reviewer/logout',{method:'POST'});assert.equal(calls.at(-1).options.headers.get('X-Reviewer-Context'),second);
  }finally{globalThis.fetch=previousFetch;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;}
});

test('직원 화면은 현재 세션을 고정한 다음에 문서를 읽고 늦은 세션 응답은 무시한다',async()=>{
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=source.indexOf('async function refresh(){'),end=source.indexOf("if(generation!==refreshEpoch)return;login.hidden=true",start);assert.ok(start>=0&&end>start);const code=source.slice(start,end)+'return {docs,refs};}';
  const calls=[],context={refreshEpoch:0,reviewDetailEpoch:0,api:async path=>{calls.push(path);return path.endsWith('/session')?{context:'가상 세션'}:[];},bindReviewerSession:value=>calls.push(value)};
  await runInNewContext(code+';refresh();',context);assert.deepEqual(calls,['/api/reviewer/session','가상 세션','/api/reviewer/documents','/api/reviewer/references']);
  let resolve;const delayed={refreshEpoch:0,reviewDetailEpoch:0,api:()=>new Promise(done=>{resolve=done;}),bindReviewerSession:()=>{throw Error('지난 화면을 고정하면 안 됨');}},pending=runInNewContext(code+';refresh();',delayed);delayed.refreshEpoch++;resolve({context:'지난 세션'});await pending;
});

test('직접 로그인하면 응답의 세션을 즉시 고정하고 실패한 로그인은 기존 화면을 건드리지 않는다',async()=>{
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=source.indexOf('async function api('),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);const calls=[];let ok=true;
  const context={fetch:async()=>({ok,json:async()=>ok?{context:'가상 로그인'}:{error:'로그인 실패'}}),clearReviewerSession:()=>calls.push('clear'),bindReviewerSession:value=>calls.push(value)};
  await runInNewContext(source.slice(start,end)+";api('/api/reviewer/login',{method:'POST'});",context);assert.deepEqual(calls,['clear','가상 로그인']);
  ok=false;await assert.rejects(runInNewContext(source.slice(start,end)+";api('/api/reviewer/login',{method:'POST'});",context),/로그인 실패/);assert.deepEqual(calls,['clear','가상 로그인']);
});

test('이전 초기 로그인 확인 실패는 새로 연 직원 화면을 숨기지 않는다',async()=>{
  const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(value=>value.startsWith('const initialRefresh='));assert.ok(line);
  for(const changed of [false,true]){let reject;const context={refreshEpoch:0,login:{hidden:true},main:{hidden:false},refresh(){context.refreshEpoch++;return new Promise((_resolve,fail)=>{reject=fail;});}};runInNewContext(line,context);if(changed)context.refreshEpoch++;reject(Error('초기 요청 실패'));await new Promise(resolve=>setImmediate(resolve));assert.equal(context.login.hidden,changed);assert.equal(context.main.hidden,!changed);}
});
