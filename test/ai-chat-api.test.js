import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

test('관리자 AI HTTP API: 인증·비활성·가상 답변·평가 격리·로그 민감정보 제외',{timeout:30000},async()=>{
  mkdirSync('.omo/evidence/ai-backend',{recursive:true});
  for(const enabled of [false,true]){
    const dir=mkdtempSync(join(process.cwd(),'.omo/evidence/ai-backend/api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const injection=`globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'가상 답변 API_SECRET_CONTENT'}}]}));`;
    const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(injection)}`,'server.js'],{env:{...process.env,PORT:String(port),JWEB_PUBLIC_ORIGIN:'',JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-test-password',JWEB_AI_ENABLED:enabled?'1':'0',JWEB_AI_ENDPOINT:'http://127.0.0.1:1/chat',JWEB_AI_MODEL:'virtual',JWEB_AI_API_KEY:'API_SECRET_KEY'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
    try{
      await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 시작 실패');})]);
      const send=(path,method='GET',body,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      for(const path of ['/api/ai/status','/api/ai/chat','/api/ai/feedback'])assert.equal((await send(path)).status,401);
      const login=async()=>{const response=await send('/api/login','POST',{password:'virtual-test-password'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];},cookie=await login();
      const status=await send('/api/ai/status','GET',null,cookie);assert.equal(status.status,200);assert.equal((await status.json()).configured,enabled);
      const response=await send('/api/ai/chat','POST',{text:'API_SECRET_QUESTION'},cookie);assert.equal(response.status,enabled?200:503);
      if(enabled){const answer=await response.json();assert.equal(answer.answer,'가상 답변 API_SECRET_CONTENT');const second=await login();assert.equal((await send('/api/ai/feedback','POST',{id:answer.id,rating:'good'},second)).status,404);assert.equal((await send('/api/ai/feedback','POST',{id:answer.id,rating:'good'},cookie)).status,200);const db=new DatabaseSync(join(dir,'jweb.sqlite'));try{assert.equal(db.prepare('SELECT rating FROM ai_feedback').get().rating,'good');assert.equal(JSON.stringify(db.prepare('SELECT * FROM ai_feedback').all()).includes('API_SECRET'),false);}finally{db.close();}}
      assert.equal((await send('/api/logout','POST',{},cookie)).status,200);assert.equal((await send('/api/ai/status','GET',null,cookie)).status,401);assert.equal(logs.includes('API_SECRET'),false);
    }finally{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}}
  }
});
