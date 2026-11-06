import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';

test('주간 보고서는 조회 중 자료가 바뀌어도 한 시점으로 집계한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-week-snapshot-')),file=join(dir,'test.sqlite');let first=new Store(file),second;
  try{
    first.db.exec('PRAGMA journal_mode=WAL');second=new Store(file);
    const site=first.createSite({name:'가상 현장'}),worker=first.createWorker({siteId:site.id,name:'가상 작업자',category:'직영',company:'가상 업체',occupation:'목공'}),date='2026-11-01';
    first.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});
    const prepare=first.db.prepare.bind(first.db);let changed=false;
    first.db.prepare=sql=>{if(!changed&&sql.startsWith('SELECT date,type,COUNT(*) AS n FROM documents')){changed=true;second.setAttendance({siteId:site.id,workerId:worker.id,date,present:false});second.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date});}return prepare(sql);};
    const before=first.weeklyActivity(site.id,date)[0];first.db.prepare=prepare;
    assert.equal(changed,true);assert.equal(before.attendance,1);assert.equal(before.documents.tbm,undefined);
    const after=first.weeklyActivity(site.id,date)[0];assert.equal(after.attendance,0);assert.equal(after.documents.tbm,1);
  }finally{first?.close();second?.close();rmSync(dir,{recursive:true,force:true});}
});

test('주간 조회 실패는 읽기 범위를 정리하고 외부 트랜잭션 안에서도 동작한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    assert.throws(()=>s.weeklyActivity(site.id,'잘못된 날짜'));
    assert.throws(()=>s.weeklyActivity(999999,'2026-11-01'),/현장/);
    s.db.exec('BEGIN');assert.equal(s.weeklyActivity(site.id,'2026-11-01').length,7);s.db.exec('ROLLBACK');
    assert.equal(s.weeklyActivity(site.id,'2026-11-01').length,7);
  }finally{s.close();}
});
