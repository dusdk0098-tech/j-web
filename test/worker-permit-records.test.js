import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PNG} from 'pngjs';
import {Store} from '../store.js';

test('근로자는 자기 허가서 점검과 연장을 현재 권한과 세션으로만 조회한다',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-permit-worker-')),db=join(dir,'jweb.sqlite'),store=new Store(db),site=store.createSite({name:'가상 현장'}),token=store.createInvitation(site.id).token,password='virtual-password-123';
 const create=id=>store.join(token,{name:id,category:'직영',occupation:'목공',loginId:id,password,acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),one=create('permit_record_one'),two=create('permit_record_two');
 store.setWorkerPermissions(site.id,one.id,['work_plan']);store.setWorkerPermissions(site.id,two.id,['work_plan']);
 const doc=store.createWorkerDocument(site.id,one.id,{type:'permit',title:'가상 허가',date:'2026-11-01',details:{directWork:true,personnel:'1',periodFrom:'2026-11-01',periodTo:'2026-11-01',place:'가상',work:'가상'}});
 store.savePermitCheck(doc.id,{date:'2026-11-01',items:[{name:'가상 점검',result:'fail',action:'가상 조치'}]});const png=new PNG({width:1,height:1});png.data[3]=255;store.savePermitExtension(doc.id,{dateFrom:'2026-11-01',dateTo:'2026-11-02',signature:`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`});store.close();
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,login=async id=>{const r=await fetch(base+'/api/worker/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,loginId:id,password})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],context:(await r.json()).reportContext};},a=await login('permit_record_one'),b=await login('permit_record_two'),path=`${base}/api/worker/documents/${doc.id}/permit-records`,get=(actor,context=actor?.context)=>fetch(path,{headers:{...(actor?{cookie:actor.cookie}:{}),...(context?{'X-Worker-Report-Context':JSON.stringify(context)}:{})}});
  assert.equal((await get()).status,401);assert.equal((await get(a,b.context)).status,409);assert.equal((await get(b)).status,400);const response=await get(a);assert.equal(response.status,200);const result=await response.json();assert.equal(result.checks[0].items[0].action,'가상 조치');assert.equal(result.extensions[0].date_to,'2026-11-02');assert.equal(Object.hasOwn(result.extensions[0],'signature'),false);
  const db2=new Store(db);try{db2.setWorkerPermissions(site.id,one.id,[]);}finally{db2.close();}assert.equal((await get(a)).status,400);
 }finally{if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}rmSync(dir,{recursive:true,force:true});}
});

test('허가서 기록 화면은 내용을 이스케이프하고 닫힌 화면의 늦은 응답을 무시한다',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm'),source=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8'),start=source.indexOf("    if(doc&&type==='permit')"),end=source.indexOf("    editor.querySelector('[data-close]').onclick",start);assert.ok(start>=0&&end>start);
 const button={},target={textContent:'',innerHTML:''},panel={isConnected:true,querySelector:s=>s==='[data-load]'?button:target},pending=[];
 const context={doc:{id:1},type:'permit',document:{createElement:()=>panel},editor:{querySelector:()=>({before(){}})},section:{isConnected:true},request:1,requestNo:1,active:()=>true,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),json:()=>new Promise(resolve=>pending.push(resolve))};
 runInNewContext(source.slice(start,end),context);const first=button.onclick();pending.shift()({checks:[{date:'2026-11-01',items:[{name:'<가상>',result:'fail',action:'<조치>'}]}],extensions:[]});await first;assert.match(target.innerHTML,/&lt;가상&gt;/);assert.match(target.innerHTML,/&lt;조치&gt;/);
 const late=button.onclick();context.requestNo=2;pending.shift()({checks:[],extensions:[{date_from:'늦은 기록'}]});await late;assert.doesNotMatch(target.innerHTML,/늦은 기록/);
});
