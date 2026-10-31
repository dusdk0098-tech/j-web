import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('자동 식대 설정이 저장 잠금을 기다리는 중 관리자가 만료되면 설정을 보존한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-meal-session-')),flag=join(dir,'expired'),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const storeUrl=pathToFileURL(join(process.cwd(),'store.js')).href,authUrl=pathToFileURL(join(process.cwd(),'auth.js')).href,trace=`import {existsSync} from 'node:fs';import {Store} from ${JSON.stringify(storeUrl)};import {LocalAuth} from ${JSON.stringify(authUrl)};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(...args){return existsSync(${JSON.stringify(flag)})?false:valid.apply(this,args)};const original=Store.prototype.saveMealDefaults;Store.prototype.saveMealDefaults=function(...args){process.stdout.write('MEAL_STARTED\\n');return original.apply(this,args)};`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),restaurant=await (await send('/api/restaurants','POST',{siteId:site.id,name:'가상 식당',mealPrice:'5000',snackPrice:'1000',tax:'0'},admin)).json();
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');
    for(const group of ['direct','manager']){
      const table=group==='direct'?'meal_defaults':'manager_meal_defaults';db.prepare(`INSERT INTO ${table}(site_id,kind,restaurant_id) VALUES(?,?,?)`).run(site.id,'lunch',restaurant.id);db.exec('BEGIN IMMEDIATE');locked=true;
      const started=once(child.stdout,'data'),pending=send('/api/meal-defaults','PUT',{siteId:site.id,group,items:[{kind:'dinner',restaurantId:restaurant.id}]},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/MEAL_STARTED/);writeFileSync(flag,'expired');db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);unlinkSync(flag);assert.deepEqual(db.prepare(`SELECT kind FROM ${table} WHERE site_id=?`).all(site.id).map(row=>row.kind),['lunch']);
    }
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
