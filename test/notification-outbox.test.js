import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { NotificationOutbox } from '../notification-outbox.js';
import { sensAlimtalk,sensSignature } from '../sens-alimtalk.js';
import { adminWriteGuard } from '../admin-write-guard.js';

const env={JWEB_NOTIFICATION_PROVIDER:'ncp-sens',JWEB_SENS_SERVICE_ID:'ncp:kkobizmsg:kr:123456:virtual',JWEB_SENS_CHANNEL_ID:'@virtual',JWEB_SENS_TEMPLATE_CODE:'virtual',JWEB_SENS_TEMPLATE_CONTENT:'#{현장} 작업을 중단하세요.',JWEB_SENS_ACCESS_KEY:'virtual-access',JWEB_SENS_SECRET_KEY:'virtual-secret'};
const input={recipients:['01000000002','01000000001'],content:'가상 현장 작업을 중단하세요.',variables:{현장:'가상 현장'}};
const ok=()=>{},accepted=()=>new Response(JSON.stringify({statusCode:'202',messages:[{to:'01000000001',messageId:'id-one',requestStatusCode:'A000'},{to:'01000000002',messageId:'id-two',requestStatusCode:'A000'}]}),{status:202});
const delivered=(messageStatusCode='0000',messageId='id-one')=>new Response(JSON.stringify({messageId,plusFriendId:'@virtual',templateCode:'virtual',requestStatusCode:'A000',messageStatusCode,messageStatusName:messageStatusCode==='0000'?'success':'fail'}));
function fixture(t,fetchRequest=async()=>accepted(),options={}){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE sites(id INTEGER PRIMARY KEY); INSERT INTO sites VALUES(1),(2)');const box=new NotificationOutbox(db,sensAlimtalk(env,fetchRequest),options);t.after(()=>db.close());return {db,box};}

test('SENS 서명과 고정 목적지·문자 대체 금지·최대 100명의 요청 형식을 검증한다',async()=>{
  assert.equal(sensSignature('GET','/path?q=a','123','access','secret'),createHmac('sha256','secret').update('GET /path?q=a\n123\naccess').digest('base64'));
  const calls=[],provider=sensAlimtalk(env,async(url,options)=>{calls.push({url,options});return accepted();});
  assert.deepEqual((await provider.send(input)).map(row=>row.state),['accepted','accepted']);
  const {url,options}=calls[0];assert.equal(url,'https://sens.apigw.ntruss.com/alimtalk/v2/services/ncp:kkobizmsg:kr:123456:virtual/messages');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body),{plusFriendId:'@virtual',templateCode:'virtual',messages:[...input.recipients].sort().map(to=>({countryCode:'82',to,content:input.content,useSmsFailover:false}))});
  assert.equal(options.headers['x-ncp-apigw-signature-v2'],sensSignature('POST',new URL(url).pathname,options.headers['x-ncp-apigw-timestamp'],env.JWEB_SENS_ACCESS_KEY,env.JWEB_SENS_SECRET_KEY));
  provider.validate({...input,recipients:Array.from({length:100},(_,i)=>'010'+String(i).padStart(8,'0'))});
  for(const bad of [{...input,recipients:[]},{...input,recipients:['01000000001','01000000001']},{...input,recipients:Array.from({length:101},(_,i)=>'010'+String(i).padStart(8,'0'))},{...input,recipients:['https://evil.test']},{...input,content:'틀린 내용'}])assert.throws(()=>provider.validate(bad));
  for(const config of [{},{...env,JWEB_SENS_SERVICE_ID:'https://evil.test'},{...env,JWEB_SENS_SECRET_KEY:''},{...env,JWEB_SENS_TEMPLATE_CONTENT:''}]){const disabled=sensAlimtalk(config,()=>{throw Error('호출 금지');});assert.equal(disabled.status().configured,false);assert.throws(()=>disabled.validate(input));}
});

