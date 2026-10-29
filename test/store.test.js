import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PNG } from 'pngjs';

test('가상 노임 직종별 합계는 현장과 월, 기록 당시 직종으로 구분한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name,occupation)=>s.createWorker({siteId,name,category:'직영',company:'가상 회사',occupation}),one=add(a.id,'가상 1','목공'),two=add(a.id,'가상 2','목공'),other=add(b.id,'다른 현장','목공'),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'};
    for(const [siteId,worker,month] of [[a.id,one,'2024-02'],[a.id,two,'2024-02'],[b.id,other,'2024-02'],[a.id,one,'2024-03']])s.saveWageRecord({siteId,workerId:worker.id,month,gross:'1000',deductions});
    s.updateWorker(one.id,{siteId:a.id,name:'가상 1',category:'직영',company:'가상 회사',occupation:'전기'});
    assert.deepEqual(s.wageSummary(a.id,'2024-02'),[{occupation:'목공',count:2,gross:2000,deductions:376,net:1624}]);assert.equal(s.wageSummary(b.id,'2024-02')[0].count,1);assert.equal(s.wageSummary(a.id,'2024-03')[0].count,1);
  }finally{s.close();}
});

test('가상 노임은 현장과 월별로 수동 공제액을 검증하고 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),deductions={income:'100',local:'10',health:'20',care:'3',pension:'50',employment:'5'},input={siteId:a.id,workerId:worker.id,month:'2024-02',gross:'1000',deductions};
    s.saveWageRecord(input);const row=s.wageRecords(a.id,'2024-02')[0];assert.equal(row.total,188);assert.equal(row.net,812);assert.equal(s.wageRecords(b.id,'2024-02').length,0);assert.equal(s.wageRecords(a.id,'2024-03').length,0);
    assert.throws(()=>s.saveWageRecord({...input,siteId:b.id}),/현장/);assert.throws(()=>s.saveWageRecord({...input,gross:'100'}),/공제액/);assert.throws(()=>s.saveWageRecord({...input,deductions:{...deductions,income:'-1'}}),/금액/);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,1000);
    assert.throws(()=>s.saveWageRecord({...input,gross:'2000'}),/이미 등록/);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,1000);s.saveWageRecord({...input,gross:'2000'},true);assert.equal(s.wageRecords(a.id,'2024-02')[0].gross,2000);assert.throws(()=>s.saveWageRecord({...input,month:'2024-03'},true),/찾을 수 없/);
    s.updateWorker(worker.id,{siteId:a.id,name:'변경 이름',category:'외주',company:'변경 회사',occupation:'전기'});s.saveWageRecord({...input,gross:'3000'},true);const saved=s.wageRecords(a.id,'2024-02')[0];assert.equal(saved.name,'가상 근로자');assert.equal(saved.company,'가상 회사');assert.equal(saved.occupation,'목공');s.db.prepare('UPDATE wage_records SET name_snapshot=NULL,company_snapshot=NULL,occupation_snapshot=NULL').run();assert.equal(s.wageRecords(a.id,'2024-02')[0].company,'기록 없음');
  }finally{s.close();}
});

test('시험 노임은 조회 시점의 해당 근로자 출역과 공수를 별도로 표시한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=add(a.id,'가상 근로자'),other=add(b.id,'다른 근로자'),deductions={income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'};s.saveWageRecord({siteId:a.id,workerId:one.id,month:'2024-02',gross:'1000',deductions});
    const record=()=>s.wageRecords(a.id,'2024-02')[0];assert.equal(record().attendance_days,0);assert.equal(record().units_hundredths,null);assert.equal(record().units_missing,0);
    for(const [siteId,worker,date] of [[a.id,one,'2024-02-01'],[a.id,one,'2024-02-02'],[a.id,one,'2024-03-01'],[b.id,other,'2024-02-01']])s.setAttendance({siteId,workerId:worker.id,date,present:true});s.setAttendanceUnits({siteId:a.id,workerId:one.id,date:'2024-02-01',units:'1.25'});s.setAttendanceUnits({siteId:b.id,workerId:other.id,date:'2024-02-01',units:'9'});
    assert.equal(record().attendance_days,2);assert.equal(record().units_hundredths,125);assert.equal(record().units_missing,1);assert.equal(record().gross,1000);assert.equal(record().net,1000);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-02-01',present:false});assert.equal(record().attendance_days,1);assert.equal(record().units_hundredths,null);assert.equal(record().units_missing,1);assert.equal(record().gross,1000);
  }finally{s.close();}
});

test('식대 시험 기록은 출역과 현장을 검증하고 기록 단가를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:a.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:a.id,workerId:worker.id,date:'2024-02-29',kind:'lunch',restaurantId:restaurant.id};
    assert.throws(()=>s.saveMealCheck(input),/출역자/);s.setAttendance({siteId:a.id,workerId:worker.id,date:input.date,present:true});s.saveMealCheck(input);
    assert.throws(()=>s.saveMealCheck({...input,siteId:b.id}),/출역자/);assert.throws(()=>s.saveMealCheck({...input,kind:'invalid'}),/종류/);
    s.saveRestaurant({siteId:a.id,name:'수정 식당',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);const row=s.mealChecks(a.id,input.date)[0];assert.equal(row.price,5000);assert.equal(row.restaurant_name,'가상 식당');
    assert.equal(s.monthlyMealChecks(a.id,'2024-02')[0].total,5000);assert.equal(s.monthlyMealChecks(a.id,'2024-02')[0].count,1);assert.equal(s.monthlyMealChecks(b.id,'2024-02').length,0);assert.equal(s.monthlyMealChecks(a.id,'2024-03').length,0);assert.throws(()=>s.monthlyMealChecks(a.id,'2024-13'),/월/);
    assert.throws(()=>s.deleteMealCheck(b.id,row.id),/현장/);s.deleteMealCheck(a.id,row.id);assert.equal(s.mealChecks(a.id,input.date).length,0);
  }finally{s.close();}
});

test('조식 시험 기록은 출역을 검증하고 식사 단가를 월 합계에 포함한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:site.id,workerId:worker.id,date:'2024-02-29',kind:'breakfast',restaurantId:restaurant.id};
    assert.throws(()=>s.saveMealCheck(input),/출역자/);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:input.date,present:true});s.saveMealCheck(input);
    assert.equal(s.mealChecks(site.id,input.date)[0].kind,'breakfast');assert.equal(s.mealChecks(site.id,input.date)[0].price,5000);assert.equal(s.monthlyMealChecks(site.id,'2024-02')[0].total,5000);
  }finally{s.close();}
});

test('근로자별 월간 식대는 현장과 월을 제한하고 과거 단가를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),day='2024-02-29';
    s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});s.saveMealCheck({siteId:site.id,workerId:worker.id,date:day,kind:'breakfast',restaurantId:restaurant.id});
    s.saveRestaurant({siteId:site.id,name:'다른 이름',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:false});
    const rows=s.workerMonthlyMealChecks(site.id,worker.id,'2024-02');assert.equal(rows.length,1);assert.equal(rows[0].date,day);assert.equal(rows[0].restaurant_name,'가상 식당');assert.equal(rows[0].price,5000);
    assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-03'),[]);assert.throws(()=>s.workerMonthlyMealChecks(other.id,worker.id,'2024-02'),/현장/);assert.throws(()=>s.workerMonthlyMealChecks(site.id,worker.id,'2024-13'),/월/);
  }finally{s.close();}
});

test('월간 식대 일괄 변경은 출역일만 대상으로 기존 단가와 다른 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),input={siteId:site.id,workerId:worker.id,month:'2024-02',kind:'lunch',present:true,restaurantId:restaurant.id};
    for(const date of ['2024-02-01','2024-02-02','2024-03-01'])s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});
    s.saveMealCheck({siteId:site.id,workerId:worker.id,date:'2024-02-01',kind:'lunch',restaurantId:restaurant.id});s.saveRestaurant({siteId:site.id,name:'변경 식당',mealPrice:'7000',snackPrice:'2000',tax:'0'},restaurant.id);
    assert.equal(s.setWorkerMonthlyMeals(input),1);assert.equal(s.setWorkerMonthlyMeals(input),0);assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-02').map(x=>x.price),[5000,7000]);
    assert.throws(()=>s.setWorkerMonthlyMeals({...input,siteId:other.id}),/현장/);assert.throws(()=>s.setWorkerMonthlyMeals({...input,restaurantId:999}),/식당/);assert.throws(()=>s.setWorkerMonthlyMeals({...input,present:'true'}),/선택/);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-01',present:false});assert.equal(s.setWorkerMonthlyMeals({...input,present:false}),1);assert.deepEqual(s.workerMonthlyMealChecks(site.id,worker.id,'2024-02').map(x=>x.date),['2024-02-01']);
    assert.equal(s.workerMonthlyMealChecks(site.id,worker.id,'2024-03').length,0);
  }finally{s.close();}
});

test('월간 식대 명세서는 현장과 월을 제한하고 기록 단가별 수량을 집계한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'});
    for(const date of ['2024-02-01','2024-02-02','2024-03-01']){if(date==='2024-02-02')s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'7000',snackPrice:'1000',tax:'0'},restaurant.id);s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});s.saveMealCheck({siteId:site.id,workerId:worker.id,date,kind:'lunch',restaurantId:restaurant.id});}
    const report=s.mealStatement(site.id,'2024-02');assert.equal(report.site.name,'가상 현장');assert.equal(report.rows.length,2);assert.deepEqual(report.groups.map(g=>[g.price,g.quantity,g.total]),[[5000,1,5000],[7000,1,7000]]);assert.deepEqual(s.mealStatement(other.id,'2024-02').rows,[]);assert.equal(s.mealStatement(site.id,'2024-03').rows.length,1);assert.throws(()=>s.mealStatement(site.id,'2024-13'),/월/);assert.throws(()=>s.mealStatement(999,'2024-02'),/현장/);
  }finally{s.close();}
});

test('직영 출역의 자동 식대는 현장별 설정을 적용하고 기존 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 직영',category:'직영',company:'가상 회사',occupation:'목공'}),external=s.createWorker({siteId:site.id,name:'가상 외주',category:'외주',company:'가상 회사',occupation:'목공'}),meal=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'}),snack=s.saveRestaurant({siteId:site.id,name:'가상 매점',mealPrice:'4000',snackPrice:'2000',tax:'0'}),config=[{kind:'lunch',restaurantId:meal.id},{kind:'snack',restaurantId:snack.id}];
    s.saveMealDefaults(site.id,config);assert.equal(s.mealDefaults(other.id).length,0);assert.throws(()=>s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:999}]),/식당/);assert.throws(()=>s.saveMealDefaults(site.id,[config[0],config[0]]),/설정/);assert.equal(s.mealDefaults(site.id).length,2);
    const day='2024-02-29';s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});let rows=s.mealChecks(site.id,day);assert.deepEqual(rows.map(r=>r.price),[5000,2000]);
    s.setAttendance({siteId:site.id,workerId:external.id,date:day,present:true});assert.equal(s.mealChecks(site.id,day).length,2);
    s.deleteMealCheck(site.id,rows[0].id);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});s.recordWorkerLogin(worker.id,day);assert.equal(s.mealChecks(site.id,day).length,1);
    s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:false});assert.equal(s.mealChecks(site.id,day).length,1);s.setAttendance({siteId:site.id,workerId:worker.id,date:day,present:true});assert.equal(s.mealChecks(site.id,day).length,2);
    s.recordWorkerLogin(worker.id,'2024-03-01');assert.equal(s.mealChecks(site.id,'2024-03-01').length,2);s.saveMealDefaults(site.id,[]);s.recordWorkerLogin(worker.id,'2024-03-02');assert.equal(s.mealChecks(site.id,'2024-03-02').length,0);
  }finally{s.close();}
});

