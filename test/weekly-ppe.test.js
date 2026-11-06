import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { checklistQuestions } from '../public/checklist-copy.js';
import { Store } from '../store.js';
import { weeklyPpeMarkup,weeklyActivitySummaryMarkup,weeklyChecklistMarkup } from '../public/weekly-ppe.js';

test('주간 활동 합계는 문서와 시험 확인을 종류별로 분리해 합산한다',()=>{
  const days=[{documents:{notice:2,tbm:1,inspection:2,patrol:1,safety_log:1,work_plan:1,checklist:3},noticeReads:3,trainingByType:{tbm:2,education:0}},{documents:{notice:1,education:4,patrol:2,checklist:1},noticeReads:1,trainingByType:{tbm:0,education:3}}];
  const html=weeklyActivitySummaryMarkup(days);assert.match(html,/<td>공지<\/td><td>3<\/td><td>4<\/td>/);assert.match(html,/<td>TBM<\/td><td>1<\/td><td>2<\/td>/);assert.match(html,/<td>교육<\/td><td>4<\/td><td>3<\/td>/);assert.match(html,/여러 건/);
  for(const [label,count] of [['안전 점검',2],['순회 점검',3],['안전 업무 일지',1],['작업계획서',1],['체크리스트',4]])assert.ok(html.includes(`<td>${label}</td><td>${count}</td><td>—</td>`),label);
  assert.match(weeklyActivitySummaryMarkup([]),/<td>공지<\/td><td>0<\/td><td>0<\/td>/);
});

test('주간 활동 합계는 저장된 현장과 기간 및 승인 문서의 확인만 계산한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),make=(siteId,type,date,status)=>{const doc=store.createDocument({siteId,type,title:'가상 문서',date});store.db.prepare('UPDATE documents SET status=? WHERE id=?').run(status,doc.id);return doc;};
    const first=make(site.id,'notice','2024-02-27','approved'),second=make(site.id,'notice','2024-02-28','approved'),draft=make(site.id,'notice','2024-02-28','draft'),tbm=make(site.id,'tbm','2024-02-29','approved'),education=make(site.id,'education','2024-03-01','approved');make(other.id,'notice','2024-02-27','approved');make(site.id,'notice','2024-03-05','approved');
    for(const type of ['inspection','patrol','safety_log','incident','risk','work_plan','instruction','checklist']){make(site.id,type,'2024-03-01','draft');make(other.id,type,'2024-03-01','approved');make(site.id,type,'2024-03-05','approved');}
    for(const doc of [first,second,draft])store.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id) VALUES(?,?)').run(worker.id,doc.id);for(const doc of [tbm,education])store.db.prepare('INSERT INTO worker_training_checks(worker_id,document_id) VALUES(?,?)').run(worker.id,doc.id);
    const html=weeklyActivitySummaryMarkup(store.weeklyActivity(site.id,'2024-02-27'));assert.match(html,/<td>공지<\/td><td>3<\/td><td>2<\/td>/);assert.match(html,/<td>TBM<\/td><td>1<\/td><td>1<\/td>/);assert.match(html,/<td>교육<\/td><td>1<\/td><td>1<\/td>/);
    for(const label of ['안전 점검','순회 점검','안전 업무 일지','재해 보고서','위험성평가','작업계획서','작업지시서','체크리스트'])assert.ok(html.includes(`<td>${label}</td><td>1</td><td>—</td>`),label);
  }finally{store.close();}
});

