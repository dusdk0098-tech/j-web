import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { summarizeWorkerCounts, paginateWorkers, workerSummaryMarkup } from '../public/worker-list.js';
import { selectBatchDocuments } from '../public/batch-print.js';

test('가상 출입자 요약은 날짜 경계와 누락을 구분하고 내용을 안전하게 표시한다',()=>{
  const births=['2010-03-02','2000-03-01','1996-03-02','1996-03-01','1986-03-01','1976-03-01','1966-03-01','','2026-02-30','2026-03-02'];
  const summary=summarizeWorkerCounts(births.map((birthDate,index)=>({birthDate,category:index===0?'<script>':'직영'})),'2026-03-01');
  assert.equal(summary.total,10);
  assert.deepEqual(summary.ages.map(item=>item.count),[1,2,1,1,1,1,3]);
  assert.equal(summary.categories.find(item=>item.label==='직영').count,9);
  assert.doesNotMatch(JSON.stringify(summary),/2010-03-02/);
  assert.match(workerSummaryMarkup(summary),/&lt;script&gt;/);
  assert.doesNotMatch(workerSummaryMarkup(summary),/<script>/);
  assert.throws(()=>summarizeWorkerCounts([], '2026-02-30'),/날짜/);
});

test('가상 출입자 목록은 20명씩 자르고 페이지 전체를 선택할 수 있다',()=>{
  assert.deepEqual(paginateWorkers([],99),{rows:[],page:0,pages:1});
  const rows=Array.from({length:51},(_,index)=>index+1);
  assert.deepEqual(paginateWorkers(rows,-1),{rows:rows.slice(0,20),page:0,pages:3});
  assert.deepEqual(paginateWorkers(rows,1),{rows:rows.slice(20,40),page:1,pages:3});
  assert.deepEqual(paginateWorkers(rows,999),{rows:rows.slice(40),page:2,pages:3});
  assert.equal(paginateWorkers(rows.slice(0,20),1).pages,1);
  assert.equal(paginateWorkers(rows.slice(0,21),1).rows.length,1);
  const page=paginateWorkers(rows.map(id=>({id})),0).rows;
  assert.deepEqual(selectBatchDocuments(page,page.map(item=>String(item.id))),rows.slice(0,20));
});

test('목록과 요약은 같은 현장·검색 조건을 사용하고 권한 실패를 되돌린다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const worker=(name,category='직영')=>store.createWorker({siteId:site.id,name,category,company:'가상 회사',occupation:'가상 직종'});
    const first=worker('가상 첫째'),second=worker('가상 둘째','외주'),third=worker('가상 셋째');
    store.createWorker({siteId:other.id,name:'다른 현장 인원',category:'직영',company:'가상 회사',occupation:'가상 직종'});
    const date=store.db.prepare('UPDATE workers SET created_date=? WHERE id=?');
    date.run('2020-01-01',first.id);date.run('2024-01-01',second.id);date.run(null,third.id);
    const ack=store.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,profile) VALUES(?,?,?)');
    ack.run(first.id,'demo-v1',JSON.stringify({birthDate:'2000-02-29',phone:'010-1111-2222'}));
    ack.run(second.id,'demo-v1',JSON.stringify({birthDate:'1990-03-01'}));
    const read=(query='',filters={},authorize=()=>{})=>store.workerListing(site.id,query,filters,authorize,'2025-03-01');
    const all=read('',{order:'recent'});
    assert.deepEqual(all.workers.map(item=>item.id),[second.id,first.id,third.id]);
    assert.deepEqual(read().workers.map(item=>item.id),[third.id,second.id,first.id]);
    assert.equal(all.summary.total,3);
    assert.deepEqual(all.summary.ages.map(item=>item.count),[0,1,1,0,0,0,1]);
    assert.doesNotMatch(JSON.stringify(all),/2000-02-29|010-1111-2222/);
    const filtered=read('',{category:'외주'});
    assert.deepEqual(filtered.workers.map(item=>item.id),[second.id]);
    assert.equal(filtered.summary.total,1);
    assert.equal(read('000229').workers[0].id,first.id);
    assert.equal(read('000229').summary.total,1);
    assert.equal(store.workerListing(other.id,'000229',{},()=>{},'2025-03-01').summary.total,0);
    assert.throws(()=>read('',{order:'invalid'}),/정렬/);
    let calls=0;
    assert.throws(()=>read('',{},()=>{if(++calls===2)throw Error('세션 만료');}),/세션 만료/);
    assert.equal(read().summary.total,3);
  }finally{store.close();}
});

