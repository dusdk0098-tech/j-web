import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.js';
import { CommonWork } from '../common-work.js';
import { mountCommonWork } from '../public/common-work-view.js';

test('작성자 선택은 같은 이름을 구분하고 보이지 않는 임시 기록을 숨긴다',()=>{
  const store=new Store(':memory:');try{
    const work=new CommonWork(store.db),site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),make=(siteId,loginId,name)=>store.createReviewer({siteId,loginId,name,password:'virtual-password-123'});
    const first=make(site.id,'author_first','가상 작성자'),second=make(site.id,'author_second','가상 작성자'),hidden=make(site.id,'author_hidden','숨은 작성자'),foreign=make(other.id,'author_foreign','다른 현장 작성자');
    const input={date:'2026-10-31',category:'공정회의',process:'가상 공정',content:'가상 내용',status:'published'};
    const firstDoc=work.create(site.id,{...input,title:'첫 작성자'},()=>{},first),secondDoc=work.create(site.id,{...input,title:'둘째 작성자'},()=>{},second),draft=work.create(site.id,{...input,title:'숨은 임시',status:'draft'},()=>{},hidden),admin=work.create(site.id,{...input,title:'관리자 기록'}),foreignDoc=work.create(other.id,{...input,title:'다른 현장'},()=>{},foreign);
    const ids=rows=>rows.map(row=>row.id).sort((a,b)=>a-b),visible=work.authors(site.id,first);
    assert.deepEqual(ids(visible.filter(row=>row.id!==null)),[first.id,second.id].sort((a,b)=>a-b));assert.equal(visible.filter(row=>row.id===null).length,1);assert.equal(visible.some(row=>row.id===hidden.id||row.id===foreign.id),false);
    assert.deepEqual(work.list(site.id,{author:String(first.id)},first).map(row=>row.id),[firstDoc.id]);assert.deepEqual(work.list(site.id,{author:String(second.id)},first).map(row=>row.id),[secondDoc.id]);
    assert.deepEqual(work.list(site.id,{author:String(hidden.id)},first),[]);assert.deepEqual(work.list(site.id,{author:String(hidden.id)},hidden).map(row=>row.id),[draft.id]);
    assert.deepEqual(work.list(site.id,{author:'admin'},first).map(row=>row.id),[admin.id]);assert.deepEqual(work.list(other.id,{author:String(foreign.id)},foreign).map(row=>row.id),[foreignDoc.id]);
    assert.deepEqual(work.list(site.id,{author:String(first.id),q:'둘째'},first),[]);assert.throws(()=>work.authors(site.id,foreign),/현장/);
    for(const author of ['0','-1','01','1e2','9007199254740992',{},[]])assert.throws(()=>work.list(site.id,{author},first),/검색/);
    store.updateReviewer(site.id,second.id,{active:false});assert.ok(work.authors(site.id,first).some(row=>row.id===second.id));assert.equal(work.list(site.id,{author:String(second.id)},first)[0].id,secondDoc.id);
  }finally{store.close();}
});

test('공통업무 화면은 작성자를 선택해 검색하고 사라진 선택을 보존한다',async()=>{
  let authors=[{id:7,name:'가상 <작성자>'},{id:8,name:'가상 <작성자>'},{id:null,name:'관리자 시험 기록'}],html='',controls={};const requests=[];
  const target={isConnected:true,set innerHTML(value){html=value;controls={'[data-work-form]':{elements:{status:{querySelector:()=>({})}}},'[data-work-status]':{},'[data-work-cancel]':{},'[data-rich-editor]':{ownerDocument:{}},'[data-rich-toolbar]':{},'[data-work-search]':{},'[data-work-from]':{value:''},'[data-work-to]':{value:''},'[data-work-category]':{value:''},'[data-work-process]':{value:''},'[data-work-author]':{value:''},'[data-work-query]':{value:''},'[data-work-select-all]':{},'[data-work-preview]':{},'[data-work-print]':{}};},querySelector(selector){return controls[selector];},querySelectorAll(){return [];}};
  const api=async path=>{const url=new URL(path,'http://example.test');requests.push(url);return url.pathname.endsWith('/authors')?authors:[];};
  await mountCommonWork({target,base:'/api/reviewer/common-work',siteId:3,actorId:7,api});assert.match(html,/가상 &lt;작성자&gt; · 계정 7/);assert.doesNotMatch(html,/가상 <작성자>/);
  controls['[data-work-author]'].value='7';controls['[data-work-query]'].value='가상 검색';controls['[data-work-search]'].onclick();await new Promise(resolve=>setImmediate(resolve));
  const selected=requests.filter(url=>url.pathname==='/api/reviewer/common-work').at(-1);assert.equal(selected.searchParams.get('author'),'7');assert.equal(selected.searchParams.get('q'),'가상 검색');assert.match(html,/<option value="7" selected>/);
  authors=authors.filter(item=>item.id!==7);controls['[data-work-author]'].value='7';controls['[data-work-search]'].onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.match(html,/<option value="7" selected>선택한 작성자 \(현재 조회 불가\)<\/option>/);
});

