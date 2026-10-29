import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingGroups, trainingRoster } from '../public/training-groups.js';

test('교육 대상 묶음은 출역한 근로자의 당시 직종과 소속만 포함한다',()=>{
  const workers=[{id:1,present:1,attendance_occupation:'목공',attendance_company:'가상 A'},{id:2,present:1,attendance_occupation:'목공',attendance_company:'가상 B'},{id:3,present:0,attendance_occupation:'목공',attendance_company:'가상 A'},{id:4,present:1,attendance_occupation:null,attendance_company:null}];
  const byOccupation=trainingGroups(workers,'occupation');assert.deepEqual(byOccupation.find(g=>g.label==='목공').ids,[1,2]);assert.deepEqual(byOccupation.find(g=>g.label===null).ids,[4]);
  const byCompany=trainingGroups(workers,'company');assert.deepEqual(byCompany.find(g=>g.label==='가상 A').ids,[1]);assert.deepEqual(byCompany.find(g=>g.label==='가상 B').ids,[2]);
  assert.throws(()=>trainingGroups(workers,'other'),/선택 기준/);
});

test('가상 명단은 저장된 대상과 같은 날의 시험 확인만 표시한다',()=>{
  const workers=[{id:1,name:'가상 하나',selected:1,present:1,attendance_company:'이전 소속',attendance_occupation:'목공',daily_confirmed:1,daily_has_signature:1},{id:2,name:'가상 둘',selected:0,present:0,company:'가상 회사',daily_confirmed:0,daily_has_signature:0}];
  const selected=trainingRoster({configured:true,workers});assert.deepEqual(selected.map(w=>w.id),[1]);assert.equal(selected[0].occupation,'목공');assert.equal(selected[0].company,'이전 소속');assert.equal(selected[0].confirmed,true);assert.equal(selected[0].hasSignature,true);
  const all=trainingRoster({configured:false,workers});assert.deepEqual(all.map(w=>w.id),[1,2]);assert.equal(all[1].occupation,null);assert.equal(all[1].hasSignature,false);
  assert.deepEqual(trainingRoster({configured:true,workers:workers.map(w=>({...w,selected:0}))}),[]);
});
