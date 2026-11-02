import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('커뮤니티 상단 안내 HTTP는 공개 범위와 관리자 권한을 지킨다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-community-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    for(const id of ['pin_author','pin_reader'])assert.equal((await send('/api/reviewers','POST',{siteId:site.id,loginId:id,name:'가상 직원',password:'virtual-password-123'},admin)).status,201);
    const login=async id=>(await send('/api/reviewer/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],author=await login('pin_author'),reader=await login('pin_reader'),basePost={kind:'community_info',title:'가상 글',body:'가상 본문',secret:false};
    const publicPin=await (await send('/api/board-posts','POST',{...basePost,shared:true,highlighted:true},admin)).json(),privatePin=await (await send('/api/board-posts','POST',{...basePost,shared:false,highlighted:true},admin)).json(),path='/api/reviewer/board-posts?'+new URLSearchParams({kind:'community_all',q:'무일치'});
    assert.equal((await send(path)).status,401);assert.deepEqual((await (await send(path,'GET',undefined,reader)).json()).map(row=>row.id),[publicPin.id]);
    const adminRows=await (await send('/api/board-posts?'+new URLSearchParams({kind:'community_all',q:'무일치'}),'GET',undefined,admin)).json();assert.deepEqual(adminRows.map(row=>row.id),[privatePin.id,publicPin.id]);
    const own=await (await send('/api/reviewer/board-posts','POST',{...basePost,highlighted:true},author)).json();assert.equal(own.highlighted,0);
    const promoted=await (await send(`/api/board-posts/${own.id}`,'PUT',{...basePost,shared:true,highlighted:true,expectedVersion:own.version},admin)).json();assert.equal(promoted.highlighted,1);
    const edited=await (await send(`/api/reviewer/board-posts/${own.id}`,'PUT',{...basePost,title:'가상 수정',version:promoted.version,highlighted:false},author)).json();assert.equal(edited.highlighted,1);
    const hidden=await send(`/api/board-posts/${publicPin.id}`,'PUT',{...basePost,shared:false,expectedVersion:publicPin.version},admin);assert.equal(hidden.status,200);assert.deepEqual((await (await send(path,'GET',undefined,reader)).json()).map(row=>row.id),[own.id]);
    const added=[];
    for(const kind of ['community_resources','community_market']){const response=await send('/api/reviewer/board-posts','POST',{...basePost,kind},author);assert.equal(response.status,201);const post=await response.json();added.push(post);const rows=await (await send('/api/reviewer/board-posts?'+new URLSearchParams({kind}),'GET',undefined,reader)).json();assert.ok(rows.some(row=>row.id===post.id));assert.equal((await send(`/api/reviewer/board-posts/${post.id}`,'DELETE',{kind,version:post.version},reader)).status,400);}
    assert.equal((await send('/api/reviewer/board-posts','POST',{...basePost,kind:'community_event'},author)).status,400);
    const eventResponse=await send('/api/board-posts','POST',{...basePost,kind:'community_event',shared:true,highlighted:true},admin);assert.equal(eventResponse.status,201);const event=await eventResponse.json();
    const all=await (await send('/api/reviewer/board-posts?kind=community_all','GET',undefined,reader)).json();for(const post of [...added,event])assert.ok(all.some(row=>row.id===post.id));
    assert.deepEqual((await (await send(path,'GET',undefined,reader)).json()).map(row=>row.id),[event.id,own.id]);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
