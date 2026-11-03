import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';
import {matchesMonthlyAttendance} from '../public/attendance-matrix.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fragment=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function screen(api){
  const target={innerHTML:'',textContent:''},form={},submit={},dialog={open:false,close(){this.open=false;}},state={siteId:7,admin:{id:1}},nodes={'#site-attendance-detail':target,'#site-attendance-filters':{},'#dialog-form':form,'#dialog-form button[type=submit]':submit};for(const key of ['category','occupation','company','query'])nodes[`#site-attendance-${key}`]={value:''};const context={state,detailEpoch:2,dialog,URLSearchParams,api,matchesMonthlyAttendance,$:key=>nodes[key],esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),showDialog(){dialog.open=true;for(const key of ['category','occupation','company','query'])nodes[`#site-attendance-${key}`].value='';}};
  runInNewContext(fragment('async function showSiteAttendanceDetail(', 'async function renderAllSiteStatistics('),context);return {context,target,dialog,state,nodes};
}
test('월별 상세는 선택 날짜에 출역한 사람과 월 출역일만 표시한다',async()=>{
  let path;const rows=[{name:'<가상>',company:'가상 회사',days:['2026-10-02','2026-10-04'],units:[{date:'2026-10-02',category:'직영',occupation:'목공',company:'가상 A'},{date:'2026-10-04',category:'외주',occupation:'전기',company:'가상 B'}]},{name:'다른 가상',company:'가상 회사',days:['2026-10-03'],units:[{date:'2026-10-03',category:'직영',occupation:'전기',company:'가상 A'}]},{name:'미출역',company:'가상',days:[],units:[]}],ui=screen(async value=>(path=value,rows));
  await ui.context.showSiteAttendanceDetail({id:8,name:'가상 현장'},'2026-10','02',()=>true);assert.match(path,/siteId=8&month=2026-10/);assert.match(ui.target.innerHTML,/&lt;가상&gt;/);assert.doesNotMatch(ui.target.innerHTML,/<가상>|다른 가상|미출역/);assert.match(ui.target.innerHTML,/<td>2<\/td>/);assert.match(ui.target.innerHTML,/31일/);
  await ui.context.showSiteAttendanceDetail({id:8,name:'가상 현장'},'2026-10','',()=>true);assert.match(ui.target.innerHTML,/다른 가상/);assert.doesNotMatch(ui.target.innerHTML,/미출역/);
  const category=ui.nodes['#site-attendance-category'],occupation=ui.nodes['#site-attendance-occupation'],company=ui.nodes['#site-attendance-company'],query=ui.nodes['#site-attendance-query'];category.value='직영';occupation.value='전기';company.value='가상 B';company.onchange();assert.match(ui.target.innerHTML,/출역 기록이 없습니다/);company.value='가상 A';company.onchange();assert.match(ui.target.innerHTML,/다른 가상/);assert.doesNotMatch(ui.target.innerHTML,/&lt;가상&gt;/);query.value='없는 이름';query.oninput();assert.match(ui.target.innerHTML,/출역 기록이 없습니다/);
});
test('닫힘·현장 변경·다른 창 전환 뒤 늦은 조회 결과를 표시하지 않는다',async()=>{
  for(const change of ['close','site','epoch','scope']){const wait=deferred(),ui=screen(()=>wait.promise);let scope=true;const pending=ui.context.showSiteAttendanceDetail({id:8,name:'가상'},'2026-10','',()=>scope);if(change==='close')ui.dialog.close();if(change==='site')ui.state.siteId=9;if(change==='epoch')ui.context.detailEpoch++;if(change==='scope')scope=false;wait.resolve([{name:'오래된 자료',days:['2026-10-01']}]);await pending;assert.doesNotMatch(ui.target.innerHTML,/오래된 자료/);}
});
test('통계 합계 버튼은 선택한 현장과 날짜를 전달하고 오래된 버튼을 무시한다',()=>{
  const button={dataset:{siteAttendance:'8'}},section={isConnected:true,querySelectorAll:selector=>selector==='[data-site-attendance]'?[button]:[]},sites=[{id:8,name:'가상'}],opened=[];let valid=true;const context={section,sites,month:'2026-10',day:'02',current:()=>valid,showSiteAttendanceDetail:(site,month,day)=>opened.push([site.id,month,day]),showSiteEducationDetail(){}};
  runInNewContext(fragment("  section.querySelectorAll('[data-site-education]')",'\n}'),context);button.onclick();assert.deepEqual(opened,[[8,'2026-10','02']]);valid=false;button.onclick();assert.equal(opened.length,1);
});
test('임시 서버의 월별 출역을 상세에 연결하고 다른 현장 접근을 제한한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-site-roster-')),s=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(s.db),password='virtual-password-123';auth.bootstrap(password);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),w=s.createWorker({siteId:site.id,name:'가상 사람',category:'직영',company:'가상 회사',occupation:'가상 직종'});s.setAttendance({siteId:site.id,workerId:w.id,date:'2026-10-02',present:true});s.setAttendance({siteId:site.id,workerId:w.id,date:'2026-10-04',present:true});auth.create({loginId:'limited',name:'가상 제한',password,scope:'restricted',siteIds:[other.id]});s.close();
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);const base=`http://127.0.0.1:${port}`,login=async loginId=>(await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId,password})})).headers.get('set-cookie').split(';')[0],cookie=await login('admin'),limited=await login('limited'),path=`/api/attendance/month?siteId=${site.id}&month=2026-10`;assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{headers:{cookie:limited}})).status,403);const ui=screen(async request=>{const response=await fetch(base+request,{headers:{cookie}});assert.equal(response.status,200);return response.json();});await ui.context.showSiteAttendanceDetail(site,'2026-10','02',()=>true);assert.match(ui.target.innerHTML,/가상 사람/);assert.match(ui.target.innerHTML,/<td>2<\/td>/);await ui.context.showSiteAttendanceDetail(site,'2026-10','03',()=>true);assert.match(ui.target.innerHTML,/출역 기록이 없습니다/);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
