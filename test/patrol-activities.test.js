import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';
import {patrolActivityRow,readPatrolActivities,patrolActivitiesSummary} from '../public/patrol-activities.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const activity={inspector:' 가상 점검자 ',timeFrom:'15:20',timeTo:'09:10',content:'',action:' 가상 조치 '};
test('점검 활동을 검증하고 구형 수정과 결재 당시 사본을 보존한다',()=>{
 const s=new Store(':memory:');try{const site=s.createSite({name:'가상'}),input={siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-11-03',details:{items:[],patrolActivities:[activity]}},doc=s.createDocument(input),read=()=>JSON.parse(s.document(doc.id).details),saved=read().patrolActivities[0];assert.deepEqual(saved,{inspector:'가상 점검자',content:'없음',action:'가상 조치',timeFrom:'09:10',timeTo:'15:20'});
 for(const bad of [{...activity,inspector:''},{...activity,timeFrom:'24:30'},{...activity,timeTo:''},{...activity,content:1}])assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:[bad]}}),/점검 활동/);
 assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:Array(101).fill(activity)}}),/점검 활동/);s.updateDocument(doc.id,{...input,details:{items:[]}});assert.deepEqual(read().patrolActivities,[saved]);s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:[]}});assert.deepEqual(read().patrolActivities,[]);assert.deepEqual(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).patrolActivities,[saved]);
 }finally{s.close();}
});
test('활동 입력·읽기·상세는 모든 필드와 특수문자를 보존한다',()=>{
 const row={inspector:'가상 <점검자>',timeFrom:'09:00',timeTo:'12:00',content:'가상 <내용>',action:'가상 <조치>'},markup=patrolActivityRow(row,esc);assert.match(markup,/가상 &lt;점검자&gt;/);assert.match(markup,/data-patrol-activity-remove/);assert.match(markup,/type="time"/);const domRow={querySelector:selector=>({value:row[selector.match(/"(.*?)"/)[1]]})};assert.deepEqual(readPatrolActivities({querySelectorAll:()=>[domRow]}),[row]);const html=patrolActivitiesSummary([row],esc);for(const value of ['가상 &lt;점검자&gt;','가상 &lt;내용&gt;','가상 &lt;조치&gt;','09:00','12:00'])assert.ok(html.includes(value));assert.doesNotMatch(html,/<점검자>|<내용>|<조치>/);
 let approved=false;const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(s=>s.includes('const activityList=')),container={count:0,html:'',querySelectorAll(){return Array(this.count).fill(1);},insertAdjacentHTML(_where,html){this.html+=html;this.count++;},addEventListener(_type,fn){this.click=fn;},contains:()=>true},add={},error={};runInNewContext(line,{$:key=>({'#patrol-activities':container,'#patrol-activity-add':add,'#dialog-error':error}[key]),patrolActivityRow,esc,confirm:()=>approved});add.onclick();assert.match(container.html,/data-patrol-activity/);let removed=false;const click=()=>container.click({target:{closest:()=>({closest:()=>({remove(){removed=true;}})})}});click();assert.equal(removed,false);approved=true;click();assert.equal(removed,true);container.count=100;add.onclick();assert.match(error.textContent,/100개/);
});
test('순회 저장 중 입력을 잠그고 실패 또는 화면 이동 뒤 상태를 복원한다',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const start=source.indexOf("    const form=$('#dialog-form'),submitHandler=form.onsubmit,patrolCurrent="),end=source.indexOf('  },()=>select.value',start);
 assert.ok(start>0&&end>start);
 const body=source.slice(start,end),actor={},state={admin:actor,siteId:1,page:'documents',detail:0},controls=[{disabled:false},{disabled:false},{disabled:true}],form={onsubmit:()=>{}},dialog={open:true};
 let resolve,reject;const api=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
 const context={data:{type:'patrol'},doc:null,state,siteId:1,page:'documents',actor,detailEpoch:1,educationEpoch:1,editCurrent:()=>state.admin===actor&&state.siteId===1&&state.page==='documents',dialog,api,$:key=>key==='#dialog-form'?form:{querySelectorAll:()=>controls}};
 const run=()=>runInNewContext(`(async()=>{${body}})()`,context);
 let pending=run();assert.deepEqual(controls.map(c=>c.disabled),[true,true,true]);reject(Error('저장 실패'));await assert.rejects(pending,/저장 실패/);assert.deepEqual(controls.map(c=>c.disabled),[false,false,true]);assert.equal(state.detail,0);
 pending=run();state.siteId=2;resolve({id:55});await assert.rejects(pending,/현장이 변경/);assert.equal(state.detail,0);assert.deepEqual(controls.map(c=>c.disabled),[false,false,true]);
 state.siteId=1;pending=run();resolve({id:56});await pending;assert.equal(state.detail,56);assert.deepEqual(controls.map(c=>c.disabled),[false,false,true]);
});
test('관리자 HTTP는 활동 저장·구형 수정·사본과 파일 제공을 지원한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-patrol-activity-')),listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await send('/api/login','POST',{password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상'},cookie)).json(),input={siteId:site.id,type:'patrol',title:'가상 순회',date:'2026-11-03',details:{items:[],patrolActivities:[activity]}},doc=await(await send('/api/documents','POST',input,cookie)).json(),path=`/api/documents/${doc.id}`;assert.equal(JSON.parse(doc.details).patrolActivities[0].timeFrom,'09:10');assert.equal((await send('/patrol-activities.js')).status,200);assert.equal((await send(path,'PUT',{...input,details:{items:[]},expectedEditVersion:doc.edit_version},cookie)).status,200);const current=await(await send(path,'GET',null,cookie)).json();assert.equal(JSON.parse(current.details).patrolActivities[0].inspector,'가상 점검자');assert.equal((await send(path+'/transition','POST',{action:'submit',expectedEditVersion:current.edit_version},cookie)).status,200);const frozenDoc=await(await send(path,'GET',null,cookie)).json(),cycle=await(await send(path+'/approval-cycles/'+frozenDoc.approval_cycle_id,'GET',null,cookie)).json();assert.equal(JSON.parse(cycle.document.details).patrolActivities[0].action,'가상 조치');assert.equal((await send(path)).status,401);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
test('결재 화면에서 점검 활동에 이름과 시간을 올바른 항목명으로 표시한다',()=>{
 const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),labels=source.split('\n').find(line=>line.startsWith('const labels=')),extra=source.split('\n').find(line=>line.includes("patrolActivities:'점검 활동'")),start=source.indexOf('function displayFields('),end=source.indexOf('function displayDocumentDetails(',start),doc={patrolActivities:[{inspector:'가상 <점검자>',timeFrom:'09:00',timeTo:'10:00',content:'가상 내용',action:'가상 조치'}]};const html=runInNewContext(`${labels}\n${extra}\n${source.slice(start,end)}\ndisplayFields(doc)`,{doc,esc,selectedMusculoskeletalItems:()=>[]});for(const text of ['점검 활동','점검자','시작 시각','종료 시각','가상 &lt;점검자&gt;','가상 조치'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/<점검자>/);
});

test('합동 점검 활동은 검증·구형 수정·결재 사본에서 보존된다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상'}),input={siteId:site.id,type:'joint_inspection',title:'합동 시험',date:'2026-11-03',details:{items:[],patrolActivities:[activity]}},doc=s.createDocument(input),read=()=>JSON.parse(s.document(doc.id).details),saved=read().patrolActivities[0];
  assert.deepEqual(saved,{inspector:'가상 점검자',content:'없음',action:'가상 조치',timeFrom:'09:10',timeTo:'15:20'});
  assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:[{...activity,timeTo:''}]}}),/점검 활동/);
  assert.throws(()=>s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:Array(101).fill(activity)}}),/점검 활동/);
  s.updateDocument(doc.id,{...input,details:{items:[]}});assert.deepEqual(read().patrolActivities,[saved]);
  s.transition(doc.id,'submit');const cycle=s.document(doc.id).approval_cycle_id;s.transition(doc.id,'withdraw');s.updateDocument(doc.id,{...input,details:{items:[],patrolActivities:[]}});
  assert.deepEqual(read().patrolActivities,[]);assert.deepEqual(JSON.parse(s.approvalCycle(doc.id,cycle).document.details).patrolActivities,[saved]);
 }finally{s.close();}
});

