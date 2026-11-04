import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mountDailyMeals} from '../public/meal-day.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('날짜별 식대 변경은 같은 현장 출역자만 원자적으로 저장한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),worker=(s,n)=>store.createWorker({siteId:s.id,name:n,category:'직영',company:'가상 업체',occupation:'가상 직종'}),a=worker(site,'가상 출역자 A'),b=worker(site,'가상 출역자 B'),foreign=worker(other,'다른 현장'),restaurant=store.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),date='2026-10-01';
    for(const w of [a,b])store.setAttendance({siteId:site.id,workerId:w.id,date,present:true});store.setAttendance({siteId:other.id,workerId:foreign.id,date,present:true});
    const change=(w,kind,selected,expected=null)=>({workerId:w.id,kind,selected,expected}),base={siteId:site.id,date,restaurantId:restaurant.id};
    assert.equal(store.setDailyMealChecks({...base,changes:[change(a,'lunch',true),change(b,'lunch',true),change(a,'snack',true)]}),3);
    let rows=store.mealChecks(site.id,date),lunch=rows.find(row=>row.worker_id===a.id&&row.kind==='lunch'),snapshot=r=>r.revision;assert.equal(lunch.tax_snapshot,500);assert.equal(rows.find(row=>row.kind==='snack').tax_snapshot,null);
    store.saveRestaurant({siteId:site.id,name:'변경 식당',mealPrice:'7000',snackPrice:'2000',tax:'700'},restaurant.id);assert.equal(store.setDailyMealChecks({...base,changes:[change(a,'lunch',true,snapshot(lunch)),change(b,'dinner',true)]}),1);assert.equal(store.mealChecks(site.id,date).find(row=>row.id===lunch.id).price,5000);
    assert.throws(()=>store.setDailyMealChecks({...base,changes:[change(a,'breakfast',true),change(foreign,'lunch',true)]}),/출역자/);assert.equal(store.mealChecks(site.id,date).some(row=>row.kind==='breakfast'),false);
    store.saveMealCheck({...base,workerId:a.id,kind:'lunch'});assert.throws(()=>store.setDailyMealChecks({...base,changes:[change(a,'lunch',false,snapshot(lunch)),change(b,'breakfast',true)]}),/변경/);assert.equal(store.mealChecks(site.id,date).some(row=>row.kind==='breakfast'),false);
    rows=store.mealChecks(site.id,date);lunch=rows.find(row=>row.worker_id===a.id&&row.kind==='lunch');assert.equal(store.setDailyMealChecks({...base,changes:[change(a,'lunch',false,snapshot(lunch))]}),1);
    assert.throws(()=>store.setDailyMealChecks({...base,changes:[change(a,'lunch',true),change(a,'lunch',true)]}),/변경 항목/);
    assert.throws(()=>store.setDailyMealChecks({...base,changes:[change(a,'lunch',true)]},()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(store.mealChecks(site.id,date).some(row=>row.worker_id===a.id&&row.kind==='lunch'),false);
  }finally{store.close();}
});

test('식대 전체 선택은 변경된 출역자만 저장하고 실패 시 입력을 보존한다',async()=>{
  const make=(dataset,checked=false)=>({dataset,checked,disabled:false}),cells=[make({worker:'1',kind:'lunch'}),make({worker:'2',kind:'lunch'},true)],all=[make({all:'lunch'})],restaurant={value:'9',disabled:false},save={disabled:false},row={id:3,worker_id:2,kind:'lunch',restaurant_id:8,restaurant_name:'기존 식당',price:5000,tax_snapshot:500,revision:'a'.repeat(32)};let sent,saved=0,error='';
  const root={innerHTML:'',querySelectorAll:selector=>selector==='[data-worker]'?cells:all,querySelector:selector=>selector==='[data-save]'?save:restaurant};
  mountDailyMeals(root,{siteId:4,date:'2026-10-01',workers:[{id:1,name:'가상 A',company:''},{id:2,name:'가상 B',company:''}],restaurants:[{id:9,name:'가상 식당'}],checks:[row],esc:String,active:()=>true,api:async(path,options)=>{sent=JSON.parse(options.body);throw Error('시험 실패');},onSaved:()=>saved++,onError:e=>{error=e.message;}});
  assert.equal(all[0].indeterminate,true);all[0].checked=true;all[0].onchange();assert.equal(cells.every(c=>c.checked),true);await save.onclick();assert.equal(sent.changes.length,1);assert.equal(sent.changes[0].workerId,1);assert.equal(sent.changes[0].expected,null);assert.equal(error,'시험 실패');assert.equal(cells[0].checked,true);assert.equal(save.disabled,false);assert.equal(saved,0);
});

