import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkerLoads } from '../public/worker-loads.js';

test('느린 근로자 조회나 다른 조회의 실패가 공지와 점검의 시작을 막지 않는다',async()=>{
  let finishSlow,finishError;const slow=new Promise(resolve=>{finishSlow=resolve;}),reported=new Promise(resolve=>{finishError=resolve;}),events=[];
  startWorkerLoads([async()=>{events.push('slow');await slow;events.push('slow done');},()=>{events.push('notice');},async()=>{events.push('failure');throw Error('가상 조회 실패');},()=>{events.push('self check');}],error=>{events.push(error.message);finishError();});
  await reported;assert.deepEqual(events,['slow','notice','failure','self check','가상 조회 실패']);finishSlow();await new Promise(resolve=>setImmediate(resolve));assert.equal(events.at(-1),'slow done');
});