test('자동 식대 설정과 기록은 데이터베이스를 다시 열어도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-meal-')),path=join(dir,'test.sqlite');try{
    let s=new Store(path),site,worker;try{site=s.createSite({name:'가상 현장'});worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});const restaurant=s.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'});s.saveMealDefaults(site.id,[{kind:'lunch',restaurantId:restaurant.id}]);}finally{s.close();}
    s=new Store(path);try{s.recordWorkerLogin(worker.id,'2024-02-29');assert.equal(s.mealChecks(site.id,'2024-02-29')[0].price,5000);}finally{s.close();}
    s=new Store(path);try{assert.equal(s.mealDefaults(site.id)[0].kind,'lunch');assert.equal(s.mealChecks(site.id,'2024-02-29').length,1);}finally{s.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('보호구 시험 지급은 현장·월별로 집계하고 기록 당시 출입자 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),input={siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'안전모',quantity:'2'};
    s.addPpeIssue(input);s.addPpeIssue({...input,quantity:'1'});s.addPpeIssue({...input,date:'2024-03-01',item:'안전화'});s.updateWorker(worker.id,{siteId:site.id,name:'변경 이름',category:'외주',company:'변경 회사',occupation:'전기'});
    const report=s.ppeIssues(site.id,'2024-02');assert.equal(report.rows.length,2);assert.deepEqual(report.totals.map(r=>[r.item,r.quantity]),[['안전모',3]]);assert.equal(report.rows[0].worker.name,'가상 근로자');assert.equal(report.rows[0].worker.company,'가상 회사');
    assert.equal(s.workerPpeIssues(site.id,worker.id).length,3);assert.throws(()=>s.workerPpeIssues(other.id,worker.id),/현장/);
    assert.equal(s.ppeIssues(other.id,'2024-02').rows.length,0);assert.equal(s.ppeIssues(site.id,'2024-03').rows.length,1);assert.throws(()=>s.addPpeIssue({...input,siteId:other.id}),/현장/);for(const quantity of ['0','-1','1.2',true,'10001'])assert.throws(()=>s.addPpeIssue({...input,quantity}),/수량/);assert.throws(()=>s.ppeIssues(site.id,'2024-13'),/월/);
  }finally{s.close();}
});

test('출입자 시험 서류는 현장과 출입자별로 분리하고 첨부를 검증한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),bytes=Buffer.from('가상 문서');
    const id=s.addWorkerFile(site.id,worker.id,'training','시험.txt',bytes);assert.equal(s.workerFiles(site.id,worker.id)[0].category,'training');assert.deepEqual(Buffer.from(s.workerFile(site.id,worker.id,id).data),bytes);
    assert.throws(()=>s.workerFiles(other.id,worker.id),/현장/);assert.equal(s.workerFile(other.id,worker.id,id),null);assert.throws(()=>s.deleteWorkerFile(other.id,worker.id,id),/첨부/);
    assert.throws(()=>s.addWorkerFile(site.id,worker.id,'invalid','시험.txt',bytes),/종류/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','../x',bytes),/이름/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','시험.txt',Buffer.alloc(0)),/파일/);assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','시험.txt',Buffer.alloc(2*1024*1024+1)),/파일/);
    assert.throws(()=>s.addWorkerFile(site.id,worker.id,'other','x\\y',bytes),/이름/);
    s.deleteWorkerFile(site.id,worker.id,id);assert.equal(s.workerFiles(site.id,worker.id).length,0);
  }finally{s.close();}
});

test('식당 시험 설정은 현장별로 저장하며 잘못된 수정을 거절한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={siteId:a.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'600'},restaurant=s.saveRestaurant(input);
    assert.equal(s.restaurants(a.id)[0].meal_price,5000);assert.equal(s.restaurants(b.id).length,0);
    assert.throws(()=>s.saveRestaurant({...input,siteId:b.id},restaurant.id),/현장/);assert.throws(()=>s.saveRestaurant({...input,mealPrice:'-1'},restaurant.id),/식비/);
    assert.equal(s.restaurants(a.id)[0].meal_price,5000);assert.equal(s.saveRestaurant({...input,name:'수정 식당'},restaurant.id).name,'수정 식당');
  }finally{s.close();}
});

test('주간 활동은 7일과 현장을 제한하고 문서·가상 확인을 날짜별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:a.id,workerId:worker.id,date:'2024-02-29',present:true});const add=(siteId,date,type)=>s.createDocument({siteId,date,type,title:'가상 문서'}),notice=add(a.id,'2024-02-29','notice'),tbm=add(a.id,'2024-03-01','tbm');add(b.id,'2024-02-29','notice');for(const doc of [notice,tbm]){s.transition(doc.id,'submit');s.transition(doc.id,'approve');}const png=new PNG({width:1,height:1});png.data[3]=255;s.confirmWorkerNotice(worker.id,notice.id,`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`);s.confirmWorkerTraining(worker.id,tbm.id,'2024-03-01',true);const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows.length,7);assert.equal(rows[6].date,'2024-03-04');const leap=rows.find(r=>r.date==='2024-02-29');assert.equal(leap.attendance,1);assert.equal(leap.documents.notice,1);assert.equal(leap.noticeReads,1);assert.equal(rows.find(r=>r.date==='2024-03-01').trainingChecks,1);assert.equal(s.weeklyActivity(b.id,'2024-02-27').find(r=>r.date==='2024-02-29').noticeReads,0);assert.throws(()=>s.weeklyActivity(a.id,'2024-02-30'),/날짜/);}finally{s.close();}
});

test('주간 출역은 기록 당시 구분과 직종별 인일을 나눈다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-29',present:true});
    s.updateWorker(worker.id,{siteId:site.id,name:'가상 근로자',category:'외주',company:'가상 회사',occupation:'전기'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-03-01',present:true});
    const rows=s.weeklyActivity(site.id,'2024-02-27');assert.deepEqual(rows[2].attendanceCategories,[{label:'직영',days:1}]);assert.deepEqual(rows[2].attendanceOccupations,[{label:'목공',days:1}]);assert.deepEqual(rows[3].attendanceCategories,[{label:'외주',days:1}]);assert.deepEqual(rows[3].attendanceOccupations,[{label:'전기',days:1}]);
    for(const [group,key] of [['category','attendanceCategories'],['occupation','attendanceOccupations']]){const totals=new Map();for(const row of rows)for(const item of row[key])totals.set(item.label,(totals.get(item.label)||0)+item.days);assert.deepEqual(s.attendanceReport(site.id,rows[0].date,rows.at(-1).date,group).map(item=>[item.label,item.days]).sort(),[...totals].sort());}
    s.db.prepare("UPDATE attendance SET category_snapshot=NULL,occupation_snapshot=NULL WHERE date='2024-02-29'").run();assert.equal(s.weeklyActivity(site.id,'2024-02-27')[2].attendanceCategories[0].label,'기록 없음');
  }finally{s.close();}
});

test('주간 위험 신고 건수는 현장과 현지 날짜로 제한된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={title:'가상 위험',body:'가상 내용',reporter:'가상 신고자'};
    const one=s.createHazardReport(a.id,input),other=s.createHazardReport(b.id,input),outside=s.createHazardReport(a.id,input);
    const set=s.db.prepare("UPDATE hazard_reports SET created_at=datetime(?,'utc') WHERE id=?");
    set.run('2024-02-29 12:00:00',one);set.run('2024-02-29 12:00:00',other);set.run('2024-03-06 12:00:00',outside);
    const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows[2].hazardReports,1);assert.equal(rows.reduce((sum,row)=>sum+row.hazardReports,0),1);assert.equal(s.weeklyActivity(b.id,'2024-02-27')[2].hazardReports,1);
  }finally{s.close();}
});

test('주간 활동은 TBM과 교육의 승인 문서별 확인을 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    for(const type of ['tbm','education']){const d=s.createDocument({siteId:site.id,date:'2024-02-29',type,title:'가상 교육'});s.transition(d.id,'submit');s.transition(d.id,'approve');s.confirmWorkerTraining(worker.id,d.id,'2024-02-29',true);}
    const day=s.weeklyActivity(site.id,'2024-02-27')[2];assert.deepEqual(day.trainingByType,{tbm:1,education:1});assert.equal(day.trainingChecks,2);assert.deepEqual(s.weeklyActivity(site.id,'2024-03-01')[0].trainingByType,{tbm:0,education:0});
  }finally{s.close();}
});

test('주간 활동의 자가점검은 현장과 날짜별로 분리된다',()=>{
  const s=new Store(':memory:');
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    s.createWorkerSelfCheck(worker.id,'2024-02-29',{equipment:true,sober:true,exercise:true,briefing:true},signature);
    s.saveManagerCheck(a.id,'2024-02-29',Array.from({length:3},()=>({answer:'O',note:''})),signature);
    s.saveManagerCheck(b.id,'2024-02-29',Array.from({length:3},()=>({answer:'O',note:''})),signature);
    const rows=s.weeklyActivity(a.id,'2024-02-27');assert.equal(rows[2].workerChecks,1);assert.equal(rows[2].managerChecks,1);assert.equal(rows[1].workerChecks,0);assert.equal(s.weeklyActivity(b.id,'2024-02-27')[2].workerChecks,0);
  }finally{s.close();}
});

test('교육 통계는 확인된 승인 문서만 현장·기간·근로자·종류별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),other=s.createWorker({siteId:b.id,name:'다른 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),add=(siteId,date,kind)=>s.createDocument({siteId,type:'education',title:'가상 교육',date,details:{kind}});for(const [siteId,w,date,kind] of [[a.id,worker,'2026-10-28','regular'],[a.id,worker,'2026-10-29','regular'],[a.id,worker,'2026-10-29','special'],[b.id,other,'2026-10-29','regular']]){const d=add(siteId,date,kind);s.transition(d.id,'submit');s.transition(d.id,'approve');s.confirmWorkerTraining(w.id,d.id,date,true);}add(a.id,'2026-10-29','regular');s.confirmDailyTraining(worker.id,'2026-10-29',['education'],true);const rows=s.educationReport(a.id,'2026-10-01','2026-10-31');assert.deepEqual(rows.map(r=>[r.kind,r.count]),[['regular',2],['special',1]]);assert.deepEqual(rows[0].documents.map(d=>d.date).sort(),['2026-10-28','2026-10-29']);assert.equal(s.educationReport(a.id,'2026-10-29','2026-10-29').find(r=>r.kind==='regular').count,1);assert.throws(()=>s.educationReport(a.id,'2026-11-01','2026-10-01'),/시작일/);}finally{s.close();}
});

test('체크리스트 첨부가 변경되면 해당 문서의 시험 서명만 삭제한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29'},doc=s.createDocument(input),other=s.createDocument(input),png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;s.saveChecklistSignature(doc.id,signature);s.saveChecklistSignature(other.id,signature);assert.throws(()=>s.addAttachment(doc.id,'../잘못된 파일',Buffer.from('가상')),/이름/);assert.ok(s.checklistSignature(doc.id));const id=s.addAttachment(doc.id,'가상.txt',Buffer.from('가상'));assert.equal(s.checklistSignature(doc.id),null);assert.ok(s.checklistSignature(other.id));s.saveChecklistSignature(doc.id,signature);s.deleteAttachment(id);assert.equal(s.checklistSignature(doc.id),null);assert.ok(s.checklistSignature(other.id));}finally{s.close();}
});

test('체크리스트 시험 서명은 문서별로 저장되고 내용 수정 시 지워진다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29',details:{kind:'rain',answers:Array.from({length:7},()=>({answer:'O',note:''}))}},doc=s.createDocument(input),other=s.createDocument({...input,type:'tbm'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;assert.throws(()=>s.saveChecklistSignature(other.id,signature),/체크리스트/);assert.throws(()=>s.saveChecklistSignature(doc.id,'invalid'),/서명/);s.saveChecklistSignature(doc.id,signature);assert.deepEqual(Buffer.from(s.checklistSignature(doc.id).signature),bytes);s.updateDocument(doc.id,{...input,title:'수정된 점검'});assert.equal(s.checklistSignature(doc.id),null);s.saveChecklistSignature(doc.id,signature);s.transition(doc.id,'submit');assert.throws(()=>s.saveChecklistSignature(doc.id,signature),/체크리스트/);}finally{s.close();}
});

test('13시와 18시 시험 점검은 필수 답변과 해당없음 범위를 검증한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'});for(const [kind,length,required,na] of [['afternoon',7,6,4],['evening',10,9,4]]){const answers=Array.from({length},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2026-10-29',details:{kind,answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);for(let i=0;i<required;i++)answers[i].answer=kind==='afternoon'&&i===0?'가상 인원':'O';answers[na].answer='해당없음';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');} }finally{s.close();}
});

test('07시 시험 체크리스트는 필수 인원과 선택 항목을 확인한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 일일 점검',date:'2026-10-29',details:{kind:'morning',answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);for(const i of [1,2,3,4,6])answers[i].answer='O';answers[0].answer='가상 공정 3명';answers[7].answer='가상 조치';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.equal(JSON.parse(s.document(doc.id).details).answers[7].answer,'가상 조치');}finally{s.close();}
});

test('07시 점검 사진은 해당 항목에 연결되고 점검 종류 변경을 보호한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'',note:''})),input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2041-01-01',details:{kind:'morning',answers}},doc=s.createDocument(input),other=s.createDocument({...input,details:{kind:'rain',answers:answers.slice(0,7)}}),image=new PNG({width:1,height:1});image.data[3]=255;const bytes=PNG.sync.write(image);
    assert.throws(()=>s.addAttachment(other.id,'사진.png',bytes,'morning_hazard_photo'),/첨부 구분/);assert.throws(()=>s.addAttachment(doc.id,'사진.png',Buffer.from('bad'),'morning_hazard_photo'),/PNG/);
    const file=s.addAttachment(doc.id,'가상.png',bytes,'morning_hazard_photo');assert.equal(s.attachments(doc.id)[0].category,'morning_hazard_photo');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'rain',answers:answers.slice(0,7)}}),/사진/);assert.equal(JSON.parse(s.document(doc.id).details).kind,'morning');assert.deepEqual(Buffer.from(s.attachment(file).data),bytes);
    for(const i of [1,2,3,4,6])answers[i].answer='O';answers[0].answer='가상 공정';s.updateDocument(doc.id,input);s.transition(doc.id,'submit');assert.throws(()=>s.deleteAttachment(file),/첨부파일/);assert.equal(s.attachments(doc.id)[0].category,'morning_hazard_photo');
  }finally{s.close();}
});

