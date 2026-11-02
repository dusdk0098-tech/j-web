import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('다른 탭에서 직원 계정이 바뀌면 이전 화면의 조회·저장·첨부·로그아웃을 거절한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-context-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,{method='GET',data,cookie,context,browser=false,bytes}={})=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...(context===undefined?{}:{'x-reviewer-context':context}),...(browser?{origin:base}:{}),...(bytes?{'x-file-name':'virtual.txt'}:{})},...(data===undefined?bytes?{body:bytes}:{}:{body:JSON.stringify(data)})});
    const asset=await send('/reviewer-session.js');assert.equal(asset.status,200);assert.match(await asset.text(),/bindReviewerSession/);
    const admin=(await send('/api/login',{method:'POST',data:{password:'virtual-admin-password'}})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites',{method:'POST',data:{name:'가상 현장'},cookie:admin})).json();
    for(const id of ['context_one','context_two'])assert.equal((await send('/api/reviewers',{method:'POST',data:{siteId:site.id,loginId:id,name:id,password:'virtual-password-123'},cookie:admin})).status,201);
    const issued=new Map(),login=async(id,cookie)=>{const response=await send('/api/reviewer/login',{method:'POST',data:{loginId:id,password:'virtual-password-123'},cookie});assert.equal(response.status,200);const next=response.headers.get('set-cookie').split(';')[0];issued.set(next,(await response.json()).context);return next;};
    const one=await login('context_one'),sessionOne=await (await send('/api/reviewer/session',{cookie:one})).json(),post=await (await send('/api/reviewer/board-posts',{method:'POST',data:{kind:'community_info',title:'가상 글',body:'본문',secret:false},cookie:one})).json();
    const two=await login('context_two',one),stale=sessionOne.context??'context-from-previous-screen',commentPath=`/api/reviewer/board-posts/${post.id}/comments`,input={postVersion:post.version,body:'다른 계정에 저장되면 안 되는 댓글'};
    assert.equal((await send(commentPath,{method:'POST',data:input,cookie:two,context:stale,browser:true})).status,409);
    assert.match(sessionOne.context,/^[0-9a-f]{64}$/);assert.equal(sessionOne.context,issued.get(one));
    assert.equal((await send('/api/reviewer/session',{cookie:two,context:stale})).status,409);
    assert.equal((await send(commentPath+`?version=${post.version}`,{cookie:two,context:stale})).status,409);
    assert.equal((await send(`/api/reviewer/board-posts/${post.id}/attachments?version=${post.version}`,{method:'POST',cookie:two,context:stale,browser:true,bytes:Buffer.from('가상 파일')})).status,409);
    assert.equal((await send('/api/reviewer/logout',{method:'POST',data:{},cookie:two,context:stale,browser:true})).status,409);
    const sessionTwo=await (await send('/api/reviewer/session',{cookie:two})).json();assert.match(sessionTwo.context,/^[0-9a-f]{64}$/);assert.equal(sessionTwo.context,issued.get(two));assert.notEqual(sessionTwo.context,sessionOne.context);
    assert.equal((await send(commentPath,{method:'POST',data:input,cookie:two,browser:true})).status,409);
    assert.equal((await send(commentPath,{method:'POST',data:input,cookie:two,context:sessionTwo.context,browser:true})).status,201);
    const rows=await (await send(commentPath+`?version=${post.version}`,{cookie:two,context:sessionTwo.context})).json();assert.equal(rows.length,1);assert.equal(rows[0].author_id,sessionTwo.reviewer.id);
    const sameUserNewLogin=await login('context_two',two);assert.equal((await send(commentPath,{method:'POST',data:input,cookie:sameUserNewLogin,context:sessionTwo.context,browser:true})).status,409);
    const newSession=await (await send('/api/reviewer/session',{cookie:sameUserNewLogin})).json();assert.equal(newSession.context,issued.get(sameUserNewLogin));assert.equal((await send('/api/reviewer/logout',{method:'POST',data:{},cookie:sameUserNewLogin,context:newSession.context,browser:true})).status,200);assert.equal((await send('/api/reviewer/session',{cookie:sameUserNewLogin})).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
