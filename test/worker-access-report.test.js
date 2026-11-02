import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';

test('출입자별 접속 보고서는 현장과 사람을 구분하고 모든 기록을 보존한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),invite=store.createInvitation(site.id);
    const first=store.join(invite.token,{name:'같은 이름',category:'직영',company:'가상 A',occupation:'목공',loginId:'report_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    const second=store.createWorker({siteId:site.id,name:'같은 이름',category:'협력업체 근로자',company:'가상 B',occupation:'철근'}),outsider=store.createWorker({siteId:other.id,name:'다른 현장',category:'직영',company:'',occupation:'목공'});
    const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),position=()=>({latitude:0,longitude:0,accuracyMeters:10,timestamp:Date.now()});
    store.setSiteLocationPolicy(site.id,{enabled:true,latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:50,expectedVersion:null});
    store.recordWorkerLogin(first.id,date,null,null,position());store.recordWorkerLogin(first.id,date,null,null,position());
    store.recordWorkerDeparture(site.id,second.id,'a'.repeat(64),position());store.recordWorkerLogin(outsider.id,date);
    let checks=0;const report=store.workerAccessReport(site.id,date,()=>{checks++;});
    assert.equal(checks,2);assert.deepEqual(report.workers.map(row=>row.worker_id),[first.id,second.id]);
    assert.equal(report.workers[0].birth_date,'2000-01-01');assert.equal(report.workers[0].company,'가상 A');assert.equal(report.workers[1].birth_date,null);
    assert.equal(report.arrivals.length,1);assert.equal(report.events.length,2);assert.equal(report.departures.length,1);assert.equal(report.departures[0].worker_id,second.id);
    assert.equal(report.workers.some(row=>Object.hasOwn(row,'phone')),false);assert.deepEqual(store.workerAccessReport(other.id,date).workers.map(row=>row.worker_id),[outsider.id]);
    store.db.prepare('UPDATE join_acknowledgements SET profile=? WHERE worker_id=?').run('{',first.id);assert.equal(store.workerAccessReport(site.id,date).workers[0].birth_date,null);
    let count=0;assert.throws(()=>store.workerAccessReport(site.id,date,()=>{if(++count===2)throw Error('세션 만료');}),/세션 만료/);assert.equal(store.workerAccessReport(site.id,date).workers.length,2);
    assert.throws(()=>store.workerAccessReport(site.id,'2026-02-30'),/날짜/);
  }finally{store.close();}
});
