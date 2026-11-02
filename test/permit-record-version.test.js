import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';
import {Store} from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;
const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
const check={date:'2026-11-02',items:[{name:'가상 점검',result:'pass',action:''}]};
const extension={dateFrom:'2026-11-02',dateTo:'2026-11-03',signature};
const conflict=e=>e.sessionStatus===409;
const setup=s=>{const site=s.createSite({name:'가상 현장'});return s.createDocument({siteId:site.id,type:'permit',title:'가상 허가',date:check.date});};

test('점검·연장 교차 수정, 같은 값 복구, 삭제 후 ID 재사용을 버전으로 차단한다',()=>{
  const s=new Store(':memory:');try{const doc=setup(s);
    for(const [table,save,list,remove,input] of [['permit_checks','savePermitCheck','permitChecks','deletePermitCheck',check],['permit_extensions','savePermitExtension','permitExtensions','deletePermitExtension',extension]]){
      const id=s[save](doc.id,input),old=s[list](doc.id)[0];assert.match(old.version,/^[a-f0-9]{64}$/);
      s[save](doc.id,{...input,expectedVersion:old.version},id);const current=s[list](doc.id)[0];assert.notEqual(current.version,old.version);
      assert.throws(()=>s[save](doc.id,{...input,expectedVersion:old.version},id),conflict);
      assert.throws(()=>s[remove](doc.id,id,()=>{},old.version),conflict);
      assert.throws(()=>s[save](doc.id,{...input,expectedVersion:current.version},id,()=>s.db.prepare(`UPDATE ${table} SET created_at=created_at WHERE id=?`).run(id)),conflict);
      assert.equal(s[list](doc.id)[0].version,current.version);
      s[remove](doc.id,id,()=>{},current.version);const replacement=s[save](doc.id,input);assert.equal(replacement,id);
      assert.notEqual(s[list](doc.id)[0].version,current.version);
      assert.throws(()=>s[remove](doc.id,id,()=>{},current.version),conflict);
      assert.throws(()=>s[save](doc.id,{...input,expectedVersion:current.version},id),conflict);
      if(table==='permit_extensions'){assert.throws(()=>s.permitExtensionSignature(doc.id,id,current.version),conflict);assert.ok(s.permitExtensionSignature(doc.id,id,s[list](doc.id)[0].version));assert.ok(s.permitExtensionSignature(doc.id,id));}
      assert.equal(s[list](doc.id).length,1);
    }
  }finally{s.close();}
});

test('기존 점검·연장 DB는 내용과 서명을 유지해 한 번 이관하고 재시작해도 버전을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-version-')),path=join(dir,'test.sqlite');let s;
  try{s=new Store(path);const doc=setup(s),checkId=s.savePermitCheck(doc.id,check),extensionId=s.savePermitExtension(doc.id,extension);s.close();s=null;
    const db=new DatabaseSync(path);for(const table of ['permit_checks','permit_extensions']){db.exec(`DROP TRIGGER ${table}_created_version;DROP TRIGGER ${table}_changed_version;ALTER TABLE ${table} DROP COLUMN version;`);}db.close();
    s=new Store(path);const checks=s.permitChecks(doc.id),extensions=s.permitExtensions(doc.id);assert.equal(checks[0].id,checkId);assert.equal(extensions[0].id,extensionId);assert.deepEqual(checks[0].items,check.items);assert.deepEqual(Buffer.from(s.permitExtensionSignature(doc.id,extensionId)),PNG.sync.write(png));s.close();s=new Store(path);
    assert.deepEqual(s.permitChecks(doc.id),checks);assert.deepEqual(s.permitExtensions(doc.id),extensions);
  }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

test('승인 후 허가 점검·연장 변경은 허용하고 승인 당시 사본과 서명을 보존한다',()=>{
  const s=new Store(':memory:');try{const doc=setup(s),checkId=s.savePermitCheck(doc.id,check),extensionId=s.savePermitExtension(doc.id,extension);const cycleId=s.captureApprovalCycle(s.document(doc.id));
    s.db.prepare("UPDATE documents SET status='approved',approval_cycle_id=? WHERE id=?").run(cycleId,doc.id);const before=JSON.stringify(s.approvalCycle(doc.id,cycleId)),files=s.db.prepare('SELECT * FROM approval_cycle_files WHERE cycle_id=?').all(cycleId);
    s.savePermitCheck(doc.id,{...check,date:'2026-11-03',expectedVersion:s.permitChecks(doc.id)[0].version},checkId);
    s.savePermitExtension(doc.id,{...extension,dateTo:'2026-11-04',expectedVersion:s.permitExtensions(doc.id)[0].version},extensionId);
    s.deletePermitExtension(doc.id,extensionId,()=>{},s.permitExtensions(doc.id)[0].version);
    assert.equal(JSON.stringify(s.approvalCycle(doc.id,cycleId)),before);assert.deepEqual(s.db.prepare('SELECT * FROM approval_cycle_files WHERE cycle_id=?').all(cycleId),files);assert.ok(files.some(row=>row.kind==='permit-signature'));
  }finally{s.close();}
});