test('명시 변수 치환은 연속 변수와 구분자를 포함한 값을 안전하게 처리한다',()=>{
  const adjacent=sensAlimtalk({...env,JWEB_SENS_TEMPLATE_CONTENT:'#{a}#{b}#{c}#{d}#{e}#{f}끝'},()=>{}),variables=Object.fromEntries('abcdef'.split('').map(key=>[key,'가'.repeat(50)])),start=performance.now();for(let i=0;i<1000;i++)assert.throws(()=>adjacent.validate({...input,variables,content:'가'.repeat(300)}));assert.ok(performance.now()-start<1000);
  const provider=sensAlimtalk({...env,JWEB_SENS_TEMPLATE_CONTENT:'#{현장}: #{상태}. #{현장}'},()=>{}),values={현장:'가상',상태:'첫 문장. 다음 문장'};assert.doesNotThrow(()=>provider.validate({...input,variables:values,content:'가상: 첫 문장. 다음 문장. 가상'}));assert.throws(()=>provider.validate({...input,variables:values,content:'가상: 첫 문장. 다음 문장. 다른 현장'}));assert.throws(()=>provider.validate({...input,variables:{},content:'가'.repeat(990)}));
});

test('업체 접수와 개별 전달·실패·불명 결과를 구분하고 잘못된 응답을 신뢰하지 않는다',async()=>{
  let response=()=>delivered();const provider=sensAlimtalk(env,async(url,options)=>{assert.ok(url.startsWith('https://sens.apigw.ntruss.com/'));assert.equal(options.redirect,'error');return response();});
  assert.deepEqual(await provider.result('id-one'),{state:'delivered',code:'0000'});
  response=()=>delivered('3005');assert.deepEqual(await provider.result('id-one'),{state:'unknown',code:'3005'});
  response=()=>delivered('3016');assert.deepEqual(await provider.result('id-one'),{state:'failed',code:'3016'});
  response=()=>new Response(JSON.stringify({messageId:'id-one',plusFriendId:'@virtual',templateCode:'virtual',requestStatusCode:'A000',messageStatusName:'processing'}));assert.deepEqual(await provider.result('id-one'),{state:'accepted',code:null});
  response=()=>delivered('0000','wrong');assert.equal(await provider.result('id-one'),null);
  for(const value of ['../secret','https://evil.test','id?secret'])await assert.rejects(provider.result(value));
  for(const fail of [()=>{throw Error('PRIVATE_SECRET');},()=>new Response('PRIVATE_SECRET',{status:500}),()=>new Response('null'),()=>new Response('not-json'),()=>new Response('x'.repeat(512*1024+1))]){response=fail;assert.deepEqual((await provider.send(input)).map(row=>row.state),['unknown','unknown']);assert.equal(await provider.result('id-one'),null);}
  response=()=>new Response(JSON.stringify({statusCode:'202',messages:[{to:'01000000001',messageId:'id-one',requestStatusCode:'A000'},{to:'01000000002',requestStatusCode:'A123'}]}));assert.deepEqual((await provider.send(input)).map(row=>row.state),['accepted','failed']);
});

test('서버 발급 키·원자 claim은 동시 전송과 응답 유실 후 재전송을 방지한다',async t=>{
  let release,calls=0;const {box,db}=fixture(t,()=>{calls++;return new Promise(resolve=>release=resolve);});const preview=box.prepare(1,input,'session',ok);assert.equal(box.prepare(1,input,'session',ok).id,preview.id);
  await assert.rejects(box.send(1,preview.id,{...input,confirmed:true},'other',ok));await assert.rejects(box.send(2,preview.id,{...input,confirmed:true},'session',ok));await assert.rejects(box.send(1,preview.id,{...input,content:'다른 현장 작업을 중단하세요.',confirmed:true},'session',ok));await assert.rejects(box.send(1,preview.id,input,'session',ok));assert.equal(calls,0);
  const pending=box.send(1,preview.id,{...input,confirmed:true},'session',ok);assert.equal(db.isTransaction,false);const concurrent=await box.send(1,preview.id,{...input,confirmed:true},'session',ok);assert.equal(concurrent.recipients[0].state,'unknown');assert.equal(calls,1);
  release(accepted());const result=await pending;assert.equal(result.recipients[0].state,'accepted');assert.equal((await box.send(1,preview.id,{...input,confirmed:true},'session',ok)).recipients[0].state,'accepted');assert.equal(calls,1);
  const records=JSON.stringify(db.prepare('SELECT * FROM notification_jobs').all());for(const sensitive of [...input.recipients,input.content,'session',env.JWEB_SENS_SECRET_KEY])assert.equal(records.includes(sensitive),false);assert.equal(JSON.stringify(box.list(1,ok)).includes('id-one'),false);
});

