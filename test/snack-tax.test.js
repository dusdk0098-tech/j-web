import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';

test('간식 부가세는 기록 당시 값을 네 저장 경로와 명세서에 보존한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상'}),worker=s.createWorker({siteId:site.id,name:'가상',category:'직영',company:'가상',occupation:'가상'}),base={siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'},restaurant=s.saveRestaurant(base),input={siteId:site.id,workerId:worker.id,kind:'snack',restaurantId:restaurant.id};
  s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-01',present:true});s.saveMealCheck({...input,date:'2026-10-01'});assert.equal(s.mealChecks(site.id,'2026-10-01')[0].tax_snapshot,null);
  assert.equal(s.saveRestaurant({...base,snackTax:'100'},restaurant.id).snack_tax,100);assert.equal(s.saveRestaurant(base,restaurant.id).snack_tax,100);assert.throws(()=>s.saveRestaurant({...base,snackTax:'-1'},restaurant.id),/간식 부가세/);
  s.saveMealDefaults(site.id,[{kind:'snack',restaurantId:restaurant.id}]);s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-02',present:true});assert.equal(s.mealChecks(site.id,'2026-10-02')[0].tax_snapshot,100);
  s.saveMealDefaults(site.id,[]);s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-03',present:true});s.saveMealCheck({...input,date:'2026-10-03'});
  s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-04',present:true});s.setDailyMealChecks({siteId:site.id,date:'2026-10-04',restaurantId:restaurant.id,changes:[{workerId:worker.id,kind:'snack',selected:true,expected:null}]});
  s.setAttendance({siteId:site.id,workerId:worker.id,date:'2026-10-05',present:true});assert.equal(s.setWorkerMonthlyMeals({...input,month:'2026-10',present:true}),1);
  s.saveRestaurant({...base,snackTax:'200'},restaurant.id);for(const day of ['02','03','04','05'])assert.equal(s.mealChecks(site.id,'2026-10-'+day)[0].tax_snapshot,100);assert.equal(s.mealChecks(site.id,'2026-10-01')[0].tax_snapshot,null);
  const groups=s.mealStatement(site.id,'2026-10').groups.filter(g=>g.kind==='snack');assert.equal(groups.find(g=>g.tax_snapshot===100).total_with_tax,4400);assert.equal(groups.find(g=>g.tax_snapshot===null).total_with_tax,null);
  assert.equal(s.saveRestaurant({...base,snackTax:''},restaurant.id).snack_tax,null);
 }finally{s.close();}
});
test('기존 식당 DB는 간식 부가세를 미기록으로 마이그레이션한다',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-snack-tax-')),path=join(dir,'data.sqlite');let s=new Store(path);try{const site=s.createSite({name:'가상'}),r=s.saveRestaurant({siteId:site.id,name:'식당',mealPrice:'5000',snackPrice:'1000',tax:'500'});s.db.exec('ALTER TABLE restaurants DROP COLUMN snack_tax');s.close();s=new Store(path);const loaded=s.restaurants(site.id).find(x=>x.id===r.id);assert.equal(loaded.snack_tax,null);assert.equal(loaded.tax,500);assert.equal(loaded.snack_price,1000);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