test('우천시 시험 체크리스트는 필수 답변을 확인하고 이전 기록을 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:7},(_,i)=>({answer:i===0?'':'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 우천 점검',date:'2026-10-29',details:{kind:'rain',answers}};const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'rain',answers:answers.map((a,i)=>i===1?{...a,answer:'해당없음'}:a)}}),/답변/);answers[0].answer='X';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.equal(JSON.parse(s.document(doc.id).details).answers[0].answer,'X');}finally{s.close();}
});

test('강풍 대비 시험 점검은 아홉 판정과 첨부를 저장하고 제출 전 답변을 확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:9},()=>({answer:'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 기상 점검',date:'2026-10-29',details:{kind:'wind',answers}};
    answers[8].answer='';const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'wind',answers:answers.slice(0,8)}}),/문항/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'wind',answers:answers.map((a,i)=>i===0?{...a,answer:'알 수 없음'}:a)}}),/답변/);
    answers[0]={answer:'해당없음',note:' 가상 비고 '};answers[8].answer='X';s.updateDocument(doc.id,input);s.addAttachment(doc.id,'가상 사진.txt',Buffer.from('가상 첨부'));
    assert.equal(JSON.parse(s.document(doc.id).details).answers[0].note,'가상 비고');assert.equal(s.attachments(doc.id).length,1);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.throws(()=>s.updateDocument(doc.id,input),/수정/);
  }finally{s.close();}
});

test('계절별 시험 점검은 문항과 선택지를 검증하고 모든 답변을 요구한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    for(const [kind,length] of [['thaw',15],['heat',8],['cold',10]]){
      const answers=Array.from({length},()=>({answer:'O',note:''})),input={siteId:site.id,type:'checklist',title:'가상 계절 점검',date:'2041-01-01',details:{kind,answers}};
      answers[length-1].answer='';const doc=s.createDocument(input);assert.throws(()=>s.transition(doc.id,'submit'),/필수/);
      assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.slice(1)}}),/문항/);
      if(kind==='heat')for(const i of [0,1,3,4])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.map((a,j)=>j===i?{...a,answer:'해당없음'}:a)}}),/답변/);
      for(const i of kind==='heat'?[2,5,6,7]:[0,length-1])answers[i].answer='해당없음';
      s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.deepEqual(JSON.parse(s.document(doc.id).details).answers,answers);
    }
  }finally{s.close();}
});

test('기상·전기·화재 시험 점검은 문항 수와 판정 및 제출 조건을 확인한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'});
    for(const [kind,length] of [['wet_season',6],['heavy_rain',11],['electrical',12],['fire',5],['formwork',7],['falling',8],['confined',4],['excavation',8]]){
      const answers=Array.from({length},()=>({answer:'해당없음',note:'가상 비고'}));if(kind==='heavy_rain')answers[0].answer='O';answers[length-1].answer='';
      const input={siteId:site.id,type:'checklist',title:'가상 점검',date:'2041-01-01',details:{kind,answers}},doc=s.createDocument(input);
      assert.throws(()=>s.transition(doc.id,'submit'),/필수/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.slice(1)}}),/문항/);
      if(kind==='heavy_rain')assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind,answers:answers.map((a,i)=>i===0?{...a,answer:'해당없음'}:a)}}),/답변/);
      answers[length-1].answer='X';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');assert.deepEqual(JSON.parse(s.document(doc.id).details).answers,answers);
    }
  }finally{s.close();}
});

test('반기 시험 점검은 기본 정보와 일곱 판정 및 개선 내용을 검증한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),answers=Array.from({length:11},(_,i)=>({answer:[0,1,2,10].includes(i)?'가상 내용':'예',note:' 가상 비고 '})),input={siteId:site.id,type:'checklist',title:'가상 반기 점검',date:'2041-01-01',details:{kind:'semiannual',answers}},doc=s.createDocument(input);
    for(let i=0;i<11;i++){const changed=answers.map((a,j)=>j===i?{...a,answer:''}:a);s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:changed}});assert.throws(()=>s.transition(doc.id,'submit'),/필수/);}
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:answers.slice(1)}}),/문항/);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'semiannual',answers:answers.map((a,i)=>i===3?{...a,answer:'O'}:a)}}),/답변/);
    answers[3].answer='아니오';s.updateDocument(doc.id,input);assert.equal(s.transition(doc.id,'submit').status,'pending');const saved=JSON.parse(s.document(doc.id).details);assert.equal(saved.answers[3].answer,'아니오');assert.equal(saved.answers[0].note,'가상 비고');
  }finally{s.close();}
});

test('기본 서류 분류를 현장별로 저장하고 검색한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 현장 A'}),b=s.createSite({name:'가상 현장 B'}),input={siteId:a.id,type:'basic',title:'가상 서류',date:'2026-10-29',details:{category:'안전·보건 조직도'}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).category,'안전·보건 조직도');assert.equal(s.documents(a.id,'basic','조직도').length,1);assert.equal(s.documents(b.id,'basic','조직도').length,0);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{category:'가'.repeat(201)}}),/분류/);assert.equal(JSON.parse(s.document(doc.id).details).category,'안전·보건 조직도');}finally{s.close();}
});

test('안전 업무 일지 출역 수는 저장 시점에 보존되고 날짜 변경 시 다시 계산한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});const input={siteId:site.id,type:'safety_log',title:'가상 일지',date:'2026-10-29',details:{attendanceSnapshot:{present:999}}};const doc=s.createDocument(input),snapshot=JSON.parse(doc.details).attendanceSnapshot;assert.equal(snapshot.present,1);s.setAttendance({siteId:site.id,workerId:worker.id,date:input.date,present:false});assert.deepEqual(JSON.parse(s.updateDocument(doc.id,input).details).attendanceSnapshot,snapshot);assert.equal(JSON.parse(s.updateDocument(doc.id,{...input,date:'2026-10-30'}).details).attendanceSnapshot.present,0);}finally{s.close();}
});

test('안전 업무 일지는 현장과 날짜에 맞는 가상 자료를 조회한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-29',present:true});for(const [siteId,date,type] of [[a.id,'2026-10-29','notice'],[a.id,'2026-10-28','tbm'],[b.id,'2026-10-29','patrol']])s.createDocument({siteId,date,type,title:'가상 문서'});const sources=s.safetyLogSources(a.id,'2026-10-29');assert.equal(sources.present,1);assert.deepEqual(sources.documents.map(d=>d.type),['notice']);const input={siteId:a.id,type:'safety_log',date:'2026-10-29',title:'시험 일지',details:{todayWork:'가상 작업',inspectionKind:'장비점검'}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).todayWork,'가상 작업');assert.throws(()=>s.updateDocument(doc.id,{...input,details:{inspectionKind:'알 수 없음'}}),/종류/);assert.equal(JSON.parse(s.document(doc.id).details).inspectionKind,'장비점검');}finally{s.close();}
});

test('순회 점검 판정과 개선 지시를 저장하고 잘못된 판정을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-10-29',details:{instruction:'가상 지시',items:[{name:'가상 항목',result:'X',note:'가상 개선'}]}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).items[0].note,'가상 개선');assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{...input.details.items[0],result:'미확인'}]}}),/순회 점검/);assert.equal(JSON.parse(s.document(doc.id).details).items[0].result,'X');}finally{s.close();}
});

test('안전 점검 일지는 복수 점검과 활동을 보존하고 잘못된 시간을 거절한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'inspection',title:'시험 점검',date:'2026-10-29',details:{meeting:'가상 회의',instruction:'가상 지시',rows:[{inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'가상 상태',action:'가상 조치'},{inspector:'다른 점검자',hazard:'가상 상태 2'}]}};const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).rows.length,2);assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,rows:[{...input.details.rows[0],timeTo:'09:03'}]}}),/점검시간/);assert.equal(JSON.parse(s.document(doc.id).details).instruction,'가상 지시');}finally{s.close();}
});

test('합동 안전점검은 판정과 출역자를 검증하고 잘못된 수정을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});
    const input={siteId:site.id,type:'joint_inspection',title:'가상 점검',date:'2026-10-29',details:{improvements:'가상 보완',result:'가상 조치',workerIds:[worker.id],items:[{name:'가상 항목',result:'보완사항'}]}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).items[0].result,'보완사항');
    assert.equal(s.previousJointInspection(site.id,'2026-10-30').date,'2026-10-29');assert.equal(s.previousJointInspection(site.id,'2026-10-29'),null);assert.equal(s.previousJointInspection(s.createSite({name:'다른 현장'}).id,'2026-10-30'),null);assert.throws(()=>s.previousJointInspection(site.id,'2026-02-30'),/날짜/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,items:[{name:'가상 항목',result:'미확인'}]}}),/점검 항목/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,date:'2026-10-30'}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).workerSnapshot[0].id,worker.id);
  }finally{s.close();}
});

test('노사협의체 회의 안건과 출역자를 현장별로 저장한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'}),foreign=s.createWorker({siteId:other.id,name:'다른 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-29',present:true});
    const input={siteId:site.id,type:'work_council',title:'가상 주제',date:'2026-10-29',details:{kind:'정기 회의',host:'가상 주관',decisions:'가상 의결',discussion:'가상 협의',workerIds:[worker.id],timeFrom:'09:00',timeTo:'10:00'}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).decisions,'가상 의결');assert.equal(JSON.parse(doc.details).workerSnapshot[0].id,worker.id);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,kind:'알 수 없음'}}),/종류/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,workerIds:[foreign.id]}}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).discussion,'가상 협의');
  }finally{s.close();}
});

test('안전간담회는 해당 날짜의 출역자를 선택하고 기존 참석자 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),input={siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'};
    const worker=s.createWorker(input),foreign=s.createWorker({...input,siteId:other.id});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-28',present:true});
    const meeting={siteId:site.id,type:'safety_meeting',title:'가상 회의',date:'2026-10-28',details:{place:'가상 장소',timeFrom:'23:55',timeTo:'24:00',workerIds:[worker.id]}};
    const doc=s.createDocument(meeting);assert.equal(JSON.parse(doc.details).workerSnapshot[0].name,'가상 근로자');
    assert.throws(()=>s.createDocument({...meeting,details:{...meeting.details,workerIds:[foreign.id]}}),/출역자/);
    assert.throws(()=>s.createDocument({...meeting,details:{...meeting.details,timeFrom:'23:56'}}),/회의시간/);
    s.updateWorker(worker.id,{...input,name:'수정된 이름'});s.setAttendance({siteId:site.id,workerId:worker.id,date:meeting.date,present:false});
    assert.equal(JSON.parse(s.updateDocument(doc.id,meeting).details).workerSnapshot[0].name,'가상 근로자');
    assert.throws(()=>s.updateDocument(doc.id,{...meeting,date:'2026-10-29'}),/출역자/);
    assert.equal(JSON.parse(s.document(doc.id).details).workerSnapshot[0].name,'가상 근로자');
  }finally{s.close();}
});

