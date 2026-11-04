import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';

test('사고 정도별 가상 보고서는 각각 저장하고 재시작 후 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-incident-guide-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),created=['경상','중상','사망'].map(severity=>s.createDocument({siteId:site.id,type:'incident',title:`가상 ${severity} 보고`,date:'2026-10-30',details:{severity}}));
    assert.deepEqual(created.map(doc=>JSON.parse(doc.details).severity),['경상','중상','사망']);assert.throws(()=>s.createDocument({siteId:site.id,type:'incident',title:'잘못된 유형',date:'2026-10-30',details:{severity:'임의 유형'}}),/사고유형/);assert.equal(s.documents(other.id,'incident').length,0);s.close();s=new Store(path);assert.deepEqual(s.documents(site.id,'incident').map(doc=>JSON.parse(doc.details).severity).sort(),['경상','사망','중상']);
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('사고 대응 안내에 공식 자료 링크와 사고 정도별 가상 문서 이동이 있다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(state.page==='incident-guide'){"),end=source.indexOf("  if(state.page==='hazards'){",start);assert.ok(start>=0&&end>start);
  let guidance='',opened;const buttons=['경상','중상','사망'].map(value=>({dataset:{incidentReport:value}})),list={},content={innerHTML:'',querySelector:()=>({insertAdjacentHTML:(_where,html)=>{guidance=html;}}),querySelectorAll:()=>buttons},context={state:{page:'incident-guide'},content,$:()=>list,editDocument:async(_doc,details,type)=>{opened={severity:details.severity,type};},showError(){},render:async()=>{}};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.match(guidance,/www\.kosha\.or\.kr/);assert.match(guidance,/href="tel:119"/);assert.match(guidance,/무리하게 진입하지/);assert.match(guidance,/1350\.moel\.go\.kr/);assert.match(guidance,/신고하거나 보고하지 않습니다/);for(const severity of ['경상','중상','사망'])assert.match(content.innerHTML,new RegExp(`<summary>${severity} 사고</summary><ol><li>`));assert.match(content.innerHTML,/구조 이후 사고 현장을 보존/);buttons[1].onclick();await Promise.resolve();assert.equal(opened.severity,'중상');assert.equal(opened.type,'incident');list.onclick();assert.equal(context.state.type,'incident');assert.equal(context.state.page,'documents');
});

test('재해 보고서는 HTTP 저장과 서버 재시작 후에도 재해자와 점검실적을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-incident-http-')),reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));let child;
  const start=async()=>{child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);};
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  const request=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  try{
    await start();let cookie=(await request('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];const site=await (await request('/api/sites','POST',{name:'가상 현장'},cookie)).json(),other=await (await request('/api/sites','POST',{name:'다른 가상 현장'},cookie)).json();
    const details={severity:'중상',location:'가상 장소',circumstances:'가상 경위',prevention:'가상 대책',victims:[{name:'가상 근로자',company:'가상 소속',occupation:'가상 직종',career:'가상 경력',outcome:'부상',treatment:'가상 치료'}],inspections:[{name:'가상 점검',date:'2026-10-01'}]},input={siteId:site.id,type:'incident',title:'가상 보고서',date:'2026-11-04',details};
    assert.equal((await request('/api/documents','POST',input)).status,401);const created=await request('/api/documents','POST',input,cookie);assert.equal(created.status,201);const doc=await created.json();assert.deepEqual(JSON.parse(doc.details).victims,details.victims);assert.deepEqual(await (await request(`/api/documents?siteId=${other.id}&type=incident`,'GET',undefined,cookie)).json(),[]);
    const invalid=await request(`/api/documents/${doc.id}`,'PUT',{...input,expectedEditVersion:doc.edit_version,details:{...details,progress:'101'}},cookie);assert.equal(invalid.status,400);assert.equal(JSON.parse((await (await request(`/api/documents/${doc.id}`,'GET',undefined,cookie)).json()).details).location,'가상 장소');
    await stop();await start();cookie=(await request('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0];const persisted=await (await request(`/api/documents/${doc.id}`,'GET',undefined,cookie)).json();assert.deepEqual(JSON.parse(persisted.details).inspections,details.inspections);assert.deepEqual(JSON.parse(persisted.details).victims,details.victims);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
