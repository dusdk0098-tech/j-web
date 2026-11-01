import { fetchWithApprovalCycle as fetch } from './helpers/approval-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {PNG} from 'pngjs';
import {Store} from '../store.js';

const values=responsible=>({dueDate:'',completionDate:'',responsible});
const payload=(doc,responsible,batch=false)=>({siteId:doc.site_id,expectedEditVersion:doc.edit_version,...(batch?{changes:[{index:0,...values(responsible),previous:values(JSON.parse(doc.details).items[0].responsible||'')}]}:{index:0,...values(responsible)})});

test('개선 저장 DB: 같은 초·ABA·단건↔일괄 충돌과 보존·롤백',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),created=s.createDocument({siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{items:[{task:'가상 작업',...values('A')},{task:'보존 작업'}]}});
    const activity=s.saveRiskActivity(created.id,{kind:'meeting',date:'2026-10-29',place:'가상 장소',host:'가상 주관',participants:'가상 참석',content:'보존 활동'});
    s.transition(created.id,'submit');s.transition(created.id,'approve');
    const initial=s.document(created.id),cycle=s.approvalCycle(initial.id,initial.approval_cycle_id),events=s.db.prepare('SELECT * FROM events').all(),activities=s.riskActivities(initial.id);
    s.db.exec("CREATE TRIGGER freeze_risk_time AFTER UPDATE OF details ON documents BEGIN UPDATE documents SET updated_at='2026-10-29 00:00:00' WHERE id=NEW.id; END");
    for(const batch of [false,true]){
      const a=s.document(initial.id),b=s.document(initial.id),first=s.updateRiskImprovement(a.id,payload(a,'B',batch));
      assert.throws(()=>s.updateRiskImprovement(b.id,payload(b,'stale',!batch)),{sessionStatus:409});
      const restored=s.updateRiskImprovement(first.id,payload(first,'A',!batch));
      assert.equal(first.updated_at,restored.updated_at);assert.ok(restored.edit_version>b.edit_version);
      assert.throws(()=>s.updateRiskImprovement(b.id,payload(b,'stale',batch)),{sessionStatus:409});
    }
    const wrong=s.createDocument({siteId:site.id,type:'instruction',title:'다른 가상 유형',date:'2026-10-29'});assert.throws(()=>s.updateRiskImprovement(wrong.id,{siteId:site.id,expectedEditVersion:wrong.edit_version,index:0,...values('bad')}),/위험성평가/);
    const now=s.document(initial.id),before=JSON.stringify(now);
    for(const expectedEditVersion of [undefined,null,'1',-1,NaN,1.5])assert.throws(()=>s.updateRiskImprovement(now.id,{...payload(now,'bad'),expectedEditVersion}),{sessionStatus:409});
    const bad=payload(now,'bad',true);bad.changes[0].previous.responsible='wrong';assert.throws(()=>s.updateRiskImprovement(now.id,bad),{sessionStatus:409});
    assert.throws(()=>s.updateRiskImprovement(now.id,{...payload(now,'bad',true),changes:[payload(now,'bad',true).changes[0],{index:1,...values('bad'),dueDate:'invalid',previous:values('')}]}),/날짜/);
    assert.throws(()=>s.updateRiskImprovement(now.id,payload(now,'bad'),()=>{throw Object.assign(Error('취소'),{sessionStatus:401});}),{sessionStatus:401});
    assert.equal(JSON.stringify(s.document(now.id)),before);assert.deepEqual(s.approvalCycle(now.id,now.approval_cycle_id),cycle);assert.deepEqual(s.db.prepare('SELECT * FROM events').all(),events);assert.deepEqual(s.riskActivities(now.id),activities);assert.equal(activities[0].id,activity);assert.deepEqual(JSON.parse(now.details).items[1],JSON.parse(initial.details).items[1]);
  }finally{s.close();}
});

