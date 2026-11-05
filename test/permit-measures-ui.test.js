import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPermitMeasures} from '../public/permit-measures.js';
const row={id:3,equipment_id:11,version:'v1',accidentType:'가상 유형',hazard:'<script>가상 위험</script>',measure:'가상 대책'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
// shortcut: 모의 DOM 이벤트로 검증하며 브라우저 배치·키보드 접근성은 승인된 브라우저 시험에서 확인한다.
async function screen(documentLabel='허가서'){
 const nodes=new Map(),node=()=>({value:'',textContent:'',innerHTML:'',disabled:false,isConnected:true});
 const panel={...node(),querySelector(key){if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);},querySelectorAll(){return [...nodes.values()];}},host={insertAdjacentHTML(_position,html){this.html=html;},querySelector(){return panel;}},calls=[],added=[];let sources,active=true,fail=false,delay=null,rows=[{...row}];
 const api=async(path,options)=>{calls.push({path,options});if(delay){const wait=delay;delay=null;await wait.promise;}if(fail)throw Error('가상 저장 충돌');if(path.startsWith('/api/equipment?'))return [{id:11,kind:'가상 장비',model:'<img>',registration:''},{id:12,kind:'다른 장비'}];if(options?.method){if(options.method==='DELETE')rows=[];else if(options.method==='POST')rows.push({...JSON.parse(options.body),id:4,version:'v2'});else rows=[{...JSON.parse(options.body),id:3,version:'v2'}];return rows[0]||{ok:true};}return rows.map(r=>({...r}));};
 await mountPermitMeasures({host,api,siteId:7,current:()=>active,addSafety:item=>added.push({...item}),count:()=>added.length,onSources:value=>sources=value,documentLabel,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 const get=key=>panel.querySelector(`[data-measure-${key}]`),choose=async id=>{get('equipment').value=String(id);get('equipment').onchange();await tick();},action=(name,id=3)=>get('list').onclick({target:{closest:()=>({dataset:{measureAction:name,id:String(id)}})}});
 return {host,panel,calls,added,get,choose,action,sources:()=>sources,field:key=>panel.querySelector(`[data-measure-field="${key}"]`),fail:value=>{fail=value;},rows:value=>{rows=value;},stop:()=>{active=false;},delay:value=>{delay=value;}};
}

test('목록 관리 및 허가서 추가는 직접 입력 보존·이스케이프·버전 전송·연결 해제를 처리한다',async()=>{
 const ui=await screen();assert.match(ui.host.html,/독립 목록/);assert.doesNotMatch(ui.get('equipment').innerHTML,/<img>/);await ui.choose(11);assert.match(ui.get('list').innerHTML,/&lt;script&gt;/);
 ui.added.push({measure:'저장 전 직접 입력'});await ui.action('apply');assert.equal(ui.added[0].measure,'저장 전 직접 입력');assert.equal(ui.added[1].measure,'가상 대책');assert.deepEqual(ui.sources(),[{id:3,equipmentId:11,version:'v1'}]);
 await ui.action('edit');ui.field('measure').value='저장 전 목록 편집';await ui.choose(12);assert.equal(ui.get('equipment').value,'11');assert.equal(ui.field('measure').value,'저장 전 목록 편집');
 ui.fail(true);await ui.get('save').onclick();assert.equal(ui.field('measure').value,'저장 전 목록 편집');assert.match(ui.get('status').textContent,/충돌/);assert.equal(JSON.parse(ui.calls.at(-1).options.body).expectedVersion,'v1');
 ui.fail(false);await ui.get('load').onclick();assert.equal(ui.field('measure').value,'저장 전 목록 편집');await ui.get('save').onclick();assert.equal(ui.field('measure').value,'');assert.equal(ui.sources()[0].version,'v1');
 ui.get('detach').onclick();assert.deepEqual(ui.sources(),[]);assert.equal(ui.added.length,2);
 await ui.action('delete');assert.match(ui.get('list').innerHTML,/등록한 안전대책이 없습니다/);ui.field('measure').value='등록 대책';await ui.get('save').onclick();assert.equal(ui.calls.findLast(call=>call.options?.method)?.options.method,'POST');
});

test('계획서도 같은 목록의 문구와 버전을 사용한다',async()=>{
 const ui=await screen('계획서');assert.match(ui.host.html,/계획서에 사본/);await ui.choose(11);assert.match(ui.get('list').innerHTML,/계획서에 추가/);await ui.action('apply');assert.equal(ui.added[0].equipment_id,11);assert.equal(ui.sources()[0].version,'v1');assert.match(ui.get('status').textContent,/계획서에 추가/);
});

test('목록 변경·100개 제한·늦은 응답·중복 클릭은 허가서 입력을 변경하지 않는다',async()=>{
 const ui=await screen();await ui.choose(11);ui.rows([{...row,version:'changed'}]);await ui.action('apply');assert.equal(ui.added.length,0);assert.match(ui.get('status').textContent,/목록이 변경/);
 ui.rows([row]);for(let i=0;i<100;i++)ui.added.push({measure:'직접 입력'});await ui.action('apply');assert.equal(ui.added.length,100);assert.match(ui.get('status').textContent,/100개/);
 ui.added.length=0;const wait=deferred();ui.delay(wait);const pending=ui.action('apply'),calls=ui.calls.length;await ui.action('apply');assert.equal(ui.calls.length,calls);assert.equal(ui.field('measure').disabled,true);ui.stop();wait.resolve();await pending;assert.equal(ui.added.length,0);assert.deepEqual(ui.sources(),[]);
});

test('허가서 폼은 적용 버전을 본문과 함께 보내고 기존 직접 입력·이전 승인 복사 경로를 유지한다',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(app,/data\.permitMeasureSources=\$\('#dialog-form'\)\.permitMeasureSources/);assert.match(app,/permitSourceItems\(sources/);assert.match(app,/details\.safetyMeasures=\[\.\.\.document\.querySelectorAll\('\[data-permit-safety\]'\)\]/);
});
import {runInNewContext} from 'node:vm';

for(const method of ['INITIAL','GET','POST','PUT','DELETE','APPLY'])for(const change of ['닫기','현장 왕복','유형 왕복'])test(`실제 공통 API ${method}: ${change} 뒤 지연 401은 이동·입력·새 오류를 만들지 않는다`,async()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('async function api('),end=app.indexOf('function flash(',start),nodes=new Map(),redirects=[],calls=[],added=[],dialog=Object.assign(new EventTarget(),{open:true}),site=new EventTarget(),type=new EventTarget();let active=true,release,delayed=false;
 const panel={isConnected:true,querySelector(key){if(!nodes.has(key))nodes.set(key,{value:'',innerHTML:'',textContent:'',disabled:false});return nodes.get(key);},querySelectorAll(){return [...nodes.values()];}},host={insertAdjacentHTML(){},querySelector(){return panel;}},get=key=>panel.querySelector(`[data-measure-${key}]`),response=(status,data)=>({status,ok:status<400,json:async()=>data});
 const context={dialog,document:{querySelector:()=>dialog.open?dialog:null},location:{assign:path=>redirects.push(path)},fetch:async(path,options)=>{calls.push({path,options});if(delayed)return new Promise(resolve=>{release=()=>resolve(response(401,{}));});return response(200,path.startsWith('/api/equipment?')?[{id:11,kind:'가상 장비'}]:[row]);}};
 runInNewContext(app.slice(start,end),context);
 if(method==='INITIAL')delayed=true;
 const ready=mountPermitMeasures({host,api:context.api,siteId:7,current:()=>active&&dialog.open,contextTargets:[[site,'change'],[dialog,'close'],[type,'change']],addSafety:item=>added.push(item),count:()=>added.length,onSources(){},esc:String});
 let pending=ready;
 if(method!=='INITIAL'){
  await ready;get('equipment').value='11';get('equipment').onchange();await tick();
  const action=name=>get('list').onclick({target:{closest:()=>({dataset:{measureAction:name,id:'3'}})}});
  if(method==='PUT')await action('edit');
  panel.querySelector('[data-measure-field="measure"]').value='미저장 가상 대책';delayed=true;
  pending=method==='GET'?get('load').onclick():method==='POST'||method==='PUT'?get('save').onclick():action(method==='DELETE'?'delete':'apply');
 }
 assert.equal(typeof release,'function');const before=[...nodes].map(([key,node])=>[key,node.value,node.textContent,node.innerHTML]);
 if(change==='닫기'){dialog.open=false;dialog.dispatchEvent(new Event('close'));}
 else {const target=change==='현장 왕복'?site:type;active=false;target.dispatchEvent(new Event('change'));active=true;target.dispatchEvent(new Event('change'));}
 release();await pending;
 assert.deepEqual(redirects,[]);assert.deepEqual(added,[]);assert.deepEqual([...nodes].map(([key,node])=>[key,node.value,node.textContent,node.innerHTML]),before);
 assert.equal(calls.at(-1).options.method||'GET',['INITIAL','GET','APPLY'].includes(method)?'GET':method);
});
