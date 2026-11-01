import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRestrictedMonthEditor,monthDates} from '../public/restricted-month-editor.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

// shortcut: 가상 DOM에서 이벤트·요청·입력 보존을 검증하며 실제 화면 배치와 키보드 이동은 브라우저 검증이 필요하다.
export function editorScreen({rows,api,current=()=>true,month='2024-02',siteId=1}){
  let html='',cells=[];
  const save={disabled:false},status={textContent:''};
  const root={get innerHTML(){return html;},set innerHTML(value){html=value;cells=[...value.matchAll(/<td data-month-cell data-worker="(\d+)" data-date="([^"]+)" data-present="([^"]+)" data-units="([^"]*)">/g)].map(([,worker,date,present,units])=>{const checkbox={checked:present==='true',disabled:false},number={value:units,disabled:present!=='true'};return {dataset:{worker,date,present,units},querySelector:selector=>selector.includes('checkbox')?checkbox:number};});save.disabled=false;},querySelector:selector=>selector==='[data-month-save]'?save:status,querySelectorAll:selector=>selector==='[data-month-cell]'?cells:[save,...cells.flatMap(cell=>[cell.querySelector('checkbox'),cell.querySelector('number')])]};
  const editor=mountRestrictedMonthEditor({root,rows,month,siteId,api,current});
  return {root,editor,save:()=>save.onclick(),status,cell:(worker,date)=>cells.find(cell=>cell.dataset.worker===String(worker)&&cell.dataset.date===date),change(worker,date,present,units){const cell=this.cell(worker,date);cell.querySelector('checkbox').checked=present;cell.querySelector('number').value=units;cell.querySelector('checkbox').onchange();}};
}
const workers=()=>[1,2].map(id=>({id,name:'가상 '+id,days:[],units:[],version:'version-'+id,dayVersions:{}}));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};

test('월 날짜 경계와 민감정보 제외 및 여러 근로자 원자 저장',async()=>{
  assert.equal(monthDates('2024-02').length,29);assert.equal(monthDates('2026-02').length,28);assert.equal(monthDates('2026-12').at(-1),'2026-12-31');assert.equal(monthDates('0001-02').length,28);
  for(const bad of ['0000-01','2024-00','2024-13','2024-2','x'])assert.throws(()=>monthDates(bad));
  const calls=[],rows=workers();rows[0].phone='sensitive-phone';rows[0].salary_amount='secret-pay';
  const ui=editorScreen({rows,api:async(path,options)=>{calls.push({path,options});return path.includes('/cells')?{updated:2}:rows;}});
  assert.doesNotMatch(ui.root.innerHTML,/sensitive-phone|secret-pay/);assert.match(ui.root.innerHTML,/role="region"/);assert.match(ui.root.innerHTML,/2024-02-29 공수/);
  ui.change(1,'2024-02-29',true,'0.75');ui.change(2,'2024-02-01',true,'1');assert.equal(ui.editor.dirty(),true);await ui.save();
  const body=JSON.parse(calls[0].options.body);assert.equal(body.changes.length,2);assert.equal(body.changes[0].expectedVersion,'version-1');assert.equal(body.changes[0].expectedDayVersion,0);assert.equal(body.month,'2024-02');assert.equal(calls.length,2);assert.equal(ui.editor.dirty(),false);assert.match(ui.status.textContent,/전체를 저장/);
});
test('409·403·401·장애에서 모든 행 입력 보존, 유효하지 않은 공수는 요청 금지',async()=>{
  for(const message of ['409 충돌','403 권한','401 만료','연결 실패']){
    let calls=0;const ui=editorScreen({rows:workers(),api:async()=>{calls++;throw Error(message);}});
    ui.change(1,'2024-02-29',true,'0.75');ui.change(2,'2024-02-01',true,'9.99');await ui.save();
    assert.equal(calls,1);assert.equal(ui.editor.dirty(),true);assert.equal(ui.cell(1,'2024-02-29').querySelector('number').value,'0.75');assert.equal(ui.cell(2,'2024-02-01').querySelector('number').value,'9.99');assert.match(ui.status.textContent,/입력을 보존/);
    ui.change(1,'2024-02-29',true,'10');await ui.save();assert.equal(calls,1);
    ui.change(1,'2024-02-29',true,'');ui.cell(1,'2024-02-29').querySelector('number').validity={valid:false};await ui.save();assert.equal(calls,1);
  }
});
test('미출역 전환은 공수를 보내지 않으며 1000셀 초과는 입력 보존 후 차단',async()=>{
  const rows=workers();rows[0].days=['2024-02-29'];rows[0].units=[{date:'2024-02-29',units_hundredths:75}];let body;
  const ui=editorScreen({rows,api:async(path,options)=>{if(options?.body)body=JSON.parse(options.body);return rows;}});ui.change(1,'2024-02-29',false,'0.75');await ui.save();assert.equal(body.changes[0].present,false);assert.equal('units' in body.changes[0],false);
  let calls=0;const many=Array.from({length:35},(_,i)=>({...workers()[0],id:i+1})),large=editorScreen({rows:many,api:async()=>{calls++;}});
  for(const worker of many)for(const date of monthDates('2024-02'))large.change(worker.id,date,true,'1');await large.save();assert.equal(calls,0);assert.match(large.status.textContent,/1000/);assert.equal(large.editor.dirty(),true);
});
test('저장 중 중복 클릭 차단, 이전 현장·월·계정 응답 무시 및 성공 후 조회 장애 잠금',async()=>{
  for(const transition of ['현장','월','계정']){
    const wait=deferred();let active=true,calls=0;const ui=editorScreen({rows:workers(),current:()=>active,api:async()=>{calls++;return wait.promise;}});
    ui.change(1,'2024-02-29',true,'1');const pending=ui.save();await ui.save();assert.equal(calls,1);assert.equal(ui.editor.busy(),true);active=false;wait.resolve({updated:1});await pending;assert.equal(calls,1,transition);assert.doesNotMatch(ui.status.textContent,/전체를 저장/);
  }
  let calls=0;const ui=editorScreen({rows:workers(),api:async()=>{if(++calls===1)return {updated:1};throw Error('조회 장애');}});
  ui.change(1,'2024-02-29',true,'');await ui.save();await ui.save();assert.equal(calls,2);assert.match(ui.status.textContent,/저장은 완료/);assert.equal(ui.cell(1,'2024-02-29').querySelector('checkbox').disabled,true);
});

test('실제 임시 HTTP + 편집 UI: 여러 근로자·버전충돌·미배정현장·권한회수',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-month-editor-')),reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const send=(path,method='GET',body,cookie,context)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(context?{'x-admin-context':context}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=async loginId=>{const result=await send('/api/login','POST',{loginId,password:'virtual-password-123'});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];};
    const admin=await login('admin'),site=await(await send('/api/sites','POST',{name:'가상 배정 현장'},admin)).json(),other=await(await send('/api/sites','POST',{name:'가상 미배정 현장'},admin)).json();
    const account=await(await send('/api/admin-accounts','POST',{loginId:'month_ui',name:'가상 관리자',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]},admin)).json();
    for(const name of ['가상 근로자 하나','가상 근로자 둘'])assert.equal((await send('/api/workers','POST',{siteId:site.id,name,category:'직영',occupation:'가상 직종'},admin)).status,201);
    const cookie=await login('month_ui'),session=await(await send('/api/session','GET',null,cookie)).json(),statuses=[];
    const api=async(path,options={})=>{const result=await fetch(`http://127.0.0.1:${port}`+path,{...options,headers:{'content-type':'application/json',cookie,'x-admin-context':session.context}}),data=await result.json();statuses.push(result.status);if(!result.ok)throw Error(data.error);return data;};
    const path=`/api/attendance/month?siteId=${site.id}&month=2024-02`,rows=await api(path),ui=editorScreen({rows,siteId:site.id,api});
    ui.change(rows[0].id,'2024-02-29',true,'0.75');ui.change(rows[1].id,'2024-02-01',true,'1.25');await ui.save();assert.match(ui.status.textContent,/전체를 저장/);
    let persisted=await api(path);assert.equal(persisted[0].units[0].units_hundredths,75);assert.equal(persisted[1].units[0].units_hundredths,125);
    ui.change(rows[0].id,'2024-02-29',true,'2');ui.change(rows[1].id,'2024-02-01',true,'3');
    assert.equal((await send('/api/attendance/units','PUT',{siteId:site.id,workerId:rows[0].id,date:'2024-02-29',units:'4'},admin)).status,200);
    await ui.save();assert.equal(statuses.at(-1),409);assert.equal(ui.cell(rows[1].id,'2024-02-01').querySelector('number').value,'3');persisted=await api(path);assert.equal(persisted[1].units[0].units_hundredths,125);
    const forbidden=editorScreen({rows:persisted,siteId:other.id,api});forbidden.change(rows[0].id,'2024-02-29',true,'5');await forbidden.save();assert.equal(statuses.at(-1),403);assert.equal(forbidden.editor.dirty(),true);
    assert.equal((await send('/api/admin-accounts/'+account.id,'PUT',{version:account.version,scope:'restricted',siteIds:[]},admin)).status,200);
    await ui.save();assert.equal(statuses.at(-1),401);assert.equal(ui.cell(rows[0].id,'2024-02-29').querySelector('number').value,'2');assert.match(ui.status.textContent,/입력을 보존/);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'));rmSync(target,{recursive:true,force:true});}
});