test('장비는 선택한 현장에 저장되고 다른 현장에 표시되지 않는다',()=>{
  const s=new Store(':memory:');
  try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const item=s.createEquipment({siteId:a.id,kind:'굴착기',model:'가상 모델',capacity:'가상 용량',manufacturer:'가상 제조사',registration:'가상 번호'});
    assert.equal(s.equipment(a.id)[0].id,item.id);assert.deepEqual(s.equipment(b.id),[]);
    const bytes=Buffer.from('가상 증빙'),file=s.addEquipmentAttachment(a.id,item.id,'insurance','가상.txt',bytes);
    assert.equal(s.equipmentAttachments(a.id,item.id)[0].category,'insurance');assert.deepEqual(Buffer.from(s.equipmentAttachment(a.id,item.id,file).data),bytes);
    assert.equal(s.equipmentAttachment(b.id,item.id,file),null);assert.throws(()=>s.addEquipmentAttachment(b.id,item.id,'insurance','가상.txt',bytes),/현장/);
    assert.throws(()=>s.addEquipmentAttachment(a.id,item.id,'bad','가상.txt',bytes),/종류/);assert.throws(()=>s.addEquipmentAttachment(a.id,item.id,'other','../가상.txt',bytes),/이름/);
    s.deleteEquipmentAttachment(a.id,item.id,file);assert.equal(s.equipmentAttachments(a.id,item.id).length,0);
    const input={siteId:a.id,kind:'굴착기',model:'가상 모델',capacity:'가상',manufacturer:'가상',registration:'가상',owner:'가상 소유주',insuranceFrom:'2026-01-01',insuranceTo:'2026-12-31',inspectionFrom:'2026-02-01',inspectionTo:'2026-08-01'};
    assert.equal(JSON.parse(s.updateEquipment(item.id,input).details).owner,'가상 소유주');
    assert.throws(()=>s.updateEquipment(item.id,{...input,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateEquipment(item.id,{...input,insuranceTo:'2025-01-01'}),/기간/);
    assert.equal(JSON.parse(s.equipment(a.id)[0].details).insuranceTo,'2026-12-31');
    assert.throws(()=>s.createEquipment({siteId:999,kind:'굴착기',model:'모델',capacity:'',manufacturer:'',registration:''}),/현장/);
    assert.throws(()=>s.createEquipment({siteId:a.id,kind:'',model:'모델',capacity:'',manufacturer:'',registration:''}),/장비/);
  }finally{s.close();}
});

test('작업장소의 현장과 지형을 검증하고 같은 현장 계획서에 연결한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),area={terrain:'평지',ground:'보통',drainage:'양호',reinforcement:'가상 보강',obstacles:'',protection:'가상 보호'};
    const place=s.createWorkPlace({siteId:a.id,name:'가상 장소',work:area,route:area});assert.equal(s.workPlaces(b.id).length,0);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:{...area,ground:'알 수 없음'},route:area}),/지형/);
    const detailed={...area,reinforcementChoices:['철판설치','지반개량'],workerProtection:['유도자 배치','라바콘'],workerProtectionExtra:'추가 시설'};
    const saved=s.createWorkPlace({siteId:a.id,name:'상세 가상 장소',work:detailed,route:detailed,additional:[{label:'가상 항목',value:'가상 내용'}]});
    assert.deepEqual(JSON.parse(saved.details).work.workerProtection,detailed.workerProtection);
    assert.deepEqual(JSON.parse(saved.details).additional,[{label:'가상 항목',value:'가상 내용'}]);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:area,route:area,additional:[{label:'',value:'내용'}]}),/추가정보/);
    assert.equal(JSON.parse(saved.details).route.workerProtectionExtra,'추가 시설');
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:{...area,obstacleChoices:['미확인']},route:area}),/선택 항목/);
    assert.throws(()=>s.createWorkPlace({siteId:a.id,name:'가상',work:area,route:{...area,equipmentProtection:['신호수 배치']}}),/선택 항목/);
    const png=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addWorkPlacePhoto(a.id,place.id,'가상.png',png);
    assert.equal(s.workPlacePhotos(a.id,place.id).length,1);assert.deepEqual(Buffer.from(s.workPlacePhoto(a.id,place.id,photoId).data),png);
    assert.equal(s.workPlacePhoto(b.id,place.id,photoId),null);assert.throws(()=>s.workPlacePhotos(b.id,place.id),/현장/);
    assert.throws(()=>s.addWorkPlacePhoto(a.id,place.id,'가상.png',Buffer.from('not image')),/PNG/);
    assert.throws(()=>s.deleteWorkPlacePhoto(b.id,place.id,photoId),/사진/);s.deleteWorkPlacePhoto(a.id,place.id,photoId);assert.equal(s.workPlacePhotos(a.id,place.id).length,0);
    const base={siteId:a.id,type:'work_plan',title:'가상 계획',date:'2026-10-28'};
    assert.equal(JSON.parse(s.createDocument({...base,details:{workPlaceId:place.id}}).details).workPlaceId,place.id);
    assert.throws(()=>s.createDocument({...base,siteId:b.id,details:{workPlaceId:place.id}}),/현장/);
  }finally{s.close();}
});

test('줄걸이와 체결장구를 현장별로 저장하고 입력을 검증한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const input={siteId:a.id,category:'줄걸이',kind:'가상 와이어',name:'가상 장구',standards:['가상 규격 1','가상 규격 2'],additional:[{label:'항목',value:'내용'}],spec:'가상 제원'};
    const item=s.createRigging(input);assert.deepEqual(JSON.parse(item.details).standards,input.standards);assert.equal(s.rigging(a.id).length,1);assert.equal(s.rigging(b.id).length,0);
    const photo=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addRiggingPhoto(a.id,item.id,'가상.png',photo);
    assert.deepEqual(Buffer.from(s.riggingPhoto(a.id,item.id,photoId).data),photo);assert.equal(s.riggingPhoto(b.id,item.id,photoId),null);
    assert.throws(()=>s.addRiggingPhoto(a.id,item.id,'가상.png',Buffer.from('bad')),/PNG/);assert.throws(()=>s.deleteRiggingPhoto(b.id,item.id,photoId),/사진/);
    s.deleteRiggingPhoto(a.id,item.id,photoId);assert.equal(s.riggingPhotos(a.id,item.id).length,0);
    assert.equal(s.createRigging({...input,name:'수정된 장구'},item.id).name,'수정된 장구');
    assert.throws(()=>s.createRigging({...input,siteId:b.id},item.id),/현장/);
    assert.throws(()=>s.createRigging({...input,standards:['']},item.id),/규격/);assert.equal(s.rigging(a.id)[0].name,'수정된 장구');
    assert.throws(()=>s.createRigging({...input,category:'기타'}),/구분/);assert.throws(()=>s.createRigging({...input,siteId:999}),/현장/);assert.throws(()=>s.createRigging({...input,standards:['']}),/규격/);
    const plan={siteId:a.id,type:'work_plan',title:'가상 작업',date:'2026-10-29',details:{riggingIds:[item.id]}};
    const doc=s.createDocument(plan);assert.deepEqual(JSON.parse(doc.details).riggingIds,[item.id]);
    assert.throws(()=>s.createRigging(input,item.id),/연결된 장구/);
    assert.throws(()=>s.createDocument({...plan,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...plan,details:{riggingIds:[item.id,item.id]}}),/장구/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).riggingIds,[item.id]);
  }finally{s.close();}
});

test('협력사는 현장별로 등록·수정되고 다른 현장에서 수정할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const company=s.createCompany({siteId:a.id,name:'가상 협력사',trade:'토목'});
    assert.equal(s.companies(a.id).length,1);
    assert.equal(s.companies(b.id).length,0);
    assert.throws(()=>s.updateCompany(company.id,{siteId:b.id,name:'변경',trade:'건축'}),/현장/);
    assert.throws(()=>s.createCompany({siteId:a.id,name:'',trade:'토목'}),/회사명/);
    assert.equal(s.updateCompany(company.id,{siteId:a.id,name:'가상 협력사',trade:'건축'}).trade,'건축');
    assert.equal(s.companies(a.id)[0].name,'가상 협력사');
  } finally {s.close();}
});

test('안전관리비는 정수 원 단위로 계산하고 현장과 월별로 합산한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),input={siteId:a.id,category:'2',date:'2026-10-20',description:'가상 시설',note:'',unitPrice:'1200',quantity:'1.250',unit:'개'};
    assert.equal(s.createSafetyCost(input).amount,'1500');s.createSafetyCost({...input,date:'2026-10-21',unitPrice:'999999999000',quantity:'99999999.999'});
    const cost=s.createSafetyCost({...input,siteId:b.id});s.createSafetyCost({...input,date:'2026-11-01'});
    const png=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addSafetyCostPhoto(b.id,cost.id,'가상.png',png);
    assert.equal(s.safetyCostPhoto(a.id,cost.id,photoId),null);assert.throws(()=>s.addSafetyCostPhoto(b.id,cost.id,'가상.png',Buffer.from('bad')),/PNG/);
    const result=s.safetyCosts(a.id,'2026-10');assert.equal(result.rows.length,2);assert.equal(result.total,(1500n+999999999000n*99999999999n/1000n).toString());
    assert.equal(s.safetyCosts(b.id,'2026-10').total,'1500');assert.throws(()=>s.createSafetyCost({...input,unitPrice:'1',quantity:'0.5'}),/원 단위/);
    assert.throws(()=>s.createSafetyCost({...input,category:'10'}),/항목/);assert.throws(()=>s.safetyCosts(a.id,'2026-13'),/월/);
    const reportInput={siteId:b.id,month:'2026-10',date:'2026-10-29',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'100000',budget:'3000',progressAmount:'1500',progress:'50'};
    const doc=s.createSafetyCostReport(reportInput),details=JSON.parse(doc.details);assert.equal(details.total,'1500');assert.equal(details.categoryTotals[1],'1500');
    const reportPhoto=s.safetyCostReportPhotos(doc.id)[0];s.deleteSafetyCostPhoto(b.id,cost.id,photoId);assert.deepEqual(Buffer.from(s.safetyCostReportPhoto(doc.id,reportPhoto.id).data),png);
    s.createSafetyCost({...input,siteId:b.id});assert.equal(s.safetyCosts(b.id,'2026-10').total,'3000');assert.equal(JSON.parse(s.document(doc.id).details).total,'1500');
    assert.throws(()=>s.updateDocument(doc.id,{siteId:b.id,type:'cost',date:'2026-10-29',title:'변경'}),/보존/);
    assert.throws(()=>s.createSafetyCostReport({...reportInput,month:'2026-09'}),/사용내역/);assert.throws(()=>s.createSafetyCostReport({...reportInput,progress:'101'}),/공정률/);
  }finally{s.close();}
});

test('작업지시서의 수신 협력사는 현장별로 검증되고 이름이 보존된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),company=s.createCompany({siteId:a.id,name:'가상 협력사',trade:'가상 공종'});
    const input={siteId:a.id,type:'instruction',title:'가상 지시',date:'2026-10-29',body:'시험 지시사항',details:{companyId:company.id,recipient:'가상 담당자',companyName:'위조'}};
    const doc=s.createDocument(input);assert.equal(JSON.parse(doc.details).companyName,'가상 협력사');
    const worker=s.createWorker({siteId:a.id,name:'가상 출입자',category:'가상',company:'가상 협력사',occupation:'가상 직종'}),other=s.createWorker({siteId:a.id,name:'다른 소속',category:'가상',company:'다른 업체',occupation:'가상 직종'});
    const linked=s.createDocument({...input,details:{companyId:company.id,recipientId:worker.id,recipient:'위조'}});assert.equal(JSON.parse(linked.details).recipient,'가상 출입자');
    assert.equal(s.workerInstructions(worker.id).length,0);s.transition(linked.id,'submit');s.transition(linked.id,'approve');
    assert.equal(s.workerInstructions(other.id).length,0);assert.throws(()=>s.respondInstruction(other.id,linked.id,{date:'2026-10-30',content:'가상 조치'}),/지정/);
    assert.throws(()=>s.workerInstructionAttachments(other.id,linked.id),/지정/);
    assert.equal(s.respondInstruction(worker.id,linked.id,{date:'2026-10-30',content:'가상 조치',actor:'위조'}).actor,'가상 출입자');assert.equal(s.instructionResult(linked.id).source,'worker');
    assert.throws(()=>s.addWorkerInstructionPhoto(other.id,linked.id,'before','가상.png',Buffer.from('89504e470d0a1a0a','hex')),/본인/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:company.id,recipientId:other.id}}),/담당자/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:0,recipientId:worker.id}}),/협력사/);
    s.updateWorker(worker.id,{siteId:a.id,name:'수정된 출입자',category:'가상',company:'가상 협력사',occupation:'가상 직종'});assert.equal(JSON.parse(s.document(linked.id).details).recipient,'가상 출입자');
    const result={date:'2026-10-30',actor:'가상 담당자',content:'시험 조치'};
    assert.equal(s.instructionResult(doc.id),null);assert.throws(()=>s.addInstructionResult(doc.id,result),/승인/);
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');assert.equal(s.addInstructionResult(doc.id,result).content,'시험 조치');
    assert.throws(()=>s.addInstructionResult(doc.id,{...result,content:'덮어쓰기'}),/이미/);assert.equal(s.instructionResult(doc.id).content,'시험 조치');
    assert.throws(()=>s.createDocument({...input,siteId:b.id}),/현장/);
    assert.throws(()=>s.createDocument({...input,details:{companyId:-1}}),/협력사/);
    s.updateCompany(company.id,{siteId:a.id,name:'변경 협력사',trade:'가상 공종'});assert.equal(JSON.parse(s.document(doc.id).details).companyName,'가상 협력사');
  }finally{s.close();}
});

