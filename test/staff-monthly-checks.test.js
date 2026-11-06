import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {staffMonthlyChecksMarkup} from '../public/staff-monthly-checks.js';

test('월별 직원 점검은 현장과 월을 분리하고 휴무를 출역으로 계산하지 않는다',()=>{
 const s=new Store(':memory:');try{
  const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:'<가상 직원>',password:'virtual-password-123'}),one=make(a.id,'staff_month_a'),two=make(a.id,'staff_month_b'),other=make(b.id,'staff_month_c');
  const insert=(person,date,kind)=>s.db.prepare('INSERT INTO reviewer_manager_checks(reviewer_id,site_id,date,kind,answers,signature) VALUES(?,?,?,?,?,?)').run(person.id,person.site_id,date,kind,kind==='check'?'[]':null,kind==='check'?Buffer.from([1]):null);
  insert(one,'2024-02-28','check');insert(one,'2024-02-29','day_off');insert(two,'2024-02-29','check');insert(other,'2024-02-29','check');insert(one,'2024-03-01','check');
  const rows=s.monthlyReviewerManagerChecks(a.id,'2024-02');assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.id)).size,2);assert.ok(rows.every(row=>row.date.startsWith('2024-02')));assert.throws(()=>s.monthlyReviewerManagerChecks(b.id,'2024-13'));
  const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),html=staffMonthlyChecksMarkup(rows,['2024-02-28','2024-02-29'],esc);assert.match(html,/&lt;가상 직원&gt;/);assert.doesNotMatch(html,/<가상 직원>/);assert.match(html,/<td>점검<\/td><td>휴무<\/td><td>1<\/td><td>1<\/td>/);assert.match(html,/실제 출역/);assert.match(staffMonthlyChecksMarkup([],[],esc),/시험 기록이 없습니다/);
 }finally{s.close();}
});

test('직원 월별 점검 API는 인증과 현장 권한을 적용한다',{timeout:30000},async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createServer}=await import('node:net'),{spawn}=await import('node:child_process'),{once}=await import('node:events'),{AdminAccounts}=await import('../admin-accounts.js');
 const dir=mkdtempSync(join(tmpdir(),'jweb-staff-month-')),s=new Store(join(dir,'jweb.sqlite')),a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),person=s.createReviewer({siteId:a.id,loginId:'staff_month',name:'가상 직원',password:'virtual-password-123'}),auth=new AdminAccounts(s.db);auth.create({loginId:'global_month',name:'전체',password:'virtual-password-123',scope:'global'});auth.create({loginId:'restricted_month',name:'제한',password:'virtual-password-123',scope:'restricted',siteIds:[a.id]});s.db.prepare("INSERT INTO reviewer_manager_checks(reviewer_id,site_id,date,kind) VALUES(?,?,?,'day_off')").run(person.id,a.id,'2024-02-29');s.close();
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const call=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async id=>(await call('/api/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],admin=await login('global_month'),limited=await login('restricted_month'),path=`/api/attendance/staff-checks?siteId=${a.id}&month=2024-02`;
  assert.equal((await call('/staff-monthly-checks.js')).status,200);assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',null,limited)).status,403);const response=await call(path,'GET',null,admin);assert.equal(response.status,200);assert.deepEqual(await response.json(),[{id:person.id,name:'가상 직원',date:'2024-02-29',kind:'day_off'}]);assert.deepEqual(await(await call(`/api/attendance/staff-checks?siteId=${b.id}&month=2024-02`,'GET',null,admin)).json(),[]);assert.equal((await call(`/api/attendance/staff-checks?siteId=${a.id}&month=2024-13`,'GET',null,admin)).status,400);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
