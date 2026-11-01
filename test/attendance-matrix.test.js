import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {attendanceMatrix,attendanceMatrixMarkup,attendanceEditDeadline,matchesAttendanceQuery,matchesMonthlyAttendance,directAttendanceMarkup} from '../public/attendance-matrix.js';

test('월별 직영 시험 집계는 당시 구분과 미기록·제외 일수를 보존한다',()=>{
  const html=directAttendanceMarkup([{name:'<가상>',units:[{category:'직영',units_hundredths:125,estimated_pay:150000},{category:'직영',units_hundredths:0,estimated_pay:0},{category:'직영',units_hundredths:null,estimated_pay:null},{category:'직영',units_hundredths:100,estimated_pay:null},{category:'외주',units_hundredths:900,estimated_pay:999999},{category:null,units_hundredths:900,estimated_pay:999999}]}]);
  assert.match(html,/&lt;가상&gt;/);assert.doesNotMatch(html,/<가상>/);assert.match(html,/2\.25 \(미기록 1일\)/);assert.match(html,/150000원 \(제외 2일\)/);assert.match(html,/<td>1일<\/td>/);assert.doesNotMatch(html,/999999/);assert.match(directAttendanceMarkup([]),/기록이 없습니다/);
});

test('저장된 월별 출역은 직영 시험 집계에 기록 당시 구분과 계산액을 전달한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),worker=s.createWorker({siteId:site.id,name:'가상',category:'직영',company:'가상',occupation:'목공'}),entry={siteId:site.id,workerId:worker.id,date:'2024-02-28'};s.setAttendance({...entry,present:true});s.setAttendanceUnits({...entry,units:'1.25'});s.setAttendanceDailyRate({...entry,dailyRate:'100000'});s.setAttendance({...entry,date:'2024-02-29',present:true});s.db.prepare('UPDATE attendance SET category_snapshot=? WHERE worker_id=? AND date=?').run('외주',worker.id,'2024-02-29');const html=directAttendanceMarkup(s.monthlyAttendance(site.id,'2024-02'));assert.match(html,/1\.25 \(미기록 0일\)/);assert.match(html,/125000원 \(제외 0일\)/);s.db.prepare('UPDATE attendance SET category_snapshot=NULL WHERE worker_id=? AND date=?').run(worker.id,entry.date);const missing=directAttendanceMarkup(s.monthlyAttendance(site.id,'2024-02'));assert.match(missing,/해당 없음/);assert.match(missing,/<td>1일<\/td>/);}finally{s.close();}
});

test('직영 시험 급여 합계는 월급 반복과 혼합·미기록을 구분한다',()=>{
  const fixed=amount=>({category:'직영',salary_kind:'monthly',salary_amount:amount,units_hundredths:100,estimated_pay:null}),daily={category:'직영',salary_kind:null,daily_rate:100,units_hundredths:100,estimated_pay:100},html=units=>directAttendanceMarkup([{name:'가상',units}]);
  assert.match(html([fixed(3000),fixed(3000)]),/<td>3000원<\/td>/);assert.match(html([fixed(3000),fixed(4000)]),/계산 불가: 월급 또는 연봉 금액 불일치/);assert.match(html([fixed(3000),daily]),/계산 불가: 급여 종류 혼합/);assert.match(html([{...daily,daily_rate:null,estimated_pay:null}]),/계산 불가: 급여 또는 공수 미기록/);assert.match(html([{...daily,category:'외주'}]),/해당 없음/);
});

test('월별 검색 조건은 같은 날짜의 출역 기록에 함께 적용한다',()=>{
  const worker={name:'가상',birth_date:'2000-01-02',phone:'010-1234-5678',units:[{date:'2026-11-01',category:'직영',occupation:'목공',company:'가상 A'},{date:'2026-11-02',category:'협력업체 근로자',occupation:'철근',company:'가상 B'},{date:'2026-11-03',category:null,occupation:null,company:null}]},empty={name:'미출역',units:[]},base={date:'',category:'',occupation:'',company:'',query:''};
  assert.equal(matchesMonthlyAttendance(empty,base),true);assert.equal(matchesMonthlyAttendance(empty,{...base,date:'2026-11-01'}),false);assert.equal(matchesMonthlyAttendance(worker,{...base,category:'직영',company:'가상 B'}),false);assert.equal(matchesMonthlyAttendance(worker,{...base,category:'직영',company:'가상 A',occupation:'목공',query:'0101234'}),true);assert.equal(matchesMonthlyAttendance(worker,{...base,date:'2026-11-02',category:'직영'}),false);assert.equal(matchesMonthlyAttendance(worker,{...base,date:'2026-11-03',company:'기록 없음'}),true);assert.equal(matchesMonthlyAttendance(worker,{...base,query:'다른 사람'}),false);
});