test('합동 점검 화면에서 활동을 추가하고 저장과 상세 표시에 사용한다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(s=>s.includes("const jointActivities=$('#joint-activities')"));
 const container={count:0,html:'',querySelectorAll(){return Array(this.count).fill(1);},insertAdjacentHTML(_where,html){this.html+=html;this.count++;},addEventListener(_type,fn){this.click=fn;},contains:()=>true},add={},error={};let approved=false;
 runInNewContext(line,{$:key=>({'#joint-activities':container,'#joint-activity-add':add,'#dialog-error':error}[key]),patrolActivityRow,esc,confirm:()=>approved});add.onclick();assert.match(container.html,/data-patrol-activity/);
 let removed=false;const click=()=>container.click({target:{closest:()=>({closest:()=>({remove(){removed=true;}})})}});click();assert.equal(removed,false);approved=true;click();assert.equal(removed,true);container.count=100;add.onclick();assert.match(error.textContent,/100개/);
 const save=source.split('\n').find(s=>s.includes("if(['safety_meeting','work_council','joint_inspection'].includes(data.type))")),row={inspector:'가상 활동자',timeFrom:'09:00',timeTo:'10:00',content:'가상 활동',action:'가상 조치'},data={type:'joint_inspection',date:'2026-11-07'};
 const domRow={querySelector:selector=>({value:row[selector.match(/"(.*?)"/)[1]]})},document={querySelectorAll:selector=>selector==='[data-patrol-activity]'?[domRow]:[]};
 runInNewContext(save,{data,document,readPatrolActivities,$:selector=>({dataset:{loaded:selector==='#meeting-workers'?data.date:'yes'}})});assert.deepEqual(data.details.patrolActivities,[row]);
 const detail=source.split('\n').find(s=>s.includes("if(doc.type==='joint_inspection')content.querySelector"));assert.match(detail,/patrolActivitiesSummary\(details.patrolActivities,esc\)/);
});

