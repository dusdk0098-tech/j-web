import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('사진 비고는 이전 화면 수정과 재시작에도 보존되고 결재 사본과 독립적이다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-wind-note-'));let store;
  try{
    const path=join(dir,'test.sqlite');store=new Store(path);
    const site=store.createSite({name:'가상 현장'}),reviewer=store.createReviewer({siteId:site.id,loginId:'wind_note',name:'가상 직원',password:'virtual-password-123'}),answers=Array.from({length:9},()=>({answer:'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 강풍 점검',date:'2026-10-30',details:{kind:'wind',answers,photoNote:' 가상 사진 비고 '}};
    const doc=store.createDocument(input);assert.equal(JSON.parse(doc.details).photoNote,'가상 사진 비고');
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{...input.details,photoNote:'가'.repeat(1001)}}),/비고/);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{...input.details,photoNote:{}}}),/비고/);
    store.updateDocument(doc.id,{...input,details:{kind:'wind',answers}});assert.equal(JSON.parse(store.document(doc.id).details).photoNote,'가상 사진 비고');
    store.close();store=new Store(path);assert.equal(JSON.parse(store.document(doc.id).details).photoNote,'가상 사진 비고');
    store.setApprovalLine(doc.id,[reviewer.id]);const pending=store.transition(doc.id,'submit'),cycle=store.approvalCycle(doc.id,pending.approval_cycle_id);assert.equal(JSON.parse(cycle.document.details).photoNote,'가상 사진 비고');
    store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{kind:'wind',answers,photoNote:'수정한 가상 비고'}});
    assert.equal(JSON.parse(store.document(doc.id).details).photoNote,'수정한 가상 비고');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle.id).document.details).photoNote,'가상 사진 비고');
    store.updateDocument(doc.id,{...input,details:{kind:'wind',answers,photoNote:''}});assert.equal(JSON.parse(store.document(doc.id).details).photoNote,'');
    store.updateDocument(doc.id,{...input,details:{kind:'rain',answers:answers.slice(0,7)}});assert.equal(Object.hasOwn(JSON.parse(store.document(doc.id).details),'photoNote'),false);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
