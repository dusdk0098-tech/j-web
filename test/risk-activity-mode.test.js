import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mountRiskActivityMode} from '../public/risk-activity-mode.js';
import {Store} from '../store.js';

function input(value=''){
  const classes=new Set(),label={hidden:false,classList:{add:name=>classes.add(name)}},listeners={};
  return {value,disabled:false,label,classes,closest:()=>label,addEventListener:(type,fn)=>{listeners[type]=fn;},change(){listeners.change();}};
}

test('주간 스캔과 다른 활동 종류를 바꾸어도 입력을 보존하고 제출값을 구분한다',()=>{
  const fields=Object.fromEntries(Object.entries({kind:'weekly',entryMode:'scan',periodFrom:'2026-11-01',periodTo:'2026-11-07',date:'2026-11-02',place:'가상 장소',host:'가상 주관',participants:'가상 참석',content:'보존할 내용',classification:'가상 구분'}).map(([name,value])=>[name,input(value)]));
  const groups=[{hidden:false},{hidden:false}],notice={hidden:true},form={elements:fields,querySelectorAll:()=>groups,querySelector:()=>notice};mountRiskActivityMode(form);
  assert.equal(fields.entryMode.disabled,false);assert.equal(fields.place.label.hidden,true);assert.equal(groups[0].hidden,true);assert.equal(notice.hidden,false);assert.equal(fields.place.disabled,false);
  fields.kind.value='meeting';fields.kind.change();assert.equal(fields.entryMode.disabled,true);assert.equal(fields.periodFrom.label.hidden,false);assert.equal(fields.place.label.hidden,false);assert.equal(notice.hidden,true);
  const data=Object.fromEntries(Object.entries(fields).filter(([,field])=>!field.disabled).map(([name,field])=>[name,field.value]));
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-11-02'}),id=store.saveRiskActivity(doc.id,data),saved=store.riskActivities(doc.id).find(row=>row.id===id);assert.equal(saved.entry_mode,'manual');assert.equal(saved.content,'보존할 내용');assert.equal(saved.period_from,'2026-11-01');}finally{store.close();}
  fields.kind.value='weekly';fields.kind.change();assert.equal(fields.entryMode.value,'scan');assert.equal(fields.periodFrom.value,'2026-11-01');assert.equal(fields.content.value,'보존할 내용');assert.equal(fields.content.label.hidden,true);
  fields.entryMode.value='manual';fields.entryMode.change();assert.equal(fields.content.label.hidden,false);assert.equal(groups[1].hidden,false);
  fields.kind.value='other';fields.kind.change();assert.equal(fields.classification.disabled,false);assert.equal(fields.classification.label.hidden,false);assert.equal(fields.entryMode.disabled,true);
  fields.periodFrom.value='';fields.periodTo.value='';fields.kind.change();assert.equal(fields.periodFrom.label.hidden,true);fields.periodFrom.value='2026-11-01';fields.kind.change();assert.equal(fields.periodFrom.label.hidden,false);
  assert.ok(fields.place.classes.has('risk-activity-mode-field'));assert.match(readFileSync(new URL('../public/style.css',import.meta.url),'utf8'),/\.risk-activity-mode-field\[hidden\]\{display:none\}/);
});

test('활동 입력 대화상자에서 선택 방식 전환을 연결한다',()=>{
  const fields=Object.fromEntries(Object.entries({kind:'meeting',entryMode:'manual',periodFrom:'',periodTo:'',date:'2026-11-02',place:'',host:'',participants:'',content:'',classification:''}).map(([name,value])=>[name,input(value)])),groups=[{hidden:false},{hidden:false}],notice={hidden:true};
  const form={elements:fields,querySelectorAll:()=>groups,querySelector:()=>notice},container={html:'',insertAdjacentHTML(_position,html){this.html+=html;}},source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),handler=source.split('\n').find(line=>line.includes('const editRiskActivity='));assert.ok(handler);
  runInNewContext(handler+'\neditRiskActivity(null)',{editActivity:()=>{},field:()=>'',mountRiskActivityMode,$:selector=>selector==='#dialog-form'?form:container});
  assert.match(container.html,/data-risk-scan-notice/);assert.equal(fields.entryMode.disabled,true);fields.kind.value='weekly';fields.kind.change();fields.entryMode.value='scan';fields.entryMode.change();assert.equal(fields.entryMode.disabled,false);assert.equal(fields.content.label.hidden,true);assert.equal(notice.hidden,false);
});
