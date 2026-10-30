import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';
import { CommonWork } from '../common-work.js';
import { normalizeRichText,richTextToPlain,richTextToHTML } from '../public/rich-text.js';

const rich=[{type:'p',children:[{type:'text',value:'가상 '},{type:'strong',children:[{type:'text',value:'위험'}]},{type:'text',value:' <script>alert</script>'},{type:'a',href:'https://example.test/?a=1&b=2',children:[{type:'text',value:'링크'}]}]},{type:'ul',children:[{type:'li',children:[{type:'text',value:'첫 항목'}]},{type:'li',children:[{type:'text',value:'두 항목'}]}]}];
const input={date:'2026-10-30',title:'가상 업무',category:'공정회의',process:'가상 공정',status:'published'};

test('서식 있는 본문은 허용된 구조만 표시하고 검색 가능한 문자를 보존한다',()=>{
  const normalized=normalizeRichText(rich),plain=richTextToPlain(normalized),html=richTextToHTML(normalized);
  assert.equal(plain,'가상 위험 <script>alert</script>링크\n첫 항목\n두 항목');
  assert.match(html,/<strong>위험<\/strong>/);assert.match(html,/<ul><li>첫 항목<\/li><li>두 항목<\/li><\/ul>/);assert.match(html,/&lt;script&gt;alert&lt;\/script&gt;/);assert.match(html,/href="https:\/\/example\.test\/\?a=1&amp;b=2"/);assert.doesNotMatch(html,/<script>/);
  for(const invalid of [[{type:'script',children:[]}],[{type:'text',value:'가상',onclick:'alert(1)'}],[{type:'a',href:'javascript:alert(1)',children:[{type:'text',value:'링크'}]}],[{type:'a',href:'https://example.test/\" onmouseover=alert(1)',children:[]}],[{type:'text',value:'x'.repeat(10001)}],Array.from({length:1025},()=>({type:'br'}))])assert.throws(()=>normalizeRichText(invalid));
  let deep={type:'text',value:'가상'};for(let i=0;i<18;i++)deep={type:'strong',children:[deep]};assert.throws(()=>normalizeRichText([deep]));
});

test('이전 일반 본문과 새 서식은 수정과 재시작 후에도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-common-rich-')),file=join(dir,'test.sqlite');let s;
  try{
    s=new Store(file);const site=s.createSite({name:'가상 현장'});s.db.exec("CREATE TABLE common_work (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),author_id INTEGER REFERENCES reviewers(id),date TEXT NOT NULL,category TEXT NOT NULL,process TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published')),version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    s.db.prepare("INSERT INTO common_work(site_id,date,category,process,title,content,status,version) VALUES(?,?,?,?,?,?,'published','legacy')").run(site.id,input.date,input.category,input.process,'이전 가상 업무','이전 일반 내용');
    let work=new CommonWork(s.db),legacy=work.list(site.id,{q:'이전 일반'})[0];assert.equal(legacy.content,'이전 일반 내용');assert.equal(legacy.rich_content,null);
    legacy=work.update(site.id,legacy.id,{...input,title:legacy.title,content:legacy.content,version:legacy.version});assert.equal(legacy.rich_content,null);
    let item=work.create(site.id,{...input,richContent:rich});assert.deepEqual(item.rich_content,normalizeRichText(rich));assert.equal(item.content,richTextToPlain(rich));assert.deepEqual(work.list(site.id,{q:'위험'}).map(row=>row.id),[item.id]);
    assert.throws(()=>work.update(site.id,item.id,{...input,content:'다른 내용',version:item.version}),error=>error.sessionStatus===409);
    item=work.update(site.id,item.id,{...input,content:item.content,version:item.version});assert.deepEqual(item.rich_content,normalizeRichText(rich));
    assert.throws(()=>work.update(site.id,item.id,{...input,richContent:[{type:'script',children:[]}],version:item.version}));assert.deepEqual(work.get(site.id,item.id).rich_content,normalizeRichText(rich));
    const id=item.id;s.close();s=null;s=new Store(file);work=new CommonWork(s.db);assert.deepEqual(work.get(site.id,id).rich_content,normalizeRichText(rich));assert.equal(work.get(site.id,legacy.id).content,'이전 일반 내용');
  }finally{if(s)s.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('공통업무 서식 API는 현장·권한·입력 검증과 검색을 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-common-rich-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),data={...input,siteId:site.id,richContent:rich};
    assert.equal((await send('/api/common-work','POST',data)).status,401);const created=await send('/api/common-work','POST',data,admin);assert.equal(created.status,201);const item=await created.json();assert.deepEqual(item.rich_content,normalizeRichText(rich));
    const rows=await (await send(`/api/common-work?siteId=${site.id}&q=${encodeURIComponent('위험')}`,'GET',undefined,admin)).json();assert.equal(rows.length,1);assert.deepEqual(rows[0].rich_content,normalizeRichText(rich));assert.deepEqual(await (await send(`/api/common-work?siteId=${other.id}`,'GET',undefined,admin)).json(),[]);
    assert.equal((await send('/api/common-work','POST',{...data,richContent:[{type:'a',href:'javascript:alert(1)',children:[]}]},admin)).status,400);assert.equal((await send(`/api/common-work/${item.id}`,'PUT',{...input,siteId:site.id,content:'새 내용',version:item.version},admin)).status,409);
    const viewer=await (await send('/api/reviewers','POST',{siteId:site.id,loginId:'common_rich_viewer',name:'가상 계정',password:'virtual-password-123'},admin)).json(),viewerCookie=(await send('/api/reviewer/login','POST',{loginId:viewer.login_id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await send('/api/reviewer/common-work','GET',undefined,viewerCookie)).json())[0].rich_content,normalizeRichText(rich));assert.equal((await send(`/api/reviewer/common-work/${item.id}`,'PUT',{...input,richContent:rich,version:item.version},viewerCookie)).status,400);
    const revised=[{type:'p',children:[{type:'em',children:[{type:'text',value:'수정된 가상 본문'}]}]}],updated=await send(`/api/common-work/${item.id}`,'PUT',{...input,siteId:site.id,richContent:revised,version:item.version},admin);assert.equal(updated.status,200);assert.deepEqual((await updated.json()).rich_content,normalizeRichText(revised));assert.equal((await (await send(`/api/common-work?siteId=${site.id}&q=${encodeURIComponent('수정된')}`,'GET',undefined,admin)).json()).length,1);
    assert.equal((await send('/rich-text.js')).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
