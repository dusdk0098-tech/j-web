import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../store.js';
import {monthlyDirectMealSummary} from '../public/attendance-meals.js';

test('월별 직영 식대는 당시 단가·부가세만 합산하고 미기록과 출역 취소를 구분한다',()=>{
 const store=new Store(':memory:');try{
  const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상',category:'직영',company:'가상',occupation:'가상'}),restaurant=store.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),dates=['2026-10-01','2026-10-02','2026-10-03','2026-10-04'];
  for(const date of dates){store.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});store.saveMealCheck({siteId:site.id,workerId:worker.id,date,restaurantId:restaurant.id,kind:'lunch'});}
  store.saveMealCheck({siteId:site.id,workerId:worker.id,date:dates[0],restaurantId:restaurant.id,kind:'snack'});
  store.db.prepare('UPDATE attendance SET category_snapshot=? WHERE worker_id=? AND date=?').run('협력',worker.id,dates[1]);store.db.prepare('UPDATE attendance SET category_snapshot=NULL WHERE worker_id=? AND date=?').run(worker.id,dates[2]);store.setAttendance({siteId:site.id,workerId:worker.id,date:dates[3],present:false});
  store.saveRestaurant({siteId:site.id,name:'새 식당',mealPrice:'9000',snackPrice:'2000',tax:'900',snackTax:'200'},restaurant.id);
  const read=()=>monthlyDirectMealSummary(store.monthlyAttendance(site.id,'2026-10')[0],store.workerMonthlyMealChecks(site.id,worker.id,'2026-10'));
  assert.deepEqual(read(),{meals:1,snacks:1,base:6000,total:null,missingTax:1,unknown:1});
  store.saveMealCheck({siteId:site.id,workerId:worker.id,date:dates[0],restaurantId:restaurant.id,kind:'snack'});
  assert.deepEqual(read(),{meals:1,snacks:1,base:7000,total:7700,missingTax:0,unknown:1});
  assert.deepEqual(monthlyDirectMealSummary({units:[]},[]),{meals:0,snacks:0,base:0,total:0,missingTax:0,unknown:0});
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(source,/monthlyDirectMealSummary\(selectedWorker,monthChecks\)/);assert.match(source,/부가세 포함/);assert.match(source,/출역 취소 날짜는 제외/);
 }finally{store.close();}
});
