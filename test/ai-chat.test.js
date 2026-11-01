import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AiChat } from '../ai-chat.js';
const env={JWEB_AI_ENABLED:'1',JWEB_AI_ENDPOINT:'http://127.0.0.1:1/chat',JWEB_AI_MODEL:'virtual',JWEB_AI_API_KEY:'virtual-key'};
const ok=()=>{},reply=()=>new Response(JSON.stringify({choices:[{message:{content:'가상 답변'}}]}));
test('AI 비활성·설정 오류·입력 검증은 전송하지 않는다',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply();});
  for(const config of [{},{...env,JWEB_AI_ENDPOINT:'http://example.test/chat'},{...env,JWEB_AI_API_KEY:''}]){const ai=new AiChat(db,config);assert.equal(ai.status().configured,false);await assert.rejects(ai.chat({text:'가상 질문'},'a',ok),{aiStatus:503});}
  const ai=new AiChat(db,env);
  for(const input of [{text:''},{text:'x'.repeat(4001)},{text:'x',image:{mimeType:'image/png',data:'YQ=='}},{text:'x',image:{mimeType:'image/svg+xml',data:Buffer.from('<svg/>').toString('base64')}},{text:'x',image:{mimeType:'image/png',data:'A'.repeat(7*1024*1024)}}])await assert.rejects(ai.chat(input,'a',ok),{aiStatus:400});
  assert.equal(calls,0);
});
test('질문·이미지 전달과 평가 소유자 격리, 본문 미저장',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const ai=new AiChat(db,env);let payload;
  t.mock.method(globalThis,'fetch',async(url,options)=>{payload=JSON.parse(options.body);assert.equal(url,env.JWEB_AI_ENDPOINT);assert.equal(options.redirect,'error');return reply();});
  const image={mimeType:'image/png',data:Buffer.from('89504e470d0a1a0a','hex').toString('base64')};
  const result=await ai.chat({text:'가상 질문',image},'session-a',ok);assert.equal(result.answer,'가상 답변');assert.equal(payload.messages[0].content[1].image_url.url,`data:image/png;base64,${image.data}`);
  assert.throws(()=>ai.feedback({id:result.id,rating:'good'},'session-b',ok),{aiStatus:404});assert.throws(()=>ai.feedback({id:result.id,rating:'unknown'},'session-a',ok),{aiStatus:400});
  assert.deepEqual(ai.feedback({id:result.id,rating:'bad'},'session-a',ok),{ok:true});assert.equal(db.prepare('SELECT rating FROM ai_feedback').get().rating,'bad');assert.equal(JSON.stringify(db.prepare('SELECT * FROM ai_feedback').all()).includes('가상'),false);
});
test('동시 요청 제한과 로그아웃 후 결과 저장 거부, 오류 은닉·시간초과',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const ai=new AiChat(db,env);let release,active=true;
  const mock=t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{release=resolve;}));
  const check=()=>{if(!active)throw Object.assign(Error('로그인 필요'),{sessionStatus:401});};
  const pending=ai.chat({text:'가상 질문'},'a',check);await assert.rejects(ai.chat({text:'중복'},'a',check),{aiStatus:429});active=false;release(reply());await assert.rejects(pending,{sessionStatus:401});assert.equal(db.prepare('SELECT count(*) n FROM ai_feedback').get().n,0);assert.equal(ai.pending.size,0);
  for(const [response,status] of [[()=>new Response('secret upstream body',{status:500}),502],[()=>new Response('{}'),502],[()=>{throw new DOMException('secret','TimeoutError');},504],[()=>{throw Error('secret key');},502],[()=>new Response('x'.repeat(256*1024+1)),502]]){mock.mock.mockImplementation(response);await assert.rejects(ai.chat({text:'가상'},'a',ok),error=>error.aiStatus===status&&!error.message.includes('secret'));assert.equal(ai.pending.size,0);}
});