function output(child,needle){return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>{child.stdout.off('data',read);reject(Error('대기 초과 '+needle));},8000);function read(chunk){text+=chunk;if(text.includes(needle)){clearTimeout(timer);child.stdout.off('data',read);resolve();}}child.stdout.on('data',read);});}

test('개선 API: 두 관리자·ABA·권한·잠금 중 세션 취소와 서명 보존',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-risk-race-')),flag=join(dir,'revoked'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const trace=`import {existsSync} from 'node:fs';import http from 'node:http';import {Store} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'store.js')).href)};import {LocalAuth} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'auth.js')).href)};const create=http.createServer;http.createServer=function(handler){const server=create.call(this,handler);server.once('listening',()=>process.stdout.write('READY'));return server};const valid=LocalAuth.prototype.valid;LocalAuth.prototype.valid=function(token){if(existsSync(${JSON.stringify(flag)}))this.logout(token);return valid.call(this,token)};const original=Store.prototype.updateRiskImprovement;Store.prototype.updateRiskImprovement=function(...args){const exec=this.db.exec;this.db.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('RISK_LOCK');return exec.call(this,sql)};try{return original.apply(this,args)}finally{this.db.exec=exec}}`;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(trace)}`,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});let db,locked=false;
  try{
    await output(child,'READY');const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),login=async()=>(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];let admin=await login();const second=await login();
    const site=await(await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),doc=await(await send('/api/documents','POST',{siteId:site.id,type:'risk',title:'가상 평가',date:'2026-10-29',details:{items:[{task:'가상 작업',...values('A')},{task:'보존 작업'}]}},admin)).json(),path=`/api/documents/${doc.id}`,put=(input,cookie=admin)=>send(path+'/risk-improvement','PUT',input,cookie),read=async(cookie=admin)=>(await(await send(path,'GET',null,cookie)).json());
    assert.equal((await send(path+'/risk-activities','POST',{kind:'meeting',date:'2026-10-29',place:'가상 장소',host:'가상 주관',participants:'가상 참석',content:'보존 활동'},admin)).status,201);
    const png=new PNG({width:1,height:1});png.data[3]=255;const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    for(const action of ['submit','approve'])assert.equal((await send(path+'/transition','POST',{action,...(action==='approve'?{signature}:{})},admin)).status,200);
    db=new DatabaseSync(join(dir,'jweb.sqlite'));db.exec('PRAGMA busy_timeout=3000');const snapshot=()=>({events:db.prepare('SELECT * FROM events').all(),cycles:db.prepare('SELECT * FROM approval_cycles').all(),activities:db.prepare('SELECT * FROM risk_activities').all()});const saved=snapshot();assert.ok(saved.events.some(e=>e.signature?.length));
    db.exec("CREATE TRIGGER freeze_risk_api_time AFTER UPDATE OF details ON documents BEGIN UPDATE documents SET updated_at='2026-10-29 00:00:00' WHERE id=NEW.id; END");
    for(const batch of [false,true]){
      const a=await read(),b=await read(second);assert.equal((await put(payload(a,'B',batch))).status,200);assert.equal((await put(payload(b,'stale',!batch),second)).status,409);const current=await read();assert.equal((await put(payload(current,'A',!batch))).status,200);assert.equal((await read()).updated_at,current.updated_at);assert.equal((await put(payload(b,'stale',batch),second)).status,409);
    }
    const current=await read(),input=payload(current,'changed');assert.equal((await put(input,null)).status,401);assert.equal((await put({...input,expectedEditVersion:undefined})).status,409);assert.equal((await put({...input,siteId:999999})).status,400);
    for(const batch of [false,true]){const before=await read();db.exec('BEGIN IMMEDIATE');locked=true;const started=output(child,'RISK_LOCK'),pending=put(payload(before,'cancelled',batch));await started;writeFileSync(flag,'revoked');db.exec('COMMIT');locked=false;assert.equal((await pending).status,401);unlinkSync(flag);admin=await login();assert.deepEqual(await read(),before);}
    const latest=await read();const outcomes=await Promise.all([put(payload(latest,'winner')),put(payload(latest,'other',true),second)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.deepEqual(snapshot(),saved);assert.equal(JSON.parse((await read()).details).items[1].task,'보존 작업');
  }finally{if(db){if(locked)db.exec('ROLLBACK');db.close();}if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('개선 UI 실제 단건·일괄 핸들러는 조회 버전을 보내고 409에 입력을 유지한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  for(const batch of [false,true]){
    const form={elements:[],reset(){for(const input of this.elements)input.value=input.defaultValue}},body={html:'',get innerHTML(){return this.html},set innerHTML(html){this.html=html;form.elements=[...html.matchAll(/<input name="([^"]+)" value="([^"]*)">/g)].map(([,name,value])=>({name,value,defaultValue:value}));}},nodes={'#dialog-title':{},'#dialog-body':body,'#dialog-error':{},'#dialog-form':form,'#dialog-form button[type=submit]':{},'#risk-improvement-all':{}},button={dataset:{riskImprovement:'0'}},dialog={open:false,showModal(){this.open=true},close(){this.open=false}};let sent,rendered=0,rejectSave=true;
    const context={JSON,Number,Object,Error,FormData:class{constructor(target){assert.equal(target,form);return target.elements.map(input=>[input.name,input.value])}},$:key=>nodes[key],dialog,flash:()=>{},render:()=>rendered++,doc:{id:3,site_id:2,edit_version:42},rows:[{task:'가상 작업',dueDate:'2026-10-29',responsible:'기존 담당'}],esc:x=>x,field:(name,label,value)=>'<input name="'+name+'" value="'+value+'">',content:{querySelectorAll:()=>[button],querySelector:()=>({closest:()=>({insertAdjacentHTML(){}})})},api:async(path,options)=>{sent=JSON.parse(options.body);if(rejectSave)throw Object.assign(Error('변경 충돌'),{status:409});return {id:3}}};
    const dialogSource=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick"));
    const handlers=source.split('\n').filter(line=>line.includes("content.querySelectorAll('[data-risk-improvement]')")||line.includes("if(rows.length){const panel=content.querySelector('[data-risk-improvement]')")).join('\n');assert.ok(handlers);
    runInNewContext(dialogSource+'\n'+handlers,context);if(batch)nodes['#risk-improvement-all'].onclick();else button.onclick();
    const originalInputs=form.elements,html=body.innerHTML,submit=form.onsubmit,suffix=batch?'_0':'',input=name=>form.elements.find(element=>element.name===name+suffix);
    assert.equal(form.elements.length,3);assert.equal(input('responsible').value,'기존 담당');assert.equal(input('dueDate').value,'2026-10-29');
    input('responsible').value='보존 입력';input('dueDate').value='2026-11-02';input('completionDate').value='2026-11-03';const entered=form.elements.map(element=>element.value);
    await form.onsubmit({preventDefault(){},currentTarget:form});
    assert.equal(sent.expectedEditVersion,42);const change=batch?sent.changes[0]:sent;assert.equal(change.responsible,'보존 입력');assert.equal(change.dueDate,'2026-11-02');assert.equal(change.completionDate,'2026-11-03');
    assert.equal(dialog.open,true);assert.equal(nodes['#dialog-form'],form);assert.equal(form.elements,originalInputs);assert.deepEqual(form.elements.map(element=>element.value),entered);assert.equal(form.onsubmit,submit);assert.equal(body.innerHTML,html);assert.equal(nodes['#dialog-error'].textContent,'변경 충돌');assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);assert.equal(rendered,0);
    input('responsible').value='충돌 후 보완 입력';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(batch?sent.changes[0].responsible:sent.responsible,'충돌 후 보완 입력');assert.equal(dialog.open,true);assert.equal(form.elements,originalInputs);assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);
    rejectSave=false;await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(batch?sent.changes[0].responsible:sent.responsible,'충돌 후 보완 입력');assert.equal(dialog.open,false);assert.equal(rendered,1);
  }
});