test('주간 보호구 품목별 집계는 수량과 서명된 지급 기록을 현장 및 날짜별로 분리한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const person=siteId=>store.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),worker=person(site.id),foreign=person(other.id);
    const issue=(siteId,workerId,date,item,quantity)=>store.addPpeIssue({siteId,workerId,date,item,quantity});
    const signed=issue(site.id,worker.id,'2024-02-29','가상 안전모','3');
    issue(site.id,worker.id,'2024-02-29','가상 안전모','2');
    issue(site.id,worker.id,'2024-03-01','가상 안전모','4');
    issue(site.id,worker.id,'2024-03-01','<가상 장갑>','1');
    issue(site.id,worker.id,'2024-03-05','가상 안전모','9');
    issue(other.id,foreign.id,'2024-02-29','가상 안전모','7');
    const png=new PNG({width:1,height:1});png.data[3]=255;
    const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    const version=store.workerPpeIssues(site.id,worker.id).find(row=>row.id===signed).version;
    store.confirmPpeReceipt(site.id,worker.id,signed,version,signature);
    const days=store.weeklyActivity(site.id,'2024-02-27');
    assert.deepEqual(days[2].ppeIssues,[{item:'가상 안전모',quantity:5}]);
    assert.deepEqual(days[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:1,total:2}]);
    assert.deepEqual(days[2].ppeReceipts,{confirmed:1,total:2});
    assert.deepEqual(days[0].ppeReceiptsByItem,[]);
    assert.deepEqual(store.weeklyActivity(other.id,'2024-02-27')[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:0,total:1}]);
    const markup=weeklyPpeMarkup(days);
    assert.match(markup,/<td>가상 안전모<\/td><td>9<\/td><td>1 \/ 3건<\/td>/);
    assert.match(markup,/<td>&lt;가상 장갑&gt;<\/td><td>1<\/td><td>0 \/ 1건<\/td>/);
    assert.doesNotMatch(markup,/<가상 장갑>/);
    assert.match(weeklyPpeMarkup(store.weeklyActivity(other.id,'2024-03-10')),/지급 기록이 없습니다/);
    const current=store.workerPpeIssues(site.id,worker.id).find(row=>row.id===signed);
    store.updatePpeIssue(signed,{siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'가상 안전모',quantity:'4',expectedVersion:current.version});
    assert.deepEqual(store.weeklyActivity(site.id,'2024-02-27')[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:0,total:2}]);
  }finally{store.close();}
});

test('주간 체크리스트는 날짜와 저장 종류별로 구분하고 미기록 및 자가점검을 분리한다',()=>{
 const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),make=(siteId,date,title,kind)=>store.createDocument({siteId,type:'checklist',date,title,...(kind?{details:{kind,answers:checklistQuestions[kind].map(()=>({answer:'O',note:''}))}}:{})});make(site.id,'2024-02-29','가상 하나','wind');make(site.id,'2024-02-29','가상 둘','wind');make(site.id,'2024-02-29','가상 셋','fire');make(site.id,'2024-02-29','이전 기록');make(other.id,'2024-02-29','다른 현장','wind');make(site.id,'2024-03-05','다음 주','wind');const rows=store.weeklyActivity(site.id,'2024-02-27'),day=rows[2];assert.equal(day.checklists.filter(x=>x.kind==='wind').length,2);assert.equal(day.checklists.filter(x=>!x.kind).length,1);const html=weeklyChecklistMarkup(rows);assert.match(html,/강풍 대비 점검 2건/);assert.match(html,/화재 예방 점검 1건/);assert.match(html,/종류 미기록 1건/);assert.doesNotMatch(html,/다른 현장|다음 주/);assert.equal((html.match(/강풍 대비 점검 2건/g)||[]).length,1);day.workerChecks=3;day.managerChecks=2;const withChecks=weeklyChecklistMarkup([day]);assert.match(withChecks,/출입자 자가점검 3건/);assert.match(withChecks,/관리자·직원 자가점검 2건/);const unknown=weeklyChecklistMarkup([{date:'<날짜>',checklists:[{kind:'<타입>'}]}]);assert.match(unknown,/&lt;날짜&gt;/);assert.match(unknown,/알 수 없는 종류 1건/);assert.doesNotMatch(unknown,/<타입>/);
 }finally{store.close();}
});