test('현장과 출입자를 분리하고 문서 결재 이력을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 현장 A'}), b=s.createSite({name:'가상 현장 B'});
    s.createWorker({siteId:a.id,name:'시험 사용자',category:'직영',company:'가상 회사',occupation:'보통인부'});
    assert.equal(s.workers(a.id,'시험').length,1); assert.equal(s.workers(b.id).length,0);
    const d=s.createDocument({siteId:a.id,type:'tbm',title:'작업 전 회의',date:'2026-10-28',body:'안전 확인'});
    assert.equal(s.documents(b.id).length,0); assert.equal(s.documents(a.id,'tbm','회의').length,1);
    assert.throws(()=>s.transition(d.id,'approve'),/현재 상태/);
    assert.equal(s.transition(d.id,'submit').status,'pending');
    assert.throws(()=>s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-28'}),/수정/);
    assert.equal(s.transition(d.id,'reject').status,'rejected');
    assert.equal(s.transition(d.id,'revise').status,'draft');
    assert.equal(s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-29',body:'수정'}).title,'변경');
    assert.throws(()=>s.updateDocument(d.id,{siteId:a.id,type:'tbm',title:'변경',date:'2026-10-29',body:'x'.repeat(20001)}),/20,000자/);
    assert.equal(s.document(d.id).body,'수정');
    assert.equal(s.events(d.id).length,3);
    assert.throws(()=>s.createDocument({siteId:a.id,type:'tbm',title:'x',date:'2026-02-30'}),/날짜/);
    const invite=s.createInvitation(a.id);
    assert.equal(s.invitation(invite.token).name,'가상 현장 A');
    const oldAccess=s.siteAccessKey(a.id),newAccess=s.rotateSiteAccess(a.id);assert.notEqual(oldAccess,newAccess);assert.equal(s.siteFromAccess(oldAccess),null);assert.equal(s.invitation(invite.token).id,a.id);
    const input={name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'기타',loginId:'worker1',password:'virtual-password-123'};
    assert.throws(()=>s.join(invite.token,input),/확인/);
    assert.throws(()=>s.join(invite.token,{...input,acknowledged:'true'}),/확인/);
    assert.equal(s.workers(a.id).length,1);
    const joined=s.join(invite.token,{...input,acknowledged:true});assert.equal(s.joinAcknowledgement(a.id,joined.id).profile,null);
    assert.equal(s.authenticateWorker(invite.token,'worker1','virtual-password-123').name,'가상 근로자');
    assert.equal(s.authenticateWorker(invite.token,'worker1','wrong-password'),null);
    assert.throws(()=>s.join(invite.token,{...input,acknowledged:true}),/아이디/);
    assert.equal(s.workers(a.id).length,2);
    assert.equal(s.db.prepare('SELECT notice_version FROM join_acknowledgements').get().notice_version,'demo-v1');
    assert.throws(()=>s.join('invalid',{name:'x'}),/만료/);
    const another=s.createInvitation(b.id);
    assert.equal(s.revokeInvitations(a.id),1);
    assert.equal(s.invitation(invite.token),null);
    assert.equal(s.invitation(another.token).id,b.id);
  } finally {s.close();}
});

test('저장한 현장과 가입 정보가 서버 재시작 후 유지되고 만료 링크는 거절한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-'));
  const path=join(dir,'test.sqlite');
  try {
    let s=new Store(path);
    const site=s.createSite({name:'지속성 시험 현장'});
    const invite=s.createInvitation(site.id);
    const access=s.siteAccessKey(site.id);assert.equal(s.ensureSiteAccess(site.id),access);
    s.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'기타',loginId:'worker1',password:'virtual-password-123',acknowledged:true});
    s.close();
    s=new Store(path);
    try {
      assert.equal(s.sites()[0].name,'지속성 시험 현장');
      assert.equal(s.workers(site.id)[0].name,'가상 근로자');
      assert.equal(s.authenticateWorker(invite.token,'worker1','virtual-password-123').name,'가상 근로자');
      assert.equal(s.db.prepare('SELECT notice_version FROM join_acknowledgements').get().notice_version,'demo-v1');
      assert.equal(s.invitation(invite.token).id,site.id);
      s.db.prepare('UPDATE invitations SET expires_at=0').run();
      assert.equal(s.invitation(invite.token),null);
      assert.equal(s.siteAccessKey(site.id),access);assert.equal(s.siteFromAccess(access).id,site.id);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',access).name,'가상 근로자');assert.equal(s.authenticateWorker(null,'worker1','wrong-password',access),null);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123','invalid'),null);
      const other=s.createSite({name:'다른 시험 현장'}),otherKey=s.ensureSiteAccess(other.id),replacement=s.rotateSiteAccess(site.id);
      assert.notEqual(replacement,access);assert.equal(s.siteFromAccess(access),null);assert.equal(s.siteFromAccess(replacement).id,site.id);assert.equal(s.siteFromAccess(otherKey).id,other.id);
      assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',replacement).name,'가상 근로자');assert.equal(s.authenticateWorker(null,'worker1','virtual-password-123',access),null);
      assert.throws(()=>s.join(invite.token,{name:'늦은 가입'}),/만료/);
      assert.equal(s.workers(site.id).length,1);
    } finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('작업일보의 구조화된 항목을 저장하고 수정하며 공정률을 검증한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const input={siteId:site.id,type:'daily_report',title:'가상 일보',date:'2026-10-28',body:'메모',details:{weather:'맑음',progress:'25.5',todayWork:'배근',tomorrowWork:'거푸집',labor:'목공 2',equipment:'크레인 1',materials:'철근',remarks:'확인'}};
    const doc=s.createDocument(input);
    assert.equal(JSON.parse(doc.details).todayWork,'배근');
    const updated=s.updateDocument(doc.id,{...input,details:{...input.details,progress:'30'}});
    assert.equal(JSON.parse(updated.details).progress,'30');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{progress:'101'}}),/공정률/);
    assert.equal(JSON.parse(s.document(doc.id).details).progress,'30');
    const rows={labor:[{name:'목공',quantity:'2명'},{name:'철근공',quantity:'3명'}],equipment:[{name:'크레인',quantity:'1대'}],materials:[]};
    const withRows=s.updateDocument(doc.id,{...input,details:{...input.details,...rows}});
    assert.deepEqual(JSON.parse(withRows.details).labor,rows.labor);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{labor:[{name:'',quantity:'2명'}]}}),/인력/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).labor,rows.labor);
  } finally {s.close();}
});

test('이전 위험성평가는 현장, 날짜, 종류, 척도와 결재 상태를 제한한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=(siteId,date,kind,scale)=>s.createDocument({siteId,date,type:'risk',title:'가상 평가',details:{kind,scale,items:[{hazard:'가상 위험'}]}});
    const match=add(a.id,'2026-10-27','regular','3x3');s.transition(match.id,'submit');
    const draft=add(a.id,'2026-10-27','regular','3x3');
    const wrong=add(a.id,'2026-10-27','regular','5x4');s.transition(wrong.id,'submit');
    const later=add(a.id,'2026-10-30','regular','3x3');s.transition(later.id,'submit');
    const elsewhere=add(b.id,'2026-10-27','regular','3x3');s.transition(elsewhere.id,'submit');
    assert.deepEqual(s.previousRiskAssessments(a.id,'2026-10-28','regular','3x3',draft.id).map(d=>d.id),[match.id]);
    assert.deepEqual(s.previousRiskAssessments(a.id,'2026-10-28','regular','3x3',match.id),[]);
    assert.throws(()=>s.previousRiskAssessments(a.id,'2026-10-28','','3x3',0),/선택/);
  } finally {s.close();}
});

test('위험성평가 반려 의견은 필수이며 처리 이력에 보존된다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'});
    const doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-28'});
    s.transition(doc.id,'submit');
    assert.throws(()=>s.transition(doc.id,'reject','  '),/반려 의견/);
    assert.equal(s.document(doc.id).status,'pending');
    assert.throws(()=>s.transition(doc.id,'reject','x'.repeat(2001)),/의견/);
    s.transition(doc.id,'reject','가상 검토 의견');
    assert.equal(s.events(doc.id).at(-1).opinion,'가상 검토 의견');
    s.transition(doc.id,'revise');s.transition(doc.id,'submit');s.transition(doc.id,'approve','가상 승인 의견');
    assert.equal(s.events(doc.id).at(-1).opinion,'가상 승인 의견');
  } finally {s.close();}
});

test('교육 종류와 출력용 교육대상을 저장하고 기타 교육명을 검증한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,type:'education',title:'가상 교육',date:'2026-10-28',details:{kind:'other',otherTitle:'가상 교육명',audience:'가상 근로자'}};
    const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details),input.details);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'other',otherTitle:'',audience:'가상'}}),/교육명/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'unknown'}}),/종류/);
    assert.equal(JSON.parse(s.document(doc.id).details).otherTitle,'가상 교육명');
  } finally {s.close();}
});

test('작업허가서의 위험작업과 기간을 저장하고 잘못된 수정은 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),details={kinds:['화기작업','밀폐공간작업'],company:'가상 업체',personnel:'3',periodFrom:'2026-10-29',periodTo:'2026-10-29',timeFrom:'07:00',timeTo:'16:30',place:'가상 장소',work:'가상 작업'};
    const input={siteId:site.id,type:'permit',title:'가상 허가서',date:'2026-10-29',details},doc=s.createDocument(input);
    assert.deepEqual(JSON.parse(doc.details),details);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,kinds:['미확인']}}),/위험작업/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,timeFrom:'18:00'}}),/작업시간/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...details,periodTo:'2026-10-28'}}),/작업기간/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details),details);
  }finally{s.close();}
});

test('허가서의 사전 조치 시험 점검은 문서별로 저장하고 잘못된 수정을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'},doc=s.createDocument(base),other=s.createDocument(base),nonPermit=s.createDocument({...base,type:'tbm'});
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');const input={date:'2041-01-02',items:[{name:'가상 보호 상태',result:'pass',action:''},{name:'가상 시정',result:'fail',action:'시험 조치'}]},id=s.savePermitCheck(doc.id,input);
    assert.deepEqual(s.permitChecks(doc.id)[0].items,input.items);assert.deepEqual(s.permitChecks(other.id),[]);assert.throws(()=>s.savePermitCheck(nonPermit.id,input),/허가서/);
    assert.throws(()=>s.savePermitCheck(doc.id,{...input,items:[]},id),/항목/);assert.throws(()=>s.savePermitCheck(doc.id,{...input,items:[{name:'가상',result:'pass',action:'기존 조치'}]},id),/비워/);assert.throws(()=>s.savePermitCheck(other.id,input,id),/찾을 수/);assert.deepEqual(s.permitChecks(doc.id)[0].items,input.items);
    const changed={...input,items:[{name:'수정 항목',result:'fail',action:'보완 예정'}]};s.savePermitCheck(doc.id,changed,id);assert.deepEqual(s.permitChecks(doc.id)[0].items,changed.items);assert.throws(()=>s.deletePermitCheck(other.id,id),/찾을 수/);s.deletePermitCheck(doc.id,id);assert.deepEqual(s.permitChecks(doc.id),[]);
  }finally{s.close();}
});

