import test from 'node:test';
import assert from 'node:assert/strict';
import { siteQrSession } from '../public/site-qr.js';

test('현장 QR 조회는 초대를 발급하지 않고 해당 현장의 명시적 요청만 수행한다',async()=>{
  const calls=[],api=async(path,options)=>{calls.push({path,method:options.method});return {path};},session=siteQrSession(7,'가상 현장',api);
  assert.deepEqual(calls,[]);await session.access();assert.deepEqual(calls,[{path:'/api/sites/7/access',method:'POST'}]);
  await session.openRegistration();await session.invite();await session.rotate();await session.revoke();
  assert.deepEqual(calls.slice(1),[{path:'/api/sites/7/access/registration',method:'POST'},{path:'/api/sites/7/invitation',method:'POST'},{path:'/api/sites/7/access/rotate',method:'POST'},{path:'/api/sites/7/invitation',method:'DELETE'}]);
});

test('응답을 기다리는 동안 다른 현장을 선택해도 원래 현장의 QR 동작을 유지한다',async()=>{
  const calls=[];let release;const api=(path,options)=>{calls.push({path,method:options.method});return new Promise(resolve=>{release=resolve;});};let selectedSite=2;const session=siteQrSession(selectedSite,'첫 현장',api),pending=session.access();selectedSite=9;release({});await pending;
  assert.equal(session.siteId,2);assert.equal(session.siteName,'첫 현장');const next=session.rotate();release({});await next;assert.deepEqual(calls.map(call=>call.path),['/api/sites/2/access','/api/sites/2/access/rotate']);assert.notEqual(session.siteId,selectedSite);
  assert.throws(()=>siteQrSession(0,'',api),/현장/);assert.throws(()=>siteQrSession(1,'현장',null),/현장/);
});

test('같은 QR 창의 요청이 끝나기 전에는 다른 변경을 시작하지 않는다',async()=>{
  let release;const calls=[],session=siteQrSession(1,'가상 현장',(path)=>{calls.push(path);return new Promise(resolve=>{release=resolve;});});
  const pending=session.access();await assert.rejects(session.rotate(),/처리 중/);await assert.rejects(session.revoke(),/처리 중/);assert.deepEqual(calls,['/api/sites/1/access']);
  release({});await pending;const next=session.rotate();release({});await next;assert.deepEqual(calls,['/api/sites/1/access','/api/sites/1/access/rotate']);
});

test('실패한 QR 요청 이후에는 다시 시도할 수 있다',async()=>{
  let attempts=0;const session=siteQrSession(1,'가상 현장',async()=>{if(++attempts===1)throw Error('가상 오류');return {ok:true};});
  await assert.rejects(session.access(),/가상 오류/);assert.deepEqual(await session.access(),{ok:true});
});
