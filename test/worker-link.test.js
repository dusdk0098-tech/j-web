import test from 'node:test';
import assert from 'node:assert/strict';
import { workerSitePath,replaceWorkerSiteAddress,workerJoinCredentials,switchWorkerJoinToSite } from '../public/worker-link.js';

test('현장 로그인 주소는 유효한 현장 키만 사용한다',()=>{
  const key='a'.repeat(43);
  assert.equal(workerSitePath(key),`/join?site=${key}`);
  for(const value of [null,'','short','a'.repeat(42),'a'.repeat(44),'a'.repeat(42)+'&','a'.repeat(42)+'한',123])assert.equal(workerSitePath(value),null);
});

test('현장 주소 전환은 초대 주소를 교체하고 실패를 알려준다',()=>{
  const key='b'.repeat(43),state={step:1};let location=new URL('https://example.test/join?token=invite'),calls=0;
  const history={state,replaceState(value,title,path){assert.equal(value,state);assert.equal(title,'');calls++;location=new URL(path,location);}};
  assert.equal(replaceWorkerSiteAddress(key,history),true);assert.equal(location.searchParams.get('site'),key);assert.equal(location.searchParams.has('token'),false);assert.equal(calls,1);
  assert.equal(replaceWorkerSiteAddress('invalid',history),false);assert.equal(calls,1);assert.equal(replaceWorkerSiteAddress(key,{replaceState(){throw new Error('blocked');}}),false);
});

test('가입 요청은 처음 열린 QR의 종류를 유지한다',()=>{
  const token='a'.repeat(43),oldKey='b'.repeat(43),newKey='c'.repeat(43),invite=new URLSearchParams({token}),site=new URLSearchParams({site:oldKey,token});
  assert.deepEqual(workerJoinCredentials(invite,null),{token});
  assert.deepEqual(workerJoinCredentials(invite,newKey),{token});
  assert.deepEqual(workerJoinCredentials(site,newKey),{siteKey:newKey});
  assert.deepEqual(workerJoinCredentials(new URLSearchParams(),null),{token:null});
});

test('로그아웃 후 확인한 같은 현장의 가입 설정과 요청 자격을 함께 전환한다',()=>{
  const token='a'.repeat(43),key='b'.repeat(43),params=new URLSearchParams({token});
  for(const [siteKey,siteId,info] of [['bad',1,{id:1,canSignup:true}],[key,1,{id:2,canSignup:true}],[key,1,{id:1}],[key,null,{id:1,canSignup:true}]]){
    assert.throws(()=>switchWorkerJoinToSite(params,siteKey,siteId,info),/현장/);
    assert.deepEqual(workerJoinCredentials(params,key),{token});
  }
  switchWorkerJoinToSite(params,key,1,{id:1,canSignup:true});
  assert.deepEqual(workerJoinCredentials(params,key),{siteKey:key});
  assert.equal(params.has('token'),false);
});