test('서버 재시작·전송 오류 상태는 불명으로 보존되며 자동 재전송하지 않는다',async t=>{
  let calls=0;const {box,db}=fixture(t,async()=>{calls++;throw new DOMException('private timeout','TimeoutError');});const draft=box.prepare(1,input,'session',ok);const result=await box.send(1,draft.id,{...input,confirmed:true},'session',ok);assert.equal(result.recipients[0].state,'unknown');
  const restarted=new NotificationOutbox(db,sensAlimtalk(env,async()=>{calls++;return accepted();}));assert.equal((await restarted.send(1,draft.id,{...input,confirmed:true},'session',ok)).recipients[0].state,'unknown');assert.equal(calls,1);
  await assert.rejects(restarted.refresh(1,draft.id,0,ok),/식별자/);
});

test('재발송은 이전 작업과 중복 위험의 명시 확인을 요구하며 후속 작업 경합도 합쳐진다',async t=>{
  let now=0,calls=0;const {box}=fixture(t,async()=>{calls++;return accepted();},{now:()=>now});const first=box.prepare(1,input,'session',ok);now=600001;assert.equal(box.prepare(1,input,'new-session',ok).requiresNewPreview,true);await assert.rejects(box.send(1,first.id,{...input,confirmed:true},'session',ok),/유효시간/);
  assert.throws(()=>box.prepare(1,{...input,previousId:first.id},'new-session',ok));const retryInput={...input,previousId:first.id,duplicateRiskAccepted:true},second=box.prepare(1,retryInput,'new-session',ok);assert.notEqual(first.id,second.id);assert.equal(box.prepare(1,retryInput,'new-session',ok).id,second.id);await assert.rejects(box.send(1,first.id,{...input,confirmed:true},'session',ok),/새 미리보기/);
  await box.send(1,second.id,{...input,confirmed:true},'new-session',ok);assert.equal(calls,1);const third=box.prepare(1,{...input,previousId:second.id,duplicateRiskAccepted:true},'new-session',ok);await box.send(1,third.id,{...input,confirmed:true},'new-session',ok);assert.equal(calls,2);
});

test('전송 도중 세션 철회 후에도 실제 접수 결과만 시스템 컨텍스트에 기록한다',async t=>{
  let release,active=true;const {box,db}=fixture(t,()=>new Promise(resolve=>release=resolve)),contexts=adminWriteGuard(db);box.systemWrite=fn=>contexts.exit(fn);const authorize=()=>{if(!active)throw Object.assign(Error('세션 철회'),{sessionStatus:401});},request={adminProtected:true,checkSession:()=>active?null:{status:401,error:'세션 철회'}};
  await contexts.run(request,async()=>{const draft=box.prepare(1,input,'session',authorize),pending=box.send(1,draft.id,{...input,confirmed:true},'session',authorize);active=false;release(accepted());const result=await pending;assert.equal(result.recipients[0].state,'accepted');assert.throws(()=>box.prepare(1,input,'session',authorize));});
  assert.equal(JSON.parse(db.prepare('SELECT recipients FROM notification_jobs').get().recipients)[0].state,'accepted');
});

test('결과 확인은 수신자별로 갱신하며 접수 설정 변경·현장 위조·권한 철회를 차단한다',async t=>{
  const {box}=fixture(t,async(url,options)=>options.method==='POST'?accepted():delivered('0000',url.endsWith('id-two')?'id-two':'id-one'));const draft=box.prepare(1,input,'session',ok);await box.send(1,draft.id,{...input,confirmed:true},'session',ok);
  await assert.rejects(box.refresh(2,draft.id,0,ok));await assert.rejects(box.refresh(1,draft.id,0,()=>{throw Error('권한 철회');}));await assert.rejects(box.refresh(1,draft.id,100,ok));
  const result=await box.refresh(1,draft.id,0,ok);assert.deepEqual(result.recipients.map(row=>row.state),['delivered','accepted']);const second=await box.refresh(1,draft.id,1,ok);assert.deepEqual(second.recipients.map(row=>row.state),['delivered','delivered']);
  box.provider=sensAlimtalk({...env,JWEB_SENS_CHANNEL_ID:'@different'},()=>{throw Error('호출 금지');});await assert.rejects(box.refresh(1,draft.id,0,ok),/설정/);
});
