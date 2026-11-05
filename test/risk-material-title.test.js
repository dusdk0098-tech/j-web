import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';

test('기타 자료 제목을 저장하고 이전 요청·결재 사본·재시작에서 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'risk-title-')),file=join(dir,'db.sqlite');let store=new Store(file);
  try{
    const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-03'}),input={kind:'other',date:'2026-11-03',place:'',host:'',participants:'',content:'가상 내용',classification:'가상 분류',subject:' 가상 제목 '};
    const id=store.saveRiskActivity(doc.id,input),read=()=>store.riskActivities(doc.id)[0];assert.equal(read().subject,'가상 제목');
    const {subject,...legacy}=input;store.saveRiskActivity(doc.id,legacy,id);assert.equal(read().subject,'가상 제목');
    assert.throws(()=>store.saveRiskActivity(doc.id,{...input,subject:42},id),/제목/);assert.throws(()=>store.saveRiskActivity(doc.id,{...input,subject:'가'.repeat(201)},id),/제목/);
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.saveRiskActivity(doc.id,{...input,subject:'변경 제목'},id);
    assert.equal(store.approvalCycle(doc.id,cycle).linked.activities[0].subject,'가상 제목');store.close();store=new Store(file);assert.equal(read().subject,'변경 제목');
    store.saveRiskActivity(doc.id,{...input,subject:''},id);assert.equal(read().subject,'');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('이전 활동 데이터는 제목 열 추가 후 내용을 유지한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'risk-title-old-')),file=join(dir,'db.sqlite');let store=new Store(file);
  try{const site=store.createSite({name:'가상'}),doc=store.createDocument({siteId:site.id,type:'risk',title:'평가',date:'2026-11-03'}),input={kind:'other',date:'2026-11-03',place:'',host:'',participants:'',content:'기존 내용',classification:'기존 분류'};store.saveRiskActivity(doc.id,input);store.close();const db=new DatabaseSync(file);db.exec('ALTER TABLE risk_activities DROP COLUMN subject');db.close();store=new Store(file);const row=store.riskActivities(doc.id)[0];assert.equal(row.subject,'');assert.equal(row.content,'기존 내용');}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('관리자 입력과 결재 사본 표시가 자료 제목을 연결한다',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),review=readFileSync(new URL('../public/review.js',import.meta.url),'utf8');
 assert.match(app,/field\('subject','기타 자료 제목/);assert.match(app,/esc\(a\.subject\|\|'미기록'\)/);assert.match(review,/title:activity\.subject/);
});
