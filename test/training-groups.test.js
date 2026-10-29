import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingGroups } from '../public/training-groups.js';

test('교육 대상 묶음은 출역한 근로자의 당시 직종과 소속만 포함한다',()=>{
  const workers=[{id:1,present:1,attendance_occupation:'목공',attendance_company:'가상 A'},{id:2,present:1,attendance_occupation:'목공',attendance_company:'가상 B'},{id:3,present:0,attendance_occupation:'목공',attendance_company:'가상 A'},{id:4,present:1,attendance_occupation:null,attendance_company:null}];
  const byOccupation=trainingGroups(workers,'occupation');assert.deepEqual(byOccupation.find(g=>g.label==='목공').ids,[1,2]);assert.deepEqual(byOccupation.find(g=>g.label===null).ids,[4]);
  const byCompany=trainingGroups(workers,'company');assert.deepEqual(byCompany.find(g=>g.label==='가상 A').ids,[1]);assert.deepEqual(byCompany.find(g=>g.label==='가상 B').ids,[2]);
  assert.throws(()=>trainingGroups(workers,'other'),/선택 기준/);
});
