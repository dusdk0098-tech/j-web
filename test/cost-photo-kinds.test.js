import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.js';

test('기존 사진은 일반 사진으로 유지하고 월간 사본에 영수증 유형을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-kind-')),path=join(dir,'test.sqlite'),bytes=Buffer.from('89504e470d0a1a0a00000000','hex');let store;
  try{
    store=new Store(path);const site=store.createSite({name:'가상 현장'}),cost=store.createSafetyCost({siteId:site.id,category:'2',date:'2026-10-29',description:'가상 내역',note:'',unitPrice:'1000',quantity:'1',unit:'개'}),oldId=store.addSafetyCostPhoto(site.id,cost.id,'가상.png',bytes);store.close();store=null;
    const legacy=new DatabaseSync(path);legacy.exec('ALTER TABLE safety_cost_photos DROP COLUMN kind; ALTER TABLE safety_cost_photos DROP COLUMN version; ALTER TABLE safety_cost_report_photos DROP COLUMN kind');legacy.close();store=new Store(path);
    assert.equal(store.safetyCostPhotos(site.id,cost.id)[0].kind,'photo');assert.match(store.safetyCostPhotos(site.id,cost.id)[0].version,/^[a-f0-9]{32}$/);const receiptId=store.addSafetyCostPhoto(site.id,cost.id,'가상 영수증.png',bytes,'receipt');assert.throws(()=>store.addSafetyCostPhoto(site.id,cost.id,'가상.png',bytes,'other'),/유형/);
    const report=store.createSafetyCostReport({siteId:site.id,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1000',progress:'50'}),cycle=store.captureApprovalCycle(report);store.deleteSafetyCostPhoto(site.id,cost.id,oldId);store.deleteSafetyCostPhoto(site.id,cost.id,receiptId);assert.deepEqual(store.safetyCostReportPhotos(report.id).map(photo=>photo.kind),['photo','receipt']);assert.deepEqual(store.approvalCycle(report.id,cycle).linked.photos.map(photo=>photo.kind),['photo','receipt']);
    store.close();store=new Store(path);assert.deepEqual(store.safetyCostReportPhotos(report.id).map(photo=>photo.kind),['photo','receipt']);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