test('시험 허가 연장은 기간과 서명을 검증하고 문서별로 분리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'},doc=s.createDocument(base),other=s.createDocument(base),nonPermit=s.createDocument({...base,type:'tbm'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`,input={dateFrom:'2041-01-01',dateTo:'2041-01-02',timeFrom:'07:15',timeTo:'16:45',signature};
    const id=s.savePermitExtension(doc.id,input);assert.deepEqual(Buffer.from(s.permitExtensionSignature(doc.id,id)),bytes);assert.deepEqual(s.permitExtensions(other.id),[]);assert.equal(s.permitExtensionSignature(other.id,id),null);assert.throws(()=>s.savePermitExtension(nonPermit.id,input),/허가서/);
    for(const bad of [{...input,dateTo:'2040-12-31'},{...input,dateTo:input.dateFrom,timeFrom:'17:00',timeTo:'08:00'},{...input,timeTo:''},{...input,timeFrom:'25:00'},{...input,signature:'invalid'}])assert.throws(()=>s.savePermitExtension(doc.id,bad,id));
    assert.equal(s.permitExtensions(doc.id)[0].time_from,'07:15');assert.deepEqual(Buffer.from(s.permitExtensionSignature(doc.id,id)),bytes);assert.throws(()=>s.savePermitExtension(other.id,input,id),/찾을 수/);
    s.savePermitExtension(doc.id,{...input,timeFrom:'',timeTo:''},id);assert.equal(s.permitExtensions(doc.id)[0].time_from,'');assert.throws(()=>s.deletePermitExtension(other.id,id),/찾을 수/);s.deletePermitExtension(doc.id,id);assert.equal(s.permitExtensionSignature(doc.id,id),null);
  }finally{s.close();}
});

test('허가서 시험 점검은 데이터베이스를 다시 열어도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-permit-check-'));let s;try{
    const path=join(dir,'test.sqlite');s=new Store(path);const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'permit',title:'가상 허가서',date:'2041-01-01'}),items=[{name:'가상 점검',result:'fail',action:'가상 조치'}];s.savePermitCheck(doc.id,{date:'2041-01-02',items});const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,extensionId=s.savePermitExtension(doc.id,{dateFrom:'2041-01-03',dateTo:'2041-01-04',signature});s.close();s=null;
    s=new Store(path);assert.deepEqual(s.permitChecks(doc.id)[0].items,items);assert.equal(s.permitExtensions(doc.id)[0].date_to,'2041-01-04');assert.ok(s.permitExtensionSignature(doc.id,extensionId));
  }finally{if(s)s.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('재해 보고서의 가상 재해자와 발생 내용을 보존하고 잘못된 값을 거절한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),victims=[{name:'가상 재해자',company:'가상 소속',occupation:'가상 직종',career:'가상 경력',outcome:'부상',treatment:'가상 치료'}];
    const input={siteId:site.id,type:'incident',title:'가상 보고',date:'2026-10-29',details:{severity:'경상',periodFrom:'2026-01-01',periodTo:'2026-12-31',progress:'20',location:'가상 장소',circumstances:'가상 경위',victims}};
    const doc=s.createDocument(input);assert.deepEqual(JSON.parse(doc.details).victims,victims);
    assert.equal(JSON.parse(doc.details).victims[0].joinedAt,undefined);
    const updated=s.updateDocument(doc.id,{...input,details:{...input.details,victims:[{...victims[0],joinedAt:'2026-01-01'}],inspections:[{name:'가상 점검',date:'2026-10-01'}]}});
    assert.equal(JSON.parse(updated.details).victims[0].joinedAt,'2026-01-01');assert.equal(JSON.parse(updated.details).inspections[0].name,'가상 점검');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,inspections:[{name:'가상 점검',date:'2026-02-30'}]}}),/날짜/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,progress:'101'}}),/공정률/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,victims:[{...victims[0],outcome:'미확인'}]}}),/재해자/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{...input.details,periodTo:'2025-01-01'}}),/공사기간/);
    assert.equal(JSON.parse(s.document(doc.id).details).location,'가상 장소');assert.equal(JSON.parse(s.document(doc.id).details).inspections[0].date,'2026-10-01');
  }finally{s.close();}
});

test('교육 대상은 현장별로 제한되고 결재 요청 후 변경할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const one=add(a.id),two=add(a.id),other=add(b.id);
    const doc=s.createDocument({siteId:a.id,type:'education',title:'가상 교육',date:'2026-10-28'});
    assert.equal(s.trainingTargets(doc.id).configured,false);
    s.setTrainingTargets(doc.id,[one.id]);
    assert.throws(()=>s.setTrainingTargets(doc.id,[other.id]),/현장/);
    assert.deepEqual(s.trainingTargets(doc.id).workers.filter(w=>w.selected).map(w=>w.id),[one.id]);
    s.transition(doc.id,'submit');assert.throws(()=>s.setTrainingTargets(doc.id,[two.id]),/수정/);s.transition(doc.id,'approve');
    assert.equal(s.workerTraining(one.id,'2026-10-28').length,1);
    assert.equal(s.workerTraining(two.id,'2026-10-28').length,0);
    assert.throws(()=>s.confirmWorkerTraining(two.id,doc.id,'2026-10-28'),/교육 문서/);
    assert.throws(()=>s.confirmWorkerTraining(one.id,doc.id,'2026-10-28',false),/권리/);assert.equal(s.trainingChecks(doc.id).length,0);
    s.confirmWorkerTraining(one.id,doc.id,'2026-10-28',true);assert.equal(s.trainingChecks(doc.id)[0].rights_ack,'demo-v1');
  } finally {s.close();}
});

test('교육 참가 확인은 현장과 날짜 및 교육 종류에 맞는 대상자에게만 표시한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'목공'});
    const one=add(a.id),other=add(b.id);
    assert.throws(()=>s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],false),/권리/);
    assert.throws(()=>s.confirmDailyTraining(one.id,'2026-10-28',['tbm','tbm'],true),/교육 종류/);
    s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],true);s.confirmDailyTraining(one.id,'2026-10-28',['tbm'],true);
    assert.equal(s.dailyTraining(one.id,'2026-10-28').length,1);
    const doc=(siteId,date,type)=>s.createDocument({siteId,date,type,title:'가상 문서'});
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-28','tbm').id).workers[0].daily_confirmed,1);
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-29','tbm').id).workers[0].daily_confirmed,0);
    assert.equal(s.trainingTargets(doc(a.id,'2026-10-28','education').id).workers[0].daily_confirmed,0);
    const otherTargets=s.trainingTargets(doc(b.id,'2026-10-28','tbm').id).workers;
    assert.equal(otherTargets.length,1);assert.equal(otherTargets[0].id,other.id);assert.equal(otherTargets[0].daily_confirmed,0);
  } finally {s.close();}
});

test('작업계획서의 기본 항목을 저장하고 잘못된 작업기간은 기존 값을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'가상 현장'}),details={consultedAt:'2026-10-20',periodFrom:'2026-10-21',periodTo:'2026-10-25',company:'가상 업체',personnel:'3명',place:'가상 장소',equipment:'가상 장비',hazards:'가상 위험',measures:'가상 대책'};
    const doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-20',details});
    assert.deepEqual(JSON.parse(s.document(doc.id).details),details);
    const asset=s.createEquipment({siteId:site.id,kind:'굴착기',model:'가상 모델',capacity:'',manufacturer:'',registration:''});
    const other=s.createSite({name:'다른 현장'}),otherAsset=s.createEquipment({siteId:other.id,kind:'굴착기',model:'다른 모델',capacity:'',manufacturer:'',registration:''});
    const base={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-20'};
    const timed=s.createDocument({...base,details:{...details,workKinds:['차량계 건설기계','중량물 취급'],timeFrom:'07:00',timeTo:'16:30'}});
    assert.deepEqual(JSON.parse(timed.details).workKinds,['차량계 건설기계','중량물 취급']);assert.equal(JSON.parse(timed.details).timeTo,'16:30');
    assert.throws(()=>s.createDocument({...base,details:{...details,workKinds:['미확인']}}),/작업구분/);
    assert.throws(()=>s.createDocument({...base,details:{...details,timeFrom:'24:30',timeTo:'16:00'}}),/작업시간/);
    assert.throws(()=>s.createDocument({...base,details:{...details,periodTo:details.periodFrom,timeFrom:'17:00',timeTo:'08:00'}}),/작업시간/);
    assert.throws(()=>s.createDocument({...base,details:{...details,timeFrom:'07:00',timeTo:''}}),/작업시간/);
    assert.throws(()=>s.updateDocument(doc.id,{...base,details:{...details,equipmentIds:[otherAsset.id]}}),/현장/);
    assert.throws(()=>s.createDocument({...base,details:{...details,equipmentIds:[asset.id,asset.id]}}),/장비/);
    s.updateDocument(doc.id,{...base,details:{...details,equipmentIds:[asset.id]}});
    assert.deepEqual(JSON.parse(s.document(doc.id).details).equipmentIds,[asset.id]);
    const check={equipmentId:asset.id,date:'2026-10-22',items:[{name:'가상 점검',result:'부적정'}]};
    s.addEquipmentCheck(doc.id,check);assert.deepEqual(JSON.parse(s.equipmentChecks(doc.id)[0].items),check.items);
    assert.throws(()=>s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정',date:'2026-10-20',details:{...details,periodTo:'2026-10-19'}}),/작업기간/);
    s.updateEquipment(asset.id,{siteId:site.id,kind:'굴착기',model:'수정 모델',capacity:'',manufacturer:'',registration:''});
    assert.equal(JSON.parse(s.equipmentChecks(doc.id)[0].equipment_snapshot).model,'가상 모델');
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');s.addEquipmentCheck(doc.id,{...check,date:'2026-10-23'});
    assert.equal(JSON.parse(s.equipmentChecks(doc.id)[0].equipment_snapshot).model,'수정 모델');
    assert.throws(()=>s.addEquipmentCheck(doc.id,check),/이미/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,date:'2026-10-30'}),/작업기간/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,equipmentId:otherAsset.id}),/장비/);
    assert.throws(()=>s.addEquipmentCheck(doc.id,{...check,date:'2026-10-23',items:[{name:'가상',result:'모름'}]}),/판정/);
    assert.throws(()=>s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정',date:'2026-10-20',details:{...details,periodTo:'2026-10-19'}}),/수정/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).equipmentIds,[asset.id]);
  } finally {s.close();}
});

test('결재 요청한 계획서는 장비 수정 후에도 요청 당시 장비 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),input={siteId:site.id,kind:'굴착기',model:'이전 모델',capacity:'',manufacturer:'',registration:''};
    const item=s.createEquipment(input),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',details:{equipmentIds:[item.id],equipmentSnapshot:[{id:item.id,model:'위조'}]}});
    assert.equal(JSON.parse(doc.details).equipmentSnapshot,undefined);
    s.transition(doc.id,'submit');s.updateEquipment(item.id,{...input,model:'수정 모델'});
    assert.equal(JSON.parse(s.document(doc.id).details).equipmentSnapshot[0].model,'이전 모델');
    assert.equal(s.equipment(site.id)[0].model,'수정 모델');
    s.transition(doc.id,'reject','가상 반려');s.transition(doc.id,'revise');s.updateDocument(doc.id,{siteId:site.id,type:'work_plan',title:'수정 계획',date:'2026-10-29',details:{equipmentIds:[item.id]}});s.transition(doc.id,'submit');
    assert.equal(JSON.parse(s.document(doc.id).details).equipmentSnapshot[0].model,'수정 모델');
  }finally{s.close();}
});

test('작업계획서의 역할별 작업자는 현장을 검증하고 당시 정보를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 현장'}),b=s.createSite({name:'다른 현장'}),workerInput={siteId:a.id,name:'가상 작업자',category:'직영',company:'가상 업체',occupation:'운전원'};
    const worker=s.createWorker(workerInput),other=s.createWorker({...workerInput,siteId:b.id});
    const row={workerId:worker.id,role:'운전원',training:'가상 교육',qualification:'가상 자격',name:'위조'},input={siteId:a.id,type:'work_plan',title:'가상 계획',date:'2026-10-29',details:{workers:[row]}};
    const doc=s.createDocument(input),saved=JSON.parse(doc.details).workers[0];assert.equal(saved.name,'가상 작업자');assert.equal(saved.company,'가상 업체');assert.equal(saved.training,'가상 교육');
    const route={...input,details:{...input.details,routeDescription:'가상 진입로\n가상 출구',workSequence:'1. 준비\n2. 작업'}};
    s.updateDocument(doc.id,route);assert.equal(JSON.parse(s.document(doc.id).details).workSequence,'1. 준비\n2. 작업');
    assert.throws(()=>s.updateDocument(doc.id,{...route,details:{...route.details,workSequence:'가'.repeat(4001)}}),/작업순서/);
    assert.equal(JSON.parse(s.document(doc.id).details).routeDescription,'가상 진입로\n가상 출구');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,workerId:other.id}]}}),/현장/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{workers:[{...row,role:'알 수 없음'}]}}),/작업자/);
    s.updateWorker(worker.id,{...workerInput,name:'변경된 이름'});s.transition(doc.id,'submit');assert.equal(JSON.parse(s.document(doc.id).details).workers[0].name,'가상 작업자');
  }finally{s.close();}
});

test('위험요인과 조치를 저장하고 유효하지 않은 수정은 기존 값을 보존한다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const input={siteId:site.id,type:'risk',title:'가상 위험요인',date:'2026-10-28',details:{task:'가상 작업',hazard:'가상 위험',existingMeasures:'기존 조치',additionalMeasures:'추가 조치'}};
    const doc=s.createDocument(input);
    assert.equal(JSON.parse(doc.details).hazard,'가상 위험');
    assert.equal(JSON.parse(s.updateDocument(doc.id,{...input,details:{...input.details,additionalMeasures:'조치 변경'}}).details).additionalMeasures,'조치 변경');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{hazard:'x'.repeat(2001)}}),/위험성평가/);
    assert.equal(JSON.parse(s.document(doc.id).details).additionalMeasures,'조치 변경');
    const items=[{task:'작업 A',hazard:'위험 A',existingMeasures:'기존 A',additionalMeasures:'추가 A'},{task:'작업 B',hazard:'위험 B',existingMeasures:'',additionalMeasures:'추가 B'}];
    assert.deepEqual(JSON.parse(s.updateDocument(doc.id,{...input,details:{items}}).details).items,items);
    const classified=s.updateDocument(doc.id,{...input,details:{kind:'continuous',scale:'3x3',periodFrom:'2026-10-01',periodTo:'2026-10-31',items}});
    assert.equal(JSON.parse(classified.details).kind,'continuous');
    assert.equal(JSON.parse(classified.details).scale,'3x3');
    assert.equal(JSON.parse(classified.details).periodTo,'2026-10-31');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{periodFrom:'2026-11-01',periodTo:'2026-10-01',items}}),/관리기간/);
    assert.equal(JSON.parse(s.document(doc.id).details).periodFrom,'2026-10-01');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{kind:'unknown',items}}),/종류/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'invalid',items}}),/척도/);
    assert.equal(JSON.parse(s.document(doc.id).details).kind,'continuous');
    const detailed={...items[0],riskCategory:'기계적',riskType:'끼임',legalBasis:'가상 근거',dueDate:'2024-02-29',completionDate:'',responsible:'가상 담당자'};
    assert.deepEqual(JSON.parse(s.updateDocument(doc.id,{...input,details:{items:[detailed]}}).details).items[0],detailed);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{...detailed,dueDate:'2025-02-29'}]}}),/날짜/);
    assert.equal(JSON.parse(s.document(doc.id).details).items[0].dueDate,'2024-02-29');
    const levels={...detailed,grade:'',likelihood:'2',severity:'3'};s.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[levels]}});assert.equal(JSON.parse(s.document(doc.id).details).items[0].likelihood,'2');
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'3x3',items:[{...levels,likelihood:'4'}]}}),/척도/);
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[levels]}}),/척도/);
    s.updateDocument(doc.id,{...input,details:{scale:'three-level',items:[{...detailed,grade:'상'}]}});assert.equal(JSON.parse(s.document(doc.id).details).items[0].grade,'상');
    s.updateDocument(doc.id,{...input,details:{items:[detailed]}});
    assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[{hazard:'x'.repeat(2001)}]}}),/위험성평가/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).items,[detailed]);
  } finally {s.close();}
});

test('문서 검색은 현장·기간·유형을 지키고 상세 항목도 찾는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,date,type,title,details)=>s.createDocument({siteId,date,type,title,details});
    add(a.id,'2026-10-27','risk','첫 기록',{hazard:'가상 추락'});
    add(a.id,'2026-10-28','risk','두 번째 기록',{items:[{hazard:'가상 추락'}]});
    add(b.id,'2026-10-28','risk','다른 현장',{hazard:'가상 추락'});
    add(a.id,'2026-10-28','daily_report','다른 유형',{todayWork:'가상 추락'});
    assert.deepEqual(s.documents(a.id,'risk','가상 추락','2026-10-28','2026-10-28').map(d=>d.title),['두 번째 기록']);
    assert.equal(s.documents(a.id,'','가상 추락','2026-10-27','2026-10-28').length,3);
    assert.throws(()=>s.documents(a.id,'','','2026-10-29','2026-10-28'),/시작일/);
  } finally {s.close();}
});

test('위험성평가 시험 활동은 완료 후에도 문서별로 관리된다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),doc=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29'}),other=s.createDocument({siteId:site.id,type:'risk',title:'다른 평가',date:'2026-10-29'}),nonRisk=s.createDocument({siteId:site.id,type:'tbm',title:'가상 교육',date:'2026-10-29'});
    s.transition(doc.id,'submit');s.transition(doc.id,'approve');
    const input={kind:'meeting',date:'2026-10-30',place:'가상 장소',host:'가상 주관자',participants:'가상 참석자',content:'가상 내용'},id=s.saveRiskActivity(doc.id,input);
    const worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),otherSite=s.createSite({name:'다른 현장'}),foreign=s.createWorker({siteId:otherSite.id,name:'다른 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'});
    s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id]},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,workerIds:[foreign.id]},id),/현장/);assert.throws(()=>s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id,worker.id]},id),/참석자/);
    s.updateWorker(worker.id,{siteId:site.id,name:'변경 이름',category:'직영',company:'가상 업체',occupation:'가상 직종'});s.saveRiskActivity(doc.id,input,id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id],content:'내용 수정'},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'가상 근로자');
    s.saveRiskActivity(doc.id,{...input,workerIds:[]},id);s.saveRiskActivity(doc.id,{...input,workerIds:[worker.id]},id);assert.equal(JSON.parse(s.riskActivities(doc.id)[0].worker_snapshot)[0].name,'변경 이름');
    const bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),photoId=s.addRiskActivityPhoto(doc.id,id,'가상.png',bytes);
    assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,photoId).data),bytes);assert.equal(s.riskActivityPhoto(other.id,id,photoId),null);
    assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'bad.png',Buffer.from('bad')),/PNG/);assert.throws(()=>s.riskActivityPhotos(other.id,id),/찾을 수/);
    assert.equal(s.riskActivities(doc.id)[0].host,'가상 주관자');assert.deepEqual(s.riskActivities(other.id),[]);
    assert.throws(()=>s.saveRiskActivity(other.id,input,id),/찾을 수/);assert.throws(()=>s.saveRiskActivity(nonRisk.id,input),/위험성평가/);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,date:'2026-02-30'},id),/날짜/);assert.equal(s.riskActivities(doc.id)[0].date,input.date);
    s.saveRiskActivity(doc.id,{...input,kind:'weekly',content:'수정'},id);assert.equal(s.riskActivities(doc.id)[0].kind,'weekly');
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,kind:'weekly',periodFrom:'2026-11-01',periodTo:'2026-10-01'},id),/관리기간/);
    s.saveRiskActivity(doc.id,{...input,kind:'weekly',periodFrom:'2026-10-01',periodTo:'2026-10-31',entryMode:'scan'},id);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'scan');
    const pdf=Buffer.from('%PDF-1.4\n가상 회의록'),minutes=s.addRiskActivityPhoto(doc.id,id,'시험.pdf',pdf,'minutes');assert.equal(s.riskActivityPhotos(doc.id,id).find(p=>p.id===minutes).purpose,'minutes');assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,minutes).data),pdf);
    assert.throws(()=>s.saveRiskActivity(doc.id,{...input,kind:'weekly',entryMode:'manual'},id),/회의록 첨부/);assert.throws(()=>s.saveRiskActivity(doc.id,input,id),/회의록 첨부/);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'scan');assert.deepEqual(Buffer.from(s.riskActivityPhoto(doc.id,id,minutes).data),pdf);
    s.deleteRiskActivityPhoto(doc.id,id,minutes);s.saveRiskActivity(doc.id,{...input,kind:'weekly',entryMode:'manual'},id);assert.equal(s.riskActivities(doc.id)[0].entry_mode,'manual');
    assert.throws(()=>s.addRiskActivityPhoto(doc.id,id,'시험.pdf',pdf),/PNG/);assert.throws(()=>s.saveRiskActivity(doc.id,{...input,entryMode:'scan'}),/방식/);
    assert.throws(()=>s.deleteRiskActivity(other.id,id),/찾을 수/);s.deleteRiskActivity(doc.id,id);assert.equal(s.riskActivities(doc.id).length,0);assert.equal(s.riskActivityPhoto(doc.id,id,photoId),null);
  }finally{s.close();}
});

test('같은 현장과 작성일 이전의 가장 최근 작업일보만 찾는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,date,title,type='daily_report')=>s.createDocument({siteId,date,title,type,body:title});
    add(a.id,'2026-10-25','이전 일보');
    add(a.id,'2026-10-27','가장 최근 일보');
    add(b.id,'2026-10-28','다른 현장');
    add(a.id,'2026-10-28','같은 날짜');
    add(a.id,'2026-10-29','다른 문서','tbm');
    assert.equal(s.previousDailyReport(a.id,'2026-10-28').body,'가장 최근 일보');
    assert.equal(s.previousDailyReport(a.id,'2026-10-25'),null);
    assert.equal(s.previousDailyReport(b.id,'2026-10-29').body,'다른 현장');
    assert.throws(()=>s.previousDailyReport(a.id,'2026-02-30'),/날짜/);
  } finally {s.close();}
});

test('작업일보는 같은 현장과 날짜의 TBM 및 교육 문서만 조회한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}), b=s.createSite({name:'시험 B'});
    const add=(siteId,date,type,title)=>s.createDocument({siteId,date,type,title,body:'시험 내용'});
    add(a.id,'2026-10-28','tbm','당일 TBM');add(a.id,'2026-10-28','education','당일 교육');
    add(a.id,'2026-10-27','tbm','다른 날짜');add(b.id,'2026-10-28','tbm','다른 현장');add(a.id,'2026-10-28','risk','다른 문서');
    assert.deepEqual(s.dailySourceDocuments(a.id,'2026-10-28').map(d=>d.title).sort(),['당일 TBM','당일 교육'].sort());
    assert.throws(()=>s.dailySourceDocuments(a.id,'2026-02-30'),/날짜/);
  } finally {s.close();}
});

test('첨부파일은 문서에 분리 저장하며 결재 요청 후 변경할 수 없다',()=>{
  const s=new Store(':memory:');
  try {
    const site=s.createSite({name:'시험 현장'});
    const create=title=>s.createDocument({siteId:site.id,type:'tbm',title,date:'2026-10-28'});
    const a=create('문서 A'),b=create('문서 B'),bytes=Buffer.from('가상 첨부 내용');
    const id=s.addAttachment(a.id,'가상 사진.txt',bytes);
    assert.equal(s.attachments(a.id)[0].category,'general');
    const plan=s.createDocument({siteId:site.id,type:'work_plan',title:'시험 계획',date:'2026-10-28'}),diagram=Buffer.from('89504e470d0a1a0a00000000','hex');
    const diagramId=s.addAttachment(plan.id,'계획도.png',diagram,'plan_diagram');assert.equal(s.attachments(plan.id)[0].category,'plan_diagram');assert.deepEqual(Buffer.from(s.attachment(diagramId).data),diagram);
    assert.throws(()=>s.addAttachment(a.id,'계획도.png',diagram,'plan_diagram'),/구분/);assert.throws(()=>s.addAttachment(plan.id,'계획도.png',bytes,'plan_diagram'),/PNG/);
    assert.equal(s.attachments(a.id)[0].name,'가상 사진.txt');assert.equal(s.attachments(b.id).length,0);
    assert.deepEqual(Buffer.from(s.attachment(id).data),bytes);
    assert.throws(()=>s.addAttachment(a.id,'../경로.txt',bytes),/이름/);
    assert.throws(()=>s.addAttachment(a.id,'큰 파일',Buffer.alloc(2*1024*1024+1)),/2MB/);
    s.transition(a.id,'submit');
    assert.throws(()=>s.deleteAttachment(id),/첨부파일/);
    assert.throws(()=>s.addAttachment(a.id,'추가.txt',bytes),/첨부/);
    s.transition(a.id,'withdraw');s.deleteAttachment(id);assert.equal(s.attachments(a.id).length,0);
  } finally {s.close();}
});

test('기존 데이터베이스에 작업일보 항목을 추가해도 기존 문서가 남는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-legacy-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE documents (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO documents(site_id,type,title,date,body) VALUES(1,'tbm','기존 문서','2026-10-28','기존 내용')");
    old.close();
    const s=new Store(path);
    try {assert.equal(s.document(1).body,'기존 내용');assert.deepEqual(JSON.parse(s.document(1).details),{});} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('이전 가상 노임의 알 수 없는 당시 소속은 채우지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-wage-legacy-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE sites (id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO sites(id,name) VALUES(1,'가상 현장'); CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers VALUES(1,1,'가상 근로자','직영','현재 소속','목공'); CREATE TABLE wage_records (site_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,month TEXT NOT NULL,gross INTEGER NOT NULL,deductions TEXT NOT NULL,PRIMARY KEY(worker_id,month))");
    old.prepare('INSERT INTO wage_records VALUES(?,?,?,?,?)').run(1,1,'2024-02',1000,JSON.stringify({income:100,local:10,health:20,care:3,pension:50,employment:5}));old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const row=s.wageRecords(1,'2024-02')[0];assert.equal(row.company,'기록 없음');assert.equal(row.name,'기록 없음');assert.equal(row.net,812);}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 출역 기록에 구분이 없어도 보존되고 다시 열 수 있다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-attendance-legacy-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE sites (id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO sites(id,name) VALUES(1,'가상 현장'); CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers VALUES(1,1,'가상 근로자','직영','가상 회사','목공'); CREATE TABLE attendance (worker_id INTEGER NOT NULL,date TEXT NOT NULL,present INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,company_snapshot TEXT,occupation_snapshot TEXT,source TEXT,PRIMARY KEY(worker_id,date)); INSERT INTO attendance(worker_id,date,present,company_snapshot,occupation_snapshot,source) VALUES(1,'2026-10-28',1,'가상 회사','목공','manual')");
    old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const row=s.attendanceReport(1,'2026-10-28','2026-10-28','category')[0];assert.equal(row.label,'기록 없음');assert.equal(row.days,1);assert.equal(s.attendance(1,'2026-10-28')[0].units_hundredths,null);assert.equal(s.attendanceReport(1,'2026-10-28','2026-10-28','company')[0].label,'가상 회사');}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 장비 기록은 상세정보 추가 후에도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-equipment-')),path=join(dir,'test.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE equipment (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,kind TEXT NOT NULL,model TEXT NOT NULL,capacity TEXT NOT NULL,manufacturer TEXT NOT NULL,registration TEXT NOT NULL); INSERT INTO equipment VALUES(1,1,'가상 장비','가상 모델','','','')");old.close();
    for(let i=0;i<2;i++){const s=new Store(path);try{const item=s.equipment(1)[0];assert.equal(item.kind,'가상 장비');assert.deepEqual(JSON.parse(item.details),{});}finally{s.close();}}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('기존 출입자의 알 수 없는 등록일을 임의로 채우지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-workers-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE workers (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,company TEXT NOT NULL,occupation TEXT NOT NULL); INSERT INTO workers(site_id,name,category,company,occupation) VALUES(1,'기존 출입자','직영','가상 회사','목공')");old.close();
    const s=new Store(path);
    try {assert.equal(s.workers(1)[0].created_date,null);assert.equal(s.workers(1,'',{from:'2026-01-01'}).length,0);} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('이전 결재 이력은 의견 항목 추가 후에도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-events-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE events (id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL,action TEXT NOT NULL,from_status TEXT NOT NULL,to_status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO events(document_id,action,from_status,to_status) VALUES(1,'submit','draft','pending')");
    old.close();
    let s=new Store(path);
    try {assert.equal(s.events(1)[0].action,'submit');assert.equal(s.events(1)[0].opinion,'');} finally {s.close();}
    s=new Store(path);
    try {assert.equal(s.events(1).length,1);assert.equal(s.events(1)[0].to_status,'pending');} finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('이전 교육 참가 기록에 확인되지 않은 권리 확인을 추가하지 않는다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'j-web-training-'));
  const path=join(dir,'test.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE worker_training_checks (worker_id INTEGER NOT NULL,document_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_id,document_id)); INSERT INTO worker_training_checks(worker_id,document_id,created_at) VALUES(1,2,'2026-10-28 09:00:00')");
    old.close();
    for(let i=0;i<2;i++){
      const s=new Store(path);
      try {
        const row=s.db.prepare('SELECT worker_id,document_id,created_at,rights_ack FROM worker_training_checks').get();
        assert.equal(row.worker_id,1);assert.equal(row.document_id,2);assert.equal(row.created_at,'2026-10-28 09:00:00');assert.equal(row.rights_ack,null);
      } finally {s.close();}
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('현장과 날짜별 출역을 기록하고 다른 현장의 근로자 변경을 거절한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 현장 A'}),b=s.createSite({name:'시험 현장 B'});
    const worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:true});
    assert.equal(s.attendance(a.id,'2026-10-28')[0].present,1);
    assert.equal(s.attendance(a.id,'2026-10-29')[0].present,0);
    assert.equal(s.attendance(b.id,'2026-10-28').length,0);
    assert.throws(()=>s.setAttendance({siteId:b.id,workerId:worker.id,date:'2026-10-28',present:false}),/현장/);
    assert.throws(()=>s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-02-30',present:true}),/날짜/);
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:false});
    assert.equal(s.attendance(a.id,'2026-10-28')[0].present,0);
  } finally {s.close();}
});

test('월별 출역 정보 변경은 선택한 현장과 근로자의 출역일만 수정한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'기존 업체',occupation:'기존 직종'}),second=s.createWorker({siteId:site.id,name:'다른 근로자',category:'직영',company:'기존 업체',occupation:'기존 직종'});
    for(const [person,date] of [[worker,'2024-02-01'],[worker,'2024-02-02'],[worker,'2024-03-01'],[second,'2024-02-01']])s.setAttendance({siteId:site.id,workerId:person.id,date,present:true});
    s.saveWageRecord({siteId:site.id,workerId:worker.id,month:'2024-02',gross:'1000',deductions:{income:'0',local:'0',health:'0',care:'0',pension:'0',employment:'0'}});
    s.setAttendance({siteId:site.id,workerId:worker.id,date:'2024-02-02',present:false});
    const input={siteId:site.id,workerId:worker.id,month:'2024-02',company:'변경 업체',occupation:'변경 직종'};
    assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,siteId:other.id}),/현장/);assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,month:'2024-13'}),/월/);assert.throws(()=>s.updateMonthlyAttendanceDetails({...input,occupation:' '}),/직종/);
    assert.equal(s.updateMonthlyAttendanceDetails(input),1);
    assert.equal(s.attendanceReport(site.id,'2024-02-01','2024-02-29','company').find(r=>r.label==='변경 업체').days,1);
    assert.equal(s.attendanceReport(site.id,'2024-03-01','2024-03-31','occupation')[0].label,'기존 직종');
    assert.equal(s.workers(site.id).find(w=>w.id===worker.id).company,'기존 업체');
    assert.equal(s.wageRecords(site.id,'2024-02')[0].gross,1000);assert.equal(s.wageRecords(site.id,'2024-02')[0].occupation,'기존 직종');
    assert.throws(()=>s.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2024-04',company:'변경'}),/출역/);
    assert.throws(()=>s.updateMonthlyAttendanceDetails({siteId:site.id,workerId:worker.id,month:'2024-02'}),/항목/);
  }finally{s.close();}
});

test('시험 공수는 현장과 출역일별로 수동 기록하고 미기록을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),worker=s.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),date='2024-02-29',base={siteId:site.id,workerId:worker.id,date};
    assert.throws(()=>s.setAttendanceUnits({...base,units:'1'}),/출역/);s.recordWorkerLogin(worker.id,date);assert.equal(s.attendance(site.id,date)[0].units_hundredths,null);
    s.setAttendanceUnits({...base,units:'0.25'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);assert.deepEqual(s.workerAttendanceUnits(worker.id,'2024-02').map(row=>[row.date,row.units_hundredths]),[[date,25]]);
    for(const units of ['10','-1','1.001','1e0','9.999',null,1])assert.throws(()=>s.setAttendanceUnits({...base,units}),/공수/);assert.throws(()=>s.setAttendanceUnits({...base,siteId:other.id,units:'1'}),/현장/);assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);
    s.setAttendance({...base,present:false});assert.deepEqual(s.workerAttendanceUnits(worker.id,'2024-02'),[]);s.recordWorkerLogin(worker.id,date);assert.equal(s.attendance(site.id,date)[0].present,0);s.setAttendance({...base,present:true});assert.equal(s.attendance(site.id,date)[0].units_hundredths,25);
    s.setAttendanceUnits({...base,units:'9.99'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,999);s.setAttendanceUnits({...base,units:'0'});assert.equal(s.attendance(site.id,date)[0].units_hundredths,0);s.setAttendanceUnits({...base,units:''});assert.equal(s.attendance(site.id,date)[0].units_hundredths,null);
  }finally{s.close();}
});

test('월별과 기간별 시험 공수 집계는 미기록과 0을 구분한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),add=(siteId,name)=>s.createWorker({siteId,name,category:'직영',company:'가상 업체',occupation:'가상 직종'}),one=add(site.id,'가상 1'),two=add(site.id,'가상 2'),foreign=add(other.id,'다른 근로자');
    for(const [siteId,worker,date] of [[site.id,one,'2024-02-01'],[site.id,one,'2024-02-02'],[site.id,two,'2024-02-02'],[other.id,foreign,'2024-02-02'],[site.id,one,'2024-03-01']])s.setAttendance({siteId,workerId:worker.id,date,present:true});
    for(const [siteId,worker,date,units] of [[site.id,one,'2024-02-01','0.25'],[site.id,two,'2024-02-02','0'],[other.id,foreign,'2024-02-02','9.99'],[site.id,one,'2024-03-01','8']])s.setAttendanceUnits({siteId,workerId:worker.id,date,units});
    const monthly=s.monthlyAttendance(site.id,'2024-02'),first=monthly.find(w=>w.id===one.id),second=monthly.find(w=>w.id===two.id);assert.deepEqual(first.units.map(row=>[row.date,row.units_hundredths]),[['2024-02-01',25],['2024-02-02',null]]);assert.equal(second.units[0].units_hundredths,0);
    const report=s.attendanceReport(site.id,'2024-02-01','2024-02-29','occupation')[0];assert.equal(report.days,3);assert.equal(report.units_hundredths,25);assert.equal(report.units_missing,1);
    const zero=s.attendanceReport(site.id,'2024-02-02','2024-02-02','worker').find(row=>row.label==='가상 2');assert.equal(zero.units_hundredths,0);assert.equal(zero.units_missing,0);const missing=s.attendanceReport(site.id,'2024-02-02','2024-02-02','worker').find(row=>row.label==='가상 1');assert.equal(missing.units_hundredths,null);assert.equal(missing.units_missing,1);
    s.setAttendance({siteId:site.id,workerId:one.id,date:'2024-02-01',present:false});assert.equal(s.attendanceReport(site.id,'2024-02-01','2024-02-29','occupation')[0].units_hundredths,0);
  }finally{s.close();}
});

test('월별 출역은 해당 현장과 월의 기존 일별 기록을 표시한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'});
    const add=siteId=>s.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 회사',occupation:'목공'});
    const one=add(a.id),other=add(b.id);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-02-29',present:true});
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-03-01',present:true});
    s.setAttendance({siteId:b.id,workerId:other.id,date:'2024-02-01',present:true});
    assert.deepEqual(s.monthlyAttendance(a.id,'2024-02')[0].days,['2024-02-29']);
    assert.equal(s.monthlyAttendance(a.id,'2024-02').length,1);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2024-02-29',present:false});
    assert.deepEqual(s.monthlyAttendance(a.id,'2024-02')[0].days,[]);
    assert.throws(()=>s.monthlyAttendance(a.id,'2024-13'),/월/);
  } finally {s.close();}
});

test('출역 인일을 기간과 현장에 따라 근로자·직종·소속별로 집계한다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const add=(siteId,name,company,occupation)=>s.createWorker({siteId,name,category:'직영',company,occupation});
    const one=add(a.id,'동명이인','가상 회사 A','목공'),two=add(a.id,'동명이인','가상 회사 B','목공'),other=add(b.id,'다른 현장','가상 회사 A','목공');
    for(const [siteId,worker,date] of [[a.id,one,'2026-10-27'],[a.id,one,'2026-10-28'],[a.id,two,'2026-10-28'],[b.id,other,'2026-10-28']])s.setAttendance({siteId,workerId:worker.id,date,present:true});
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-27','2026-10-28','worker').map(r=>r.days).sort(),[1,2]);
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-28','occupation')[0].days,3);
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-28','2026-10-28','company').map(r=>r.days),[1,1]);
    s.setAttendance({siteId:a.id,workerId:one.id,date:'2026-10-28',present:false});
    assert.equal(s.attendanceReport(a.id,'2026-10-28','2026-10-28','occupation')[0].days,1);
    assert.throws(()=>s.attendanceReport(a.id,'2026-10-29','2026-10-28','worker'),/시작일/);
    assert.throws(()=>s.attendanceReport(a.id,'2026-10-27','2026-10-28','invalid'),/기준/);
  } finally {s.close();}
});

test('출입자 수정은 현장 경계를 지키고 과거 출역의 소속·직종을 바꾸지 않는다',()=>{
  const s=new Store(':memory:');
  try {
    const a=s.createSite({name:'시험 A'}),b=s.createSite({name:'시험 B'});
    const worker=s.createWorker({siteId:a.id,name:'가상 근로자',category:'직영',company:'이전 업체',occupation:'목공'});
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-27',present:true});
    const changed={siteId:a.id,name:'수정된 이름',category:'외주',company:'새 업체',occupation:'전기'};
    assert.throws(()=>s.updateWorker(worker.id,{...changed,siteId:b.id}),/현장/);
    assert.throws(()=>s.updateWorker(worker.id,{...changed,name:''}),/이름/);
    assert.equal(s.workers(a.id)[0].name,'가상 근로자');
    s.updateWorker(worker.id,changed);
    s.setAttendance({siteId:a.id,workerId:worker.id,date:'2026-10-28',present:true});
    const report=s.attendanceReport(a.id,'2026-10-27','2026-10-28','company');
    assert.deepEqual(report.map(r=>[r.label,r.days]),[['새 업체',1],['이전 업체',1]]);
    assert.deepEqual(s.attendanceReport(a.id,'2026-10-27','2026-10-28','category').map(r=>[r.label,r.days]),[['외주',1],['직영',1]]);
    s.recordWorkerLogin(worker.id,'2026-10-29');
    assert.equal(s.attendanceReport(a.id,'2026-10-29','2026-10-29','category')[0].label,'외주');
    assert.equal(s.attendance(a.id,'2026-10-27')[0].present,1);
    s.db.prepare("UPDATE attendance SET company_snapshot=NULL,occupation_snapshot=NULL,category_snapshot=NULL WHERE date='2026-10-27'").run();
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-27','company')[0].label,'기록 없음');
    assert.equal(s.attendanceReport(a.id,'2026-10-27','2026-10-27','category')[0].label,'기록 없음');
  } finally {s.close();}
});
