import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.js';

test('사고 정도별 가상 보고서는 각각 저장하고 재시작 후 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-incident-guide-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),created=['경상','중상','사망'].map(severity=>s.createDocument({siteId:site.id,type:'incident',title:`가상 ${severity} 보고`,date:'2026-10-30',details:{severity}}));
    assert.deepEqual(created.map(doc=>JSON.parse(doc.details).severity),['경상','중상','사망']);assert.throws(()=>s.createDocument({siteId:site.id,type:'incident',title:'잘못된 유형',date:'2026-10-30',details:{severity:'임의 유형'}}),/사고유형/);assert.equal(s.documents(other.id,'incident').length,0);s.close();s=new Store(path);assert.deepEqual(s.documents(site.id,'incident').map(doc=>JSON.parse(doc.details).severity).sort(),['경상','사망','중상']);
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});