test('주간 활동은 종류별 날짜와 문서·시험 확인을 각각 표시한다',()=>{
 const days=[{date:'2024-02-29',documents:{notice:2,tbm:1,inspection:3},noticeReads:4,trainingByType:{tbm:2,education:0}},{date:'2024-03-01',documents:{education:1,patrol:2,incident:2,risk:3,instruction:4,work_plan:1,checklist:5},noticeReads:0,trainingByType:{tbm:0,education:3}},{date:'<날짜>',documents:{},noticeReads:0,trainingByType:{tbm:0,education:0}}],html=weeklyActivitySummaryMarkup(days),section=name=>html.split(`<h4>${name}</h4>`)[1].split('</section>')[0];
 assert.match(html,/<summary>활동별 날짜 내역 보기<\/summary>/);assert.match(section('공지'),/<td>2024-02-29<\/td><td>2<\/td><td>4<\/td>/);assert.match(section('TBM'),/<td>2024-02-29<\/td><td>1<\/td><td>2<\/td>/);assert.match(section('교육'),/<td>2024-03-01<\/td><td>1<\/td><td>3<\/td>/);assert.match(section('안전 점검'),/<td>2024-02-29<\/td><td>3<\/td>/);assert.doesNotMatch(section('안전 점검'),/시험 확인 건수/);assert.match(section('재해 보고서'),/<td>2024-03-01<\/td><td>2<\/td>/);assert.doesNotMatch(section('재해 보고서'),/시험 확인 건수/);for(const [label,count] of [['위험성평가',3],['작업계획서',1],['작업지시서',4],['체크리스트',5]])assert.ok(section(label).includes(`<td>2024-03-01</td><td>${count}</td>`),label);assert.match(html,/&lt;날짜&gt;/);assert.doesNotMatch(html,/<날짜>/);
});

test('하루 여러 문서를 확인한 같은 근로자는 종류별 인원에서 한 번만 센다',()=>{
 const s=new Store(':memory:');try{const a=s.createSite({name:'가상 현장'}),b=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:a.id,name:'가상',category:'직영',company:'가상',occupation:'가상'}),other=s.createWorker({siteId:b.id,name:'다른 가상',category:'직영',company:'가상',occupation:'가상'}),make=(siteId,type,date,status='approved')=>{const d=s.createDocument({siteId,type,date,title:'가상'});s.db.prepare('UPDATE documents SET status=? WHERE id=?').run(status,d.id);return d;},date='2024-02-29';
  const notices=[make(a.id,'notice',date),make(a.id,'notice',date),make(a.id,'notice',date,'draft')],educations=[make(a.id,'education',date),make(a.id,'education',date)],tbm=make(a.id,'tbm',date),foreign=make(b.id,'notice',date),later=make(a.id,'notice','2024-03-05');
  for(const d of [...notices,later])s.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id) VALUES(?,?)').run(worker.id,d.id);s.db.prepare('INSERT INTO worker_notice_reads(worker_id,document_id) VALUES(?,?)').run(other.id,foreign.id);for(const d of [...educations,tbm])s.db.prepare('INSERT INTO worker_training_checks(worker_id,document_id) VALUES(?,?)').run(worker.id,d.id);
  const days=s.weeklyActivity(a.id,'2024-02-27'),day=days[2];assert.equal(day.noticeReads,2);assert.equal(day.noticePeople,1);assert.equal(day.trainingByType.education,2);assert.equal(day.trainingPeopleByType.education,1);assert.equal(day.trainingPeopleByType.tbm,1);const html=weeklyActivitySummaryMarkup(days),section=name=>html.split(`<h4>${name}</h4>`)[1].split('</section>')[0];assert.match(section('공지'),/<td>2024-02-29<\/td><td>3<\/td><td>2<\/td><td>1<\/td>/);assert.match(section('교육'),/<td>2024-02-29<\/td><td>2<\/td><td>2<\/td><td>1<\/td>/);assert.match(html,/근로자/);assert.equal(days[0].noticePeople,0);assert.deepEqual(days[0].trainingPeopleByType,{tbm:0,education:0});const legacy=weeklyActivitySummaryMarkup([{date:'2024-01-01',documents:{},noticeReads:0,trainingByType:{tbm:0,education:0}}]);assert.match(legacy,/<td>2024-01-01<\/td><td>0<\/td><td>0<\/td><td>—<\/td>/);
 }finally{s.close();}
});
