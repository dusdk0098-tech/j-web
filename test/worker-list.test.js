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

test('연령대는 70대 이상도 분리하고 기존 집계는 유지한다',()=>{
  const births=['2026-03-01','2007-03-02','1956-03-01','1946-03-02','1946-03-01','1926-03-01','', '2026-03-02'];
  const result=summarizeWorkerCounts(births.map(birthDate=>({birthDate,category:'직영'})),'2026-03-01');
  assert.deepEqual(result.ageDecades.filter(item=>item.count).map(({label,count})=>[label,count]),[['10세 미만',1],['10대',1],['70대',2],['80대',1],['100세 이상',1],['미기록·확인 불가',2]]);
  assert.deepEqual(result.ages.map(item=>item.count),[2,0,0,0,0,4,2]);
  assert.ok(workerSummaryMarkup(result).includes('70대 2명 (25%)'));
  assert.ok(workerSummaryMarkup(result).includes('구분: 직영 8명 (100%)'));
  const {ageDecades,...legacy}=result;assert.ok(workerSummaryMarkup(legacy).includes('60세 이상 4명 (50%)'));assert.throws(()=>workerSummaryMarkup({...result,total:0}),/집계/);
  assert.equal((workerSummaryMarkup(result).match(/stroke-dasharray=/g)||[]).length,6);
  assert.doesNotMatch(workerSummaryMarkup(result),/20대 0명/);
  assert.match(workerSummaryMarkup(summarizeWorkerCounts([],'2026-03-01')),/가상 연령: 없음/);
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

test('최근 가입 정렬은 명부 등록일이 아닌 가입 시각을 사용한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),make=name=>store.createWorker({siteId:site.id,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),older=make('기존 명부'),newer=make('나중 명부'),noJoin=make('가입 기록 없음');
    const date=store.db.prepare('UPDATE workers SET created_date=? WHERE id=?');date.run('2020-01-01',older.id);date.run('2025-01-01',newer.id);date.run('2026-01-01',noJoin.id);
    const join=store.db.prepare('INSERT INTO join_acknowledgements(worker_id,notice_version,created_at) VALUES(?,?,?)');join.run(older.id,'demo','2026-11-05 10:00:00');join.run(newer.id,'demo','2026-11-04 10:00:00');
    assert.deepEqual(store.workers(site.id,'',{order:'recent'}).map(w=>w.id),[older.id,newer.id,noJoin.id]);
    assert.deepEqual(store.workers(site.id,'',{order:'recent',from:'2024-01-01'}).map(w=>w.id),[newer.id,noJoin.id]);
    assert.deepEqual(store.workers(site.id).map(w=>w.id),[noJoin.id,newer.id,older.id]);
    assert.throws(()=>store.workers(site.id,'',{order:'recent'},false),/전역 관리자/);
  }finally{store.close();}
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


test('출역 기간 검색은 등록일과 별개이며 같은 현장의 유효 출역만 찾는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),make=(siteId,name)=>store.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),a=make(site.id,'가상 첫째'),b=make(site.id,'가상 둘째'),c=make(site.id,'가상 셋째'),d=make(other.id,'가상 다른 현장');
    for(const [s,w,date,present] of [[site,a,'2026-10-01',true],[site,a,'2026-10-03',true],[site,b,'2026-10-02',false],[site,b,'2026-11-01',true],[other,d,'2026-10-03',true]])store.setAttendance({siteId:s.id,workerId:w.id,date,present});
    const read=filters=>store.workerListing(site.id,'',filters,()=>{},'2026-11-06');
    let result=read({attendanceFrom:'2026-10-01',attendanceTo:'2026-10-03'});assert.deepEqual(result.workers.map(w=>w.id),[a.id]);assert.equal(result.summary.total,1);
    assert.deepEqual(read({attendanceFrom:'2026-10-04'}).workers.map(w=>w.id),[b.id]);assert.deepEqual(read({attendanceTo:'2026-10-01'}).workers.map(w=>w.id),[a.id]);
    assert.deepEqual(read({attendanceFrom:'2026-10-02',attendanceTo:'2026-10-02'}).workers,[]);assert.equal(read({}).summary.total,3);
    assert.throws(()=>read({attendanceFrom:'2026-10-04',attendanceTo:'2026-10-03'}),/출역 조회/);assert.throws(()=>read({attendanceFrom:'2026-02-30'}),/날짜/);
    assert.equal(store.workers(other.id,'',{attendanceFrom:'2026-10-01',attendanceTo:'2026-10-03'}).length,1);assert.ok(!read({attendanceFrom:'2026-10-01'}).workers.some(w=>w.id===c.id));
  }finally{store.close();}
});
