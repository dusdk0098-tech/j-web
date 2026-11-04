import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf("  if(state.page==='site-articles'){");
const end=source.indexOf('    content.innerHTML=',start);
assert.ok(start>=0&&end>start);
for(const change of ['site','category','query','admin','page','epoch'])for(const fails of [false,true])test(`자료실 조회 중 ${change} 변경 뒤 이전 ${fails?'오류':'응답'} 무시`,async()=>{
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const state={page:'site-articles',siteId:1,articleCategory:'기타',query:'시험',admin:{id:1}},context={state,detailEpoch:1,renderEpoch:1,api:()=>pending,URLSearchParams};
  const execute=vm.runInNewContext(`(async function(){${source.slice(start,end)}return articles;}})`,context);
  const result=execute();
  if(change==='site')state.siteId=2;if(change==='category')state.articleCategory='안전·보건';if(change==='query')state.query='다른 검색';if(change==='admin')state.admin={id:2};if(change==='page')state.page='documents';
  if(change==='epoch')context.detailEpoch++;
  if(fails)reject(Error('이전 오류'));else resolve([{id:1}]);
  assert.equal(await result,undefined);
});

test('현재 자료실 조회의 결과와 오류는 전달한다',async()=>{
  const state={page:'site-articles',siteId:1,articleCategory:'',query:'',admin:{}},context={state,detailEpoch:1,renderEpoch:1,api:async()=>['현재 결과'],URLSearchParams};
  const execute=vm.runInNewContext(`(async function(){${source.slice(start,end)}return articles;}})`,context);
  assert.deepEqual(await execute(),['현재 결과']);context.api=async()=>{throw Error('현재 오류');};await assert.rejects(execute(),/현재 오류/);
});
