import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';

test('계획서의 장비 대책은 선택 현장·버전·사본을 검증한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상'}),other=s.createSite({name:'다른 현장'}),equipment=x=>s.createEquipment({siteId:x.id,kind:'가상 장비',model:'가상 형식',capacity:'',manufacturer:'',registration:''}),e=equipment(site),foreign=equipment(other),measure={accidentType:'유형',hazard:'가상 위험',measure:'가상 대책'},row=s.savePermitMeasure(site.id,e.id,null,measure),source={id:row.id,equipmentId:e.id,version:row.version},input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-05',details:{equipmentIds:[e.id],safetyMeasures:[{...measure,equipmentId:e.id}]},permitMeasureSources:[source]};
  const doc=s.createAuthorizedDocument(input),saved=()=>JSON.parse(s.document(doc.id).details).safetyMeasures[0];assert.equal(saved().measure,'가상 대책');assert.equal(saved().equipmentId,e.id);assert.throws(()=>s.createAuthorizedDocument({...input,details:{equipmentIds:[],safetyMeasures:input.details.safetyMeasures}}),/선택된 장비/);
  assert.throws(()=>s.createAuthorizedDocument({...input,permitMeasureSources:[{...source,equipmentId:foreign.id}]}),/현장/);
  s.savePermitMeasure(site.id,e.id,row.id,{...measure,measure:'변경된 대책',expectedVersion:row.version});assert.throws(()=>s.createAuthorizedDocument(input),error=>error.sessionStatus===409);assert.throws(()=>s.updateDocument(doc.id,{...input,expectedEditVersion:doc.edit_version}),error=>error.sessionStatus===409);assert.equal(saved().measure,'가상 대책');
  const {permitMeasureSources,...detached}=input;s.updateDocument(doc.id,{...detached,expectedEditVersion:doc.edit_version});assert.equal(saved().measure,'가상 대책');
 }finally{s.close();}
});

test('계획서 화면은 선택한 장비만 대책을 추가하고 버전을 보낸다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(line=>line.includes("documentLabel:'계획서'"));assert.ok(line);let options,selected=[],added=[];
 const state={siteId:1,page:'documents',admin:{}},form={permitMeasureSources:[],querySelector:()=>({disabled:false})},select={value:'work_plan'},dialog={open:true},context={state,siteId:1,dialog,select,siteSelect:{},editCurrent:()=>true,api:()=>{},esc:String,document:{querySelectorAll:key=>key==='[data-plan-equipment]:checked'?selected:[]},$:key=>key==='#dialog-form'?form:key==='#dialog-form button[type=submit]'?{disabled:false}:{},mountPermitMeasures:args=>{options=args;},addSafety:row=>added.push(row)};
 runInNewContext(line,context);assert.equal(options.documentLabel,'계획서');assert.throws(()=>options.addSafety({equipment_id:5,measure:'대책'}),/장비를 먼저/);selected=[{value:'5'}];options.addSafety({equipment_id:5,measure:'대책'});assert.equal(added[0].equipmentId,5);options.onSources([{id:1,equipmentId:5,version:'v'}]);assert.equal(form.permitMeasureSources[0].version,'v');assert.match(source,/data\.type==='work_plan'.*permitMeasureSources/);
});

test('임시 HTTP 서버는 계획서 대책의 인증과 오래된 목록을 검증한다',{timeout:30000},async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createServer}=await import('node:net'),{spawn}=await import('node:child_process'),{once}=await import('node:events');
 const dir=mkdtempSync(join(tmpdir(),'jweb-plan-measures-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-password-123'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);const send=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const cookie=(await send('/api/login','POST',{password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],site=await(await send('/api/sites','POST',{name:'가상'},cookie)).json(),eq=await(await send('/api/equipment','POST',{siteId:site.id,kind:'가상',model:'가상',capacity:'',manufacturer:'',registration:''},cookie)).json(),path=`/api/equipment/${eq.id}/permit-measures?siteId=${site.id}`,measure={accidentType:'가상',hazard:'가상 위험',measure:'가상 대책'},source=await(await send(path,'POST',measure,cookie)).json(),input={siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-05',details:{equipmentIds:[eq.id],safetyMeasures:[{...measure,equipmentId:eq.id}]},permitMeasureSources:[{id:source.id,equipmentId:eq.id,version:source.version}]};
  assert.equal((await send('/api/documents','POST',input)).status,401);const response=await send('/api/documents','POST',input,cookie);assert.equal(response.status,201);const doc=await response.json();assert.equal(JSON.parse(doc.details).safetyMeasures[0].measure,'가상 대책');
  const updated=await send(`/api/equipment/${eq.id}/permit-measures/${source.id}?siteId=${site.id}`,'PUT',{...measure,measure:'새 대책',expectedVersion:source.version},cookie);assert.equal(updated.status,200);assert.equal((await send('/api/documents','POST',input,cookie)).status,409);assert.equal((await send(`/api/documents/${doc.id}`,'PUT',{...input,expectedEditVersion:doc.edit_version},cookie)).status,409);const persisted=await(await send(`/api/documents/${doc.id}`,'GET',null,cookie)).json();assert.equal(JSON.parse(persisted.details).safetyMeasures[0].measure,'가상 대책');
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
