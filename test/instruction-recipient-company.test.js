import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {belongsToInstructionCompany} from '../public/instruction-recipients.js';

test('동명 협력사는 번호가 일치하는 수신자만 연결하고 이름만 있는 구형 자료는 추정하지 않는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),first=store.createCompany({siteId:site.id,name:'동명 업체',trade:'A'}),outside=store.createCompany({siteId:other.id,name:'동명 업체',trade:'C'}),fields={siteId:site.id,category:'직영',company:first.name,occupation:'가상 직종'};
    const legacy=store.createWorker({...fields,name:'이전 출입자'}),one=store.createWorker({...fields,name:'첫 업체 출입자',companyId:first.id}),input={siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-11-01'};
    assert.equal(JSON.parse(store.createDocument({...input,details:{companyId:first.id,recipientId:legacy.id}}).details).recipientId,legacy.id);
    const second=store.createCompany({siteId:site.id,name:'동명 업체',trade:'B'}),two=store.createWorker({...fields,name:'둘째 업체 출입자',companyId:second.id}),foreign=store.createWorker({...fields,siteId:other.id,name:'다른 현장 출입자',companyId:outside.id});
    for(const company of [first,second])assert.throws(()=>store.createDocument({...input,details:{companyId:company.id,recipientId:legacy.id}}),/담당자/);
    assert.throws(()=>store.createDocument({...input,details:{companyId:first.id,recipientId:two.id}}),/담당자/);assert.throws(()=>store.createDocument({...input,details:{companyId:first.id,recipientId:foreign.id}}),/담당자/);
    const doc=store.createDocument({...input,details:{companyId:first.id,recipientId:one.id}});store.transition(doc.id,'submit');store.transition(doc.id,'approve');
    assert.deepEqual(store.workerInstructions(one.id).map(row=>row.id),[doc.id]);assert.deepEqual(store.workerInstructions(two.id),[]);assert.throws(()=>store.workerInstructionAttachments(two.id,doc.id),/지정/);
    store.updateCompany(first.id,{siteId:site.id,name:'변경된 업체',trade:'A'});
    assert.equal(JSON.parse(store.createDocument({...input,details:{companyId:first.id,recipientId:one.id}}).details).recipientId,one.id);
  }finally{store.close();}
});

test('담당자 선택 화면은 같은 이름의 다른 업체 출입자를 표시하지 않는다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(value=>value.includes('const setWorkers=selected=>'));assert.ok(line);
  const companies=[{id:1,name:'동명 업체'},{id:2,name:'동명 업체'}],workers=[{id:1,name:'첫 업체',occupation:'가상',company:'동명 업체',company_id:1},{id:2,name:'둘째 업체',occupation:'가상',company:'동명 업체',company_id:2},{id:3,name:'구형',occupation:'가상',company:'동명 업체',company_id:null}],companySelect={value:'1'},workerSelect={},context={companies,workers,companySelect,workerSelect,belongsToInstructionCompany,esc:value=>String(value)};
  runInNewContext(line+'\nsetWorkers(0);',context);assert.match(workerSelect.innerHTML,/첫 업체/);assert.doesNotMatch(workerSelect.innerHTML,/둘째 업체|구형/);
});