test('월별 화면의 조건 변경은 일치하는 사람만 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),from=source.indexOf("    if(monthly.length){\n      const section=content.lastElementChild,table=section.querySelector('table'),filters="),to=source.indexOf("    content.lastElementChild.querySelectorAll('tbody tr').forEach((tr,i)=>{const worker=monthly[i]",from);assert.ok(from>=0&&to>from);
  const controls=Object.fromEntries(['date','category','occupation','company','query'].map(key=>[key,{value:'',append(){}}])),status={},handlers={},filters={querySelector:selector=>selector==='#month-filter-count'?status:controls[selector.replace('#month-filter-','')],addEventListener:(name,handler)=>{handlers[name]=handler;}},rows=[{},{}],table={tBodies:[{rows}],parentElement:{before(){}}},section={querySelector:()=>table},content={lastElementChild:section},document={createElement:name=>name==='div'?filters:{}},monthly=[{name:'첫째',units:[{date:'2026-11-01',category:'직영',company:'가상 A',occupation:'목공'},{date:'2026-11-02',category:'외주',company:'가상 B',occupation:'철근'}]},{name:'둘째',units:[{date:'2026-11-01',category:'직영',company:'가상 B',occupation:'목공'}]}],dates=['2026-11-01','2026-11-02'];
  runInNewContext(source.slice(from,to),{monthly,dates,content,document,matchesMonthlyAttendance,Set,Object});assert.equal(status.textContent,'검색 결과 2명');controls.category.value='직영';controls.company.value='가상 B';handlers.change();assert.equal(rows[0].hidden,true);assert.equal(rows[1].hidden,false);assert.equal(status.textContent,'검색 결과 1명');controls.date.value='2026-11-02';handlers.change();assert.equal(status.textContent,'검색 결과 0명');
});

test('출역 검색은 가상 이름·생년월일·전화번호의 구분자를 처리한다',()=>{
  const person={name:'가상 Kim',birth_date:'2000-01-02',phone:'010-1234-5678'};for(const query of ['kim','가상','000102','2000-01-02','0101234','1234-5678'])assert.equal(matchesAttendanceQuery(person,query),true,query);for(const query of ['010999','다른 이름','---'])assert.equal(matchesAttendanceQuery(person,query),false,query);assert.equal(matchesAttendanceQuery({name:'가상',birth_date:null,phone:null},'010'),false);assert.equal(matchesAttendanceQuery(person,' '),true);
});

test('출역 조회는 가상 가입 정보와 출역 당시 분류를 별도로 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),invite=s.createInvitation(site.id),worker=s.join(invite.token,{name:'가상',category:'직영',company:'가상 업체',occupation:'목공',loginId:'search_user',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-02',phone:'010-1234-5678'}}),manual=s.createWorker({siteId:site.id,name:'미기록',category:'직영',company:'가상',occupation:'목공'}),date='2024-02-29';s.setAttendance({siteId:site.id,workerId:worker.id,date,present:true});s.db.prepare('UPDATE workers SET company=?,occupation=? WHERE id=?').run('새 소속','새 직종',worker.id);const rows=s.attendance(site.id,date),record=rows.find(row=>row.id===worker.id);assert.equal(record.company,'새 소속');assert.equal(record.attendance_company,'가상 업체');assert.equal(record.attendance_occupation,'목공');assert.equal(record.birth_date,'2000-01-02');assert.equal(record.phone,'010-1234-5678');assert.equal(rows.find(row=>row.id===manual.id).birth_date,null);assert.equal(s.monthlyAttendance(site.id,'2024-02').find(row=>row.id===worker.id).birth_date,'2000-01-02');
    s.setWorkerPermissions(site.id,worker.id,['attendance']);const delegated=s.delegatedAttendance(site.id,worker.id,date).find(row=>row.id===worker.id);assert.equal('birth_date' in delegated,false);assert.equal('phone' in delegated,false);
  }finally{s.close();}
});

test('출역 화면은 현재 정보 대신 출역일에 저장된 소속과 직종을 사용한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf('    const siteId=state.siteId,epoch=detailEpoch,date=state.attendanceDate'),to=source.indexOf("    $('#report-group').insertAdjacentHTML",from);assert.ok(from>=0&&to>from);const state={page:'attendance',siteId:1,attendanceDate:'2026-11-01',attendanceMonth:'2026-11',reportFrom:'2026-11-01',reportTo:'2026-11-01',reportGroup:'worker'},content={innerHTML:''},row={id:1,name:'가상',birth_date:'2000-01-02',company:'현재 업체',occupation:'현재 직종',category:'직영',attendance_company:'당시 업체',attendance_occupation:'당시 직종',attendance_category:'협력업체 근로자',present:1,units_hundredths:null},api=async path=>path.startsWith('/api/attendance?')?[row]:[],context={state,content,detailEpoch:1,today:()=> '2026-11-01',encodeURIComponent,Promise,api,esc:value=>String(value)};
  await runInNewContext(`(async()=>{${source.slice(from,to)}})()`,context);assert.match(content.innerHTML,/당시 업체/);assert.match(content.innerHTML,/당시 직종/);assert.match(content.innerHTML,/2000-01-02/);assert.doesNotMatch(content.innerHTML,/현재 업체/);
});