test('합동 점검 활동은 HTTP 수정과 결재 사본에서 유지된다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-joint-activity-')),listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),cookie=(await send('/api/login','POST',{password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상'},cookie)).json(),input={siteId:site.id,type:'joint_inspection',title:'합동 시험',date:'2026-11-03',details:{items:[],patrolActivities:[activity]}};
  const created=await send('/api/documents','POST',input,cookie);assert.equal(created.status,201);const doc=await created.json(),path=`/api/documents/${doc.id}`;assert.equal(JSON.parse(doc.details).patrolActivities[0].content,'없음');
  assert.equal((await send(path,'PUT',{...input,details:{items:[]},expectedEditVersion:doc.edit_version},cookie)).status,200);const current=await(await send(path,'GET',null,cookie)).json();assert.equal(JSON.parse(current.details).patrolActivities[0].inspector,'가상 점검자');
  assert.equal((await send(path+'/transition','POST',{action:'submit',expectedEditVersion:current.edit_version},cookie)).status,200);const submitted=await(await send(path,'GET',null,cookie)).json(),cycle=await(await send(path+'/approval-cycles/'+submitted.approval_cycle_id,'GET',null,cookie)).json();assert.equal(JSON.parse(cycle.document.details).patrolActivities[0].action,'가상 조치');assert.equal((await send(path)).status,401);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
