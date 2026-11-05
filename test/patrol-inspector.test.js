import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('순회 점검자는 저장·수정·결재 사본에 보존되고 잘못된 입력은 거절된다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'patrol',title:'가상 점검',date:'2026-11-03',details:{inspector:' 가상 점검자 ',items:[]}},doc=store.createDocument(input);
    assert.equal(JSON.parse(doc.details).inspector,'가상 점검자');
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{inspector:'가'.repeat(201),items:[]}}),/점검자/);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{inspector:42,items:[]}}),/점검자/);
    store.updateDocument(doc.id,{...input,details:{items:[]}});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'가상 점검자');
    store.updateDocument(doc.id,{...input,details:null});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'가상 점검자');
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;
    store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{inspector:'다른 점검자',items:[]}});
    assert.equal(JSON.parse(store.document(doc.id).details).inspector,'다른 점검자');
    assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).inspector,'가상 점검자');
    store.updateDocument(doc.id,{...input,details:{inspector:'',items:[]}});assert.equal(JSON.parse(store.document(doc.id).details).inspector,'');
    const legacy=store.createDocument({...input,details:{items:[]}});assert.equal(JSON.parse(legacy.details).inspector,'');
  }finally{store.close();}
});

test('순회 점검 구분과 세부사항은 저장·결재 사본에 보존되고 구형 수정은 거절한다',()=>{
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),item={name:'가상 항목',result:'X',note:'가상 조치',patrolGroup:' 가상 구분 ',patrolGuidance:' 가상 확인 내용 '},input={siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-11-03',details:{items:[item]}},doc=store.createDocument(input),saved=JSON.parse(doc.details).items[0];assert.equal(saved.patrolGroup,'가상 구분');assert.equal(saved.patrolGuidance,'가상 확인 내용');
    for(const items of [undefined,[],[{name:item.name,result:item.result,note:item.note}]])assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items}}),/새로고침/);assert.deepEqual(JSON.parse(store.document(doc.id).details).items[0],saved);
    for(const invalid of [4,'가'.repeat(2001)])assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items:[{...item,patrolGuidance:invalid}]}}),/순회 점검/);
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{items:[{...item,patrolGroup:'',patrolGuidance:''}]}});assert.equal(JSON.parse(store.document(doc.id).details).items[0].patrolGuidance,'');assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).items[0].patrolGuidance,'가상 확인 내용');
    const legacy=store.createDocument({...input,details:{items:[{name:'가상 구형',result:'O',note:''}]}});store.updateDocument(legacy.id,{...input,details:{items:[{name:'가상 구형',result:'X',note:'조치'}]}});assert.equal(JSON.parse(store.document(legacy.id).details).items[0].result,'X');
  }finally{store.close();}
});

test('순회 점검 편집 항목에서 구분과 세부사항을 전송한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(String.fromCharCode(10)).find(value=>value.includes("if(data.type==='patrol')data.details="));assert.ok(line);const fields={select:{value:'X'},'[data-patrol-note]':{value:'가상 조치'},'[data-patrol-group]':{value:'가상 구분'},'[data-patrol-guidance]':{value:'가상 세부'}},row={dataset:{name:'가상 항목'},querySelector:selector=>fields[selector]},data={type:'patrol'},document={querySelectorAll:()=>[row]};runInNewContext(line,{data,document,readPatrolActivities:()=>[]});assert.deepEqual(JSON.parse(JSON.stringify(data.details.items)),[{name:'가상 항목',result:'X',note:'가상 조치',patrolGroup:'가상 구분',patrolGuidance:'가상 세부'}]);
});