test('월별 수정 참고 날짜는 연도 경계를 포함해 다음 달 5일이다',()=>{
  assert.equal(attendanceEditDeadline('2024-02'),'2024-03-05');assert.equal(attendanceEditDeadline('2026-12'),'2027-01-05');assert.equal(attendanceEditDeadline('9999-12'),null);assert.throws(()=>attendanceEditDeadline('2026-13'),/월/);
});

test('직종·소속 표는 출역 당시 기록을 날짜별로 집계한다',()=>{
  const s=new Store(':memory:');try{const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(site,name)=>s.createWorker({siteId:site.id,name,category:'직영',company:'가상 소속',occupation:'가상 직종'}),one=make(a,'가상 1'),two=make(a,'가상 2'),other=make(b,'다른 현장'),dates=['2024-02-28','2024-02-29'];
    for(const [worker,date] of [[one,dates[0]],[one,dates[1]],[two,dates[1]],[other,dates[1]]])s.setAttendance({siteId:worker.site_id,workerId:worker.id,date,present:true});s.db.prepare('UPDATE attendance SET company_snapshot=?,occupation_snapshot=? WHERE worker_id=? AND date=?').run('이전 소속','이전 직종',one.id,dates[0]);s.db.prepare('UPDATE attendance SET company_snapshot=NULL,occupation_snapshot=? WHERE worker_id=? AND date=?').run('<가상 직종>',two.id,dates[1]);
    const monthly=s.monthlyAttendance(a.id,'2024-02'),companies=attendanceMatrix(monthly,dates,'company'),occupations=attendanceMatrix(monthly,dates,'occupation');assert.deepEqual(companies.find(row=>row.label==='이전 소속').days,[1,0]);assert.deepEqual(companies.find(row=>row.label==='가상 소속').days,[0,1]);assert.equal(companies.find(row=>row.label==='기록 없음').total,1);assert.deepEqual(occupations.find(row=>row.label==='가상 직종').days,[0,1]);assert.equal(occupations.reduce((sum,row)=>sum+row.total,0),3);assert.throws(()=>attendanceMatrix(monthly,dates,'other'),/기준/);
    const markup=attendanceMatrixMarkup(monthly,dates);assert.match(markup,/월별 직종 출역/);assert.match(markup,/월별 소속 출역/);assert.match(markup,/&lt;가상 직종&gt;/);assert.doesNotMatch(markup,/<가상 직종>/);s.setAttendance({siteId:a.id,workerId:two.id,date:dates[1],present:false});assert.equal(attendanceMatrix(s.monthlyAttendance(a.id,'2024-02'),dates,'occupation').reduce((sum,row)=>sum+row.total,0),2);
  }finally{s.close();}
});

test('출역 조회 도중 현장이 바뀌면 이전 화면을 그리지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf('    const siteId=state.siteId,epoch=detailEpoch,date=state.attendanceDate'),to=source.indexOf('    content.innerHTML=',from);assert.ok(from>=0&&to>from);let release;const waiting=new Promise(resolve=>{release=resolve;}),state={page:'attendance',siteId:1,attendanceDate:'2026-11-01',attendanceMonth:'2026-11',reportFrom:'2026-11-01',reportTo:'2026-11-01',reportGroup:'worker'},context={state,detailEpoch:1,today:()=> '2026-11-01',encodeURIComponent,Promise,api:path=>path.startsWith('/api/attendance?')?waiting:Promise.resolve([])};
  const pending=runInNewContext(`(async()=>{${source.slice(from,to)}return true;})()`,context);state.siteId=2;release([]);assert.equal(await pending,undefined);
});

test('월별 출역 수정은 화면에 표시된 기록의 확인값을 보낸다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=source.indexOf("    content.lastElementChild.querySelectorAll('tbody tr').forEach((tr,i)=>{const worker=monthly[i]"),to=source.indexOf("    content.lastElementChild.querySelectorAll('tbody tr').forEach((tr,i)=>{tr.cells[0]",from);assert.ok(from>=0&&to>from);let button,submit,request;const tr={cells:[{append(_space,node){button=node;}}]},content={lastElementChild:{querySelectorAll:()=>[tr]}},document={createElement:()=>({setAttribute(){}})},monthly=[{id:7,name:'가상',units:[],version:'a'.repeat(64)}],context={content,document,monthly,month:'2024-02',state:{siteId:1},esc:value=>String(value),field:()=>'',showDialog:(_title,_html,callback)=>{submit=callback;},api:async(path,options)=>{request={path,body:JSON.parse(options.body)};}};
  runInNewContext(source.slice(from,to),context);button.onclick();await submit({company:'가상 업체'});assert.equal(request.path,'/api/attendance/month/details');assert.equal(request.body.expectedVersion,'a'.repeat(64));assert.equal(request.body.company,'가상 업체');
});

test('월별 집계 스크립트는 서버에서 제공된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-attendance-matrix-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const response=await fetch(`http://127.0.0.1:${port}/attendance-matrix.js`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/attendanceMatrixMarkup/);}finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
