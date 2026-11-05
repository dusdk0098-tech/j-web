import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { riskDetailMarkup } from '../public/risk-detail.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readRiskReviewRoles } from '../public/risk-review-roles.js';

test('일반 위험요인 선택을 보존하고 이전 저장 요청의 선택 유실을 막는다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),input={siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-03',details:{items:[{task:'선택',selected:true},{task:'미선택',selected:false},{task:'이전 항목'}]}};
    const doc=store.createDocument(input),read=()=>JSON.parse(store.document(doc.id).details);
    assert.deepEqual(read().items.map(row=>row.selected),[true,false,undefined]);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items:[{task:'미선택'}]}}),/선택을 보존/);
    assert.throws(()=>store.updateDocument(doc.id,{...input,details:{items:[{task:'잘못된 선택',selected:'false'}]}}),/선택을 확인/);
    store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;
    store.transition(doc.id,'withdraw');store.updateDocument(doc.id,{...input,details:{items:[{task:'변경',selected:true}]}});
    assert.equal(read().items[0].selected,true);
    assert.equal(JSON.parse(store.approvalCycle(doc.id,cycle).document.details).items[1].selected,false);
  }finally{store.close();}
});

test('상세 화면은 선택 항목과 이전 항목을 표시하고 미선택 항목의 보존을 알린다',()=>{
  const html=riskDetailMarkup({items:[{task:'선택',selected:true},{task:'미선택',selected:false},{task:'이전 항목'}]},String,{task:'작업'},{},{});
  assert.match(html,/선택/);assert.match(html,/이전 항목/);assert.doesNotMatch(html,/>미선택</);assert.match(html,/1개는 수정 화면에 보존/);
});

test('관리자와 근로자 저장 화면은 선택 상태를 전송한다',()=>{
  const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),worker=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8');
  const adminLine=admin.split('\n').find(line=>line.includes("if(data.type==='risk') data.details=")),workerLine=worker.split('\n').find(line=>line.includes('Object.assign(input.details,{riskReviewRoles:'));
  const row={querySelector(selector){if(selector.includes('selected'))return {checked:false};if(selector.includes('contractor'))return {value:''};return {value:'가상 위험'};}};
  const data={type:'risk'},muscleEditor={read:()=>[]},document={querySelectorAll:()=>[row]},riskFields={task:'작업'};
  runInNewContext(adminLine,{data,muscleEditor,document,riskFields,readRiskReviewRoles});assert.equal(data.details.items[0].selected,false);
  const input={details:{}},form={elements:{kind:{value:''},scale:{value:''},periodFrom:{value:''},periodTo:{value:''}}},fields={querySelector:()=>({children:[row]})};
  runInNewContext(workerLine,{input,form,fields,muscleEditor,riskFields,readRiskReviewRoles});assert.equal(input.details.items[0].selected,false);
});

test('결재 사본 화면은 미선택 항목을 숨기고 개수를 알린다',()=>{
  const code=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=code.indexOf('function displayFields('),end=code.indexOf('function pad(',start);
  const doc={type:'risk',details:JSON.stringify({items:[{task:'결재 선택',selected:true},{task:'결재 미선택',selected:false},{task:'결재 이전 항목'}]})};
  const html=runInNewContext(`${code.slice(start,end)};displayDocumentDetails(doc)`,{doc,esc:String,labels:{task:'작업',items:'항목',selected:'선택'},riskReviewSummary:()=>'',educationKinds:{},selectedMusculoskeletalItems:rows=>rows.filter(row=>row.selected)});
  assert.match(html,/결재 선택/);assert.match(html,/결재 이전 항목/);assert.doesNotMatch(html,/결재 미선택/);assert.match(html,/1개는 수정 화면에 보존/);
});
