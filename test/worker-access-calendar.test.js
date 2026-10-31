import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

test('휴일 달력은 첫 요일에 맞추고 저장 중 중복 요청을 막는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf("  if(state.page==='worker-access-blocks')"),to=source.indexOf("  if(state.page==='reviewers')",from);assert.ok(from>=0&&to>from);
  for(const [month,offset,days] of [['2026-11',0,30],['2026-10',4,31],['2024-02',4,29]]){
    const holiday={dataset:{holidayDate:`${month}-01`},getAttribute:()=> 'false'},end={},load={},content={innerHTML:'',querySelectorAll:selector=>selector==='[data-holiday-date]'?[holiday]:[holiday,end]},state={siteId:1,page:'worker-access-blocks',blockMonth:month},calls=[],wait={};wait.promise=new Promise(resolve=>wait.resolve=resolve);
    const context={content,state,detailEpoch:1,today:()=> '2026-11-01',esc:value=>String(value),encodeURIComponent,Date,Promise,flash:()=>{},showError:error=>{throw error;},render:async()=>{},$:selector=>({'#block-load':load,'#toggle-day-end':end}[selector]),api:async(path,options)=>{calls.push({path,options});return options?wait.promise:[];}};
    await runInNewContext(`(async()=>{${source.slice(from,to)}})()`,context);const before=content.innerHTML.split('<button type="button" data-holiday-date=')[0];assert.equal((before.match(/class="block-weekday"/g)||[]).length,7);assert.equal((before.match(/aria-hidden="true"/g)||[]).length,offset);assert.equal((content.innerHTML.match(/data-holiday-date=/g)||[]).length,days);
    const pending=holiday.onclick();end.onclick();assert.equal(calls.filter(call=>call.options).length,1);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{date:`${month}-01`,kind:'holiday',blocked:true,expectedBlocked:false});assert.equal(holiday.disabled,true);wait.resolve({});await pending;assert.equal(holiday.disabled,false);
  }
});

test('휴일 저장 대기 중 다른 관리자가 변경하면 이전 상태를 덮어쓰지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-block-calendar-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const source=pathToFileURL(join(process.cwd(),'store.js')).href,trace=`import {Store} from ${JSON.stringify(source)};const original=Store.prototype.setWorkerAccessBlock;Store.prototype.setWorkerAccessBlock=function(...args){const exec=this.db.exec;this.db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('BLOCK_LOCK\\n');return exec.call(this,sql)};try{return original.apply(this,args)}finally{this.db.exec=exec}}`,child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json();db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');db.exec('BEGIN IMMEDIATE');locked=true;
    const started=once(child.stdout,'data'),pending=call(`/api/sites/${site.id}/worker-access-blocks`,'PUT',{date:'2026-11-01',kind:'holiday',blocked:true,expectedBlocked:false},admin);pending.catch(()=>{});assert.match(String((await started)[0]),/BLOCK_LOCK/);db.prepare('INSERT INTO site_worker_blocks(site_id,date,kind) VALUES(?,?,?)').run(site.id,'2026-11-01','holiday');db.exec('COMMIT');locked=false;assert.equal((await pending).status,409);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_worker_blocks WHERE site_id=?').get(site.id).n,1);
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
