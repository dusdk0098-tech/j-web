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
import {PNG} from 'pngjs';

const input=siteId=>({siteId,category:'2',date:'2026-10-29',description:'가상 장갑',note:'가상 비고',unitPrice:'1000',quantity:'2',unit:'개'});
test('사용내역 수정은 변경 충돌을 막고 기존 월간 문서와 사진을 보존한다',()=>{
  const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),original=s.createSafetyCost(input(site.id)),image=new PNG({width:1,height:1});image.data[3]=255;const photo=s.addSafetyCostPhoto(site.id,original.id,'가상.png',PNG.sync.write(image));const report=s.createSafetyCostReport({siteId:site.id,month:'2026-10',date:'2026-10-31',periodFrom:'2026-01-01',periodTo:'2026-12-31',contractAmount:'10000',budget:'3000',progressAmount:'1500',progress:'50'}),update={...input(site.id),description:'수정 장갑',unitPrice:'1200',quantity:'2.5',expected:{...original}},saved=s.updateSafetyCost(original.id,update);assert.equal(saved.amount,'3000');assert.equal(s.safetyCostPhotos(site.id,original.id)[0].id,Number(photo));assert.equal(s.safetyCostReportPhotos(report.id)[0].cost_id,original.id);assert.equal(JSON.parse(s.document(report.id).details).rows[0].description,'가상 장갑');assert.throws(()=>s.updateSafetyCost(original.id,update),/변경/);assert.throws(()=>s.updateSafetyCost(original.id,{...update,siteId:other.id,expected:saved}),/현장/);assert.throws(()=>s.updateSafetyCost(original.id,{...update,unitPrice:'bad',expected:saved}));assert.equal(s.safetyCosts(site.id,'2026-10').total,'3000');assert.throws(()=>s.updateSafetyCost(original.id,{...update,expected:saved},()=>{throw Error('세션 만료');}),/세션 만료/);assert.equal(s.safetyCosts(site.id,'2026-10').rows[0].description,'수정 장갑');
  }finally{s.close();}
});

test('사용내역 수정 화면은 표시한 내역을 함께 전송한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split(/\r?\n/).find(row=>row.includes("content.querySelectorAll('[data-cost-edit]')")),button={dataset:{costEdit:'7'}},row={id:7,category:2,date:'2026-10-29',description:'가상 장갑',note:'가상',unit_price:'1000',quantity:'2',unit:'개',amount:'2000'},calls=[];let save,markup;const state={siteId:1,page:'safety-costs',costMonth:'2026-10'},context={state,siteId:1,month:'2026-10',today:()=>'',data:{rows:[row]},costCategories:['가상 하나','가상 둘'],content:{querySelectorAll:()=>[button]},esc:String,field:(name,label,value)=>'<input name="'+name+'" value="'+value+'">',showDialog:(_title,html,handler)=>{markup=html;save=handler;},api:async(path,options)=>{calls.push({path,options});}};assert.ok(line);runInNewContext(line,context);button.onclick();assert.match(markup,/가상 장갑/);await save({unitPrice:'1200'});assert.equal(calls[0].path,'/api/safety-costs/7');assert.deepEqual(JSON.parse(calls[0].options.body).expected,row);state.siteId=2;assert.throws(()=>save({}),/변경/);assert.equal(calls.length,1);
});

test('사용내역 수정 API는 관리자 인증과 오래된 내용을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-edit-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상'},admin)).json(),cost=await (await call('/api/safety-costs','POST',input(site.id),admin)).json(),path='/api/safety-costs/'+cost.id,change={...input(site.id),unitPrice:'1200',expected:cost};assert.equal((await call(path,'PUT',change)).status,401);assert.equal((await call(path,'PUT',change,admin)).status,200);assert.equal((await call(path,'PUT',change,admin)).status,409);assert.equal((await (await call('/api/safety-costs?siteId='+site.id+'&month=2026-10','GET',null,admin)).json()).total,'2400');
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