test('같은 값 저장과 삭제 후 재등록도 이전 식대 화면의 저장을 거절한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 출역자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),restaurant=store.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),date='2026-10-01',base={siteId:site.id,workerId:worker.id,date,kind:'lunch',restaurantId:restaurant.id};
    store.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});store.saveMealCheck(base);let row=store.mealChecks(site.id,date)[0];assert.match(row.revision,/^[0-9a-f]{32}$/);
    const stale=revision=>({siteId:site.id,date,restaurantId:restaurant.id,changes:[{workerId:worker.id,kind:'lunch',selected:false,expected:revision}]});
    store.saveMealCheck(base);let current=store.mealChecks(site.id,date)[0];assert.notEqual(current.revision,row.revision);assert.throws(()=>store.setDailyMealChecks(stale(row.revision)),/변경/);
    row=current;store.deleteMealCheck(site.id,row.id);store.saveMealCheck(base);current=store.mealChecks(site.id,date)[0];assert.notEqual(current.revision,row.revision);assert.throws(()=>store.setDailyMealChecks(stale(row.revision)),/변경/);assert.equal(store.mealChecks(site.id,date).length,1);
  }finally{store.close();}
});

test('이전 식대 기록은 변경 번호 추가 후에도 단가와 부가세가 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meal-revision-')),path=join(dir,'jweb.sqlite');let store=new Store(path);
  try{
    const site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 출역자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),restaurant=store.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),date='2026-10-01';store.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});store.saveMealCheck({siteId:site.id,workerId:worker.id,date,kind:'lunch',restaurantId:restaurant.id});
    store.db.exec('DROP TRIGGER meal_check_created_revision; DROP TRIGGER meal_check_changed_revision; ALTER TABLE meal_checks DROP COLUMN revision');store.close();store=new Store(path);const row=store.mealChecks(site.id,date)[0];assert.equal(row.price,5000);assert.equal(row.tax_snapshot,500);assert.match(row.revision,/^[0-9a-f]{32}$/);const revision=row.revision;store.close();store=new Store(path);assert.equal(store.mealChecks(site.id,date)[0].revision,revision);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('일괄 식대 API는 로그인과 권한을 확인하며 충돌을 반환한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meal-day-')),store=new Store(join(dir,'jweb.sqlite')),site=store.createSite({name:'가상 현장'}),worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),restaurant=store.saveRestaurant({siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'500'}),date='2026-10-01';store.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),data={siteId:site.id,date,restaurantId:restaurant.id,changes:[{workerId:worker.id,kind:'lunch',selected:true,expected:null}]};
    assert.equal((await call('/meal-day.js')).status,200);assert.equal((await call('/api/meal-checks/day','POST',data)).status,401);
    const login=await call('/api/login','POST',{password:'virtual-admin-password'}),admin=login.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/admin-accounts','POST',{loginId:'limited_meal',name:'가상 제한 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]},admin)).status,201);
    const restricted=(await call('/api/login','POST',{loginId:'limited_meal',password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/meal-checks/day','POST',data,restricted)).status,403);
    const saved=await call('/api/meal-checks/day','POST',data,admin);assert.equal(saved.status,200);assert.equal((await saved.json()).changed,1);assert.equal((await call('/api/meal-checks/day','POST',data,admin)).status,409);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
