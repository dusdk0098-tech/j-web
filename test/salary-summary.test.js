import test from 'node:test';
import assert from 'node:assert/strict';
import { salarySummary, salaryDay, groupWageRecords } from '../public/salary-summary.js';

test('시험 급여는 종류와 근로 구분에 따라 계산하며 모순은 표시하지 않는다',()=>{
  const daily=(rate,units=100,category='직영')=>({category,salary_kind:null,daily_rate:rate,units_hundredths:units}),fixed=(kind,amount,category='직영')=>({category,salary_kind:kind,salary_amount:amount});
  assert.equal(salarySummary([daily(101,50),daily(101,125)]).total,177);
  assert.equal(salarySummary([fixed('monthly',3000),fixed('monthly',3000)]).total,3000);
  assert.equal(salarySummary([fixed('yearly',12000),fixed('yearly',12000)]).total,12000);
  assert.equal(salarySummary([fixed('monthly',3000),daily(50,100,'외주')]).total,3050);
  assert.match(salarySummary([daily(100),fixed('monthly',3000)]).reason,/혼합/);
  assert.match(salarySummary([fixed('monthly',3000),fixed('monthly',4000)]).reason,/불일치/);
  assert.match(salarySummary([fixed('other',100)]).reason,/기타/);
  assert.match(salarySummary([daily(null)]).reason,/미기록/);
  assert.match(salarySummary([{...daily(100),category:null}]).reason,/구분/);
});

test('날짜별 급여는 종류와 미출역·미기록을 구분한다',()=>{
  assert.deepEqual(salaryDay(null),{kind:'미출역',amount:'미출역'});
  assert.deepEqual(salaryDay({salary_kind:null,daily_rate:null}),{kind:'미기록',amount:'미기록'});
  assert.deepEqual(salaryDay({salary_kind:null,daily_rate:0}),{kind:'일당',amount:0});
  assert.deepEqual(salaryDay({salary_kind:'yearly',salary_amount:12000,daily_rate:100}),{kind:'연봉',amount:12000});
});

test('직종별 가상 명세는 근로자 기록과 미기록 공수를 보존한다',()=>{
  const rows=[{worker_id:1,occupation:'목공',gross:1000,units_hundredths:125,units_missing:1},{worker_id:2,occupation:'전기',gross:300,units_hundredths:null,units_missing:2},{worker_id:3,occupation:'목공',gross:0,units_hundredths:0,units_missing:0}];
  const groups=groupWageRecords(rows),carpenter=groups.find(group=>group.occupation==='목공'),electrician=groups.find(group=>group.occupation==='전기');
  assert.deepEqual(carpenter.rows.map(row=>row.worker_id),[1,3]);assert.equal(carpenter.units_hundredths,125);assert.equal(carpenter.units_missing,1);assert.equal(carpenter.gross,1000);
  assert.equal(electrician.units_hundredths,null);assert.equal(electrician.units_missing,2);assert.equal(electrician.gross,300);assert.deepEqual(groupWageRecords([]),[]);
});