test('관리자와 직원 API는 각자 볼 수 있는 공통업무 작성자만 검색한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-work-authors-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base='http://127.0.0.1:'+port,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const make=async(siteId,loginId,name)=>{const response=await call('/api/reviewers','POST',{siteId,loginId,name,password:'virtual-password-123'},admin);assert.equal(response.status,201);const person=await response.json(),login=await call('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'});assert.equal(login.status,200);return {...person,cookie:login.headers.get('set-cookie').split(';')[0]};};
    const first=await make(site.id,'first_writer','같은 가상 이름'),second=await make(site.id,'second_writer','같은 가상 이름'),hidden=await make(site.id,'hidden_writer','비공개 가상 이름'),foreign=await make(other.id,'foreign_writer','다른 현장 작성자');
    const input={date:'2026-10-31',category:'공정회의',process:'가상 공정',content:'가상 내용',status:'published'};
    const create=async(cookie,title,status='published')=>{const response=await call('/api/reviewer/common-work','POST',{...input,title,status},cookie);assert.equal(response.status,201);return response.json();};
    const a=await create(first.cookie,'첫 작성자'),b=await create(second.cookie,'둘째 작성자'),draft=await create(hidden.cookie,'숨은 임시','draft'),outside=await create(foreign.cookie,'다른 현장');
    const adminResponse=await call('/api/common-work','POST',{...input,title:'관리자 기록',siteId:site.id},admin);assert.equal(adminResponse.status,201);const adminDoc=await adminResponse.json();
    assert.equal((await call('/api/reviewer/common-work/authors')).status,401);assert.equal((await call('/api/common-work/authors?siteId='+site.id)).status,401);
    const options=await (await call('/api/reviewer/common-work/authors?siteId='+other.id,'GET',undefined,first.cookie)).json();assert.deepEqual(options.filter(item=>item.id!==null).map(item=>item.id).sort((x,y)=>x-y),[first.id,second.id].sort((x,y)=>x-y));assert.equal(options.filter(item=>item.name==='같은 가상 이름').length,2);assert.equal(options.some(item=>'login_id' in item),false);
    assert.equal(options.some(item=>item.id===hidden.id||item.id===foreign.id),false);assert.equal(options.filter(item=>item.id===null).length,1);
    const adminOptions=await (await call('/api/common-work/authors?siteId='+site.id,'GET',undefined,admin)).json();assert.ok(adminOptions.some(item=>item.id===hidden.id));assert.equal(adminOptions.some(item=>item.id===foreign.id),false);
    const list=async(cookie,author,q='')=>(await call('/api/reviewer/common-work?author='+encodeURIComponent(author)+'&q='+encodeURIComponent(q),'GET',undefined,cookie)).json();
    assert.deepEqual((await list(first.cookie,String(first.id))).map(item=>item.id),[a.id]);assert.deepEqual((await list(first.cookie,String(second.id))).map(item=>item.id),[b.id]);assert.deepEqual(await list(first.cookie,String(hidden.id)),[]);
    assert.deepEqual((await list(hidden.cookie,String(hidden.id))).map(item=>item.id),[draft.id]);assert.deepEqual((await list(first.cookie,'admin')).map(item=>item.id),[adminDoc.id]);assert.deepEqual(await list(first.cookie,String(first.id),'둘째'),[]);
    assert.deepEqual((await list(foreign.cookie,String(foreign.id))).map(item=>item.id),[outside.id]);assert.equal((await call('/api/reviewer/common-work?author=1e2','GET',undefined,first.cookie)).status,400);
    const selected=rows=>rows.map(row=>({id:row.id,version:row.version})),preview=(cookie,items)=>call('/api/reviewer/common-work/preview','POST',{siteId:other.id,items},cookie);
    assert.equal((await preview(undefined,selected([a]))).status,401);const shown=await preview(first.cookie,selected([b,a]));assert.equal(shown.status,200);const result=await shown.json();assert.equal(result.siteName,'가상 현장');assert.deepEqual(result.items.map(item=>item.id),[b.id,a.id]);
    assert.equal((await preview(first.cookie,selected([draft]))).status,400);assert.equal((await preview(first.cookie,selected([outside]))).status,400);assert.equal((await preview(foreign.cookie,selected([a]))).status,400);
    assert.equal((await preview(first.cookie,selected([a,a]))).status,400);assert.equal((await preview(first.cookie,[])).status,400);assert.equal((await preview(first.cookie,Array.from({length:21},(_,id)=>({id:id+1,version:'가상'})))).status,400);
    const adminPreview=await call('/api/common-work/preview','POST',{siteId:site.id,items:selected([draft,adminDoc])},admin);assert.equal(adminPreview.status,200);assert.deepEqual((await adminPreview.json()).items.map(item=>item.id),[draft.id,adminDoc.id]);
    assert.equal((await call('/api/reviewer/common-work/'+a.id+'/comments','POST',{version:a.version,content:'새 시험 의견'},second.cookie)).status,201);assert.equal((await preview(first.cookie,selected([a]))).status,409);
    const latest=(await list(first.cookie,String(first.id)))[0],updated=await preview(first.cookie,selected([latest]));assert.equal(updated.status,200);assert.equal((await updated.json()).items[0].comments[0].content,'새 시험 의견');
    const upload=await fetch(base+'/api/reviewer/common-work/'+a.id+'/files?version='+encodeURIComponent(latest.version),{method:'POST',headers:{cookie:first.cookie,'x-file-name':'virtual.txt'},body:'가상 첨부'});assert.equal(upload.status,201);
    const withFile=(await list(first.cookie,String(first.id)))[0],filePreview=await preview(first.cookie,selected([withFile]));assert.equal(filePreview.status,200);assert.deepEqual((await filePreview.json()).items[0].files.map(item=>item.name),['virtual.txt']);
    const asset=await call('/common-work-print.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
