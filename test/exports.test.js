import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from 'read-excel-file/node';
import { Store } from '../store.js';
import { workerSpreadsheet, wageSpreadsheet } from '../exports.js';

test('가상 노임 엑셀은 선택한 현장과 월의 기록만 내보낸다',async()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 회사',occupation:'목공'}),one=add(a.id,'=가상 근로자'),other=add(b.id,'다른 현장'),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'};
    for(const [siteId,workerId,month] of [[a.id,one.id,'2024-02'],[a.id,one.id,'2024-03'],[b.id,other.id,'2024-02']])s.saveWageRecord({siteId,workerId,month,gross:'1000',deductions});
    for(const date of ['2024-02-01','2024-02-02'])s.setAttendance({siteId:a.id,workerId:one.id,date,present:true});s.setAttendanceUnits({siteId:a.id,workerId:one.id,date:'2024-02-01',units:'0.50'});s.setAttendanceDailyRate({siteId:a.id,workerId:one.id,date:'2024-02-01',dailyRate:'101'});
    const rows=await readSheet(await wageSpreadsheet(s.wageRecords(a.id,'2024-02')));assert.equal(rows.length,2);assert.equal(rows[1][0],'=가상 근로자');assert.equal(rows[1][3],1000);assert.equal(rows[1][10],188);assert.equal(rows[1][11],812);assert.equal(rows[1][12],2);assert.equal(rows[1][13],0.5);assert.equal(rows[1][14],1);assert.equal(rows[1][15],51);assert.equal(rows[1][16],1);
  }finally{s.close();}
});

test('엑셀에 선택한 현장과 검색 결과만 문자열로 기록한다',async()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    s.createWorker({siteId:a.id,name:'=가상 시험자',category:'직영',company:'가상 업체',occupation:'목공'});
    s.createWorker({siteId:a.id,name:'다른 사람',category:'직영',company:'가상 업체',occupation:'전기'});
    s.createWorker({siteId:b.id,name:'가상 시험자',category:'직영',company:'다른 현장',occupation:'목공'});
    const rows=await readSheet(await workerSpreadsheet(s.workers(a.id,'시험자')));
    assert.deepEqual(rows,[['이름','구분','소속','직종'],['=가상 시험자','직영','가상 업체','목공']]);
    const filtered=await readSheet(await workerSpreadsheet(s.workers(a.id,'',{category:'직영',company:'가상 업체',occupation:'전기'})));
    assert.deepEqual(filtered,[['이름','구분','소속','직종'],['다른 사람','직영','가상 업체','전기']]);
    assert.equal(s.workers(b.id,'',{company:'가상 업체'}).length,0);
    s.db.prepare("UPDATE workers SET created_date='2026-10-01'").run();
    s.db.prepare("UPDATE workers SET created_date='2026-10-28' WHERE name='다른 사람'").run();
    assert.deepEqual(s.workers(a.id,'',{from:'2026-10-28',to:'2026-10-28'}).map(w=>w.name),['다른 사람']);
    s.db.prepare("UPDATE workers SET created_date=NULL WHERE name='다른 사람'").run();
    assert.equal(s.workers(a.id,'',{from:'2026-10-28',to:'2026-10-28'}).length,0);
    assert.throws(()=>s.workers(a.id,'',{from:'2026-10-29',to:'2026-10-28'}),/시작일/);
  } finally {s.close();}
});
