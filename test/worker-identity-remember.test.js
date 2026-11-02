import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rememberWorker } from '../public/remember-worker.js';
import { mountWorkerIdentityRemember } from '../public/worker-identity-remember.js';

const a='A'.repeat(43),b='B'.repeat(43),identity={name:'가상 근로자',birthDigits:'000101'};
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function field(value=''){return {value,checked:false,disabled:false,required:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},input(){this.listeners.input?.();}};}
function screen(remembered){const elements={workerName:field(),birthDigits:field(),rememberIdentity:field()},forget={},status={textContent:''},form={elements,querySelector:selector=>selector==='#forget-identity'?forget:status};return {elements,forget,status,memory:mountWorkerIdentityRemember({form,remembered})};}

test('현장별 이름 저장은 아이디와 독립적이며 암호와 현장키를 기록하지 않는다',async()=>{
  const data=storage(),remembered=rememberWorker(data,webcrypto);await remembered.save(a,'virtual_worker');await remembered.saveIdentity(a,{...identity,password:'virtual-secret'});
  const record=JSON.parse(data.getItem('jweb.worker.identity'));assert.deepEqual(Object.keys(record).sort(),['birthDigits','name','site']);assert.equal(JSON.stringify(record).includes(a),false);assert.equal(JSON.stringify(record).includes('secret'),false);
  assert.deepEqual(await remembered.loadIdentity(a),identity);assert.equal(await remembered.loadIdentity(b),null);assert.equal(await remembered.load(a),'virtual_worker');
  await remembered.clearIdentity(b);assert.deepEqual(await remembered.loadIdentity(a),identity);await remembered.clearIdentity(a);assert.equal(await remembered.loadIdentity(a),null);assert.equal(await remembered.load(a),'virtual_worker');
  for(const bad of [{name:' ',birthDigits:'000101'},{name:'가상',birthDigits:'0001010'},{name:'가상\n이름',birthDigits:'000101'}])await assert.rejects(remembered.saveIdentity(a,bad),/확인/);
});

test('확인된 현장의 저장 해제는 반환된 약속을 기다리기 전에 기기에서 지운다',async()=>{
  const data=storage(),remembered=rememberWorker(data,webcrypto);await remembered.save(a,'virtual_worker');const idClear=remembered.clear(a);assert.equal(data.getItem('jweb.worker.remembered'),null);await idClear;
  await remembered.saveIdentity(a,identity);const restored=rememberWorker(data,webcrypto);assert.deepEqual(await restored.loadIdentity(a),identity);const identityClear=restored.clearIdentity(a);assert.equal(data.getItem('jweb.worker.identity'),null);await identityClear;
  await remembered.saveIdentity(a,identity);await remembered.clearIdentity(a,()=>false);assert.deepEqual(await remembered.loadIdentity(a),identity);
  const gate=deferred(),slow=rememberWorker(data,{subtle:{digest:async(...args)=>{await gate.promise;return webcrypto.subtle.digest(...args);}}});let allowed=true;const pending=slow.clearIdentity(a,()=>allowed);assert.notEqual(data.getItem('jweb.worker.identity'),null);allowed=false;gate.resolve();await pending;assert.deepEqual(await remembered.loadIdentity(a),identity);
});

test('복원은 같은 현장에만 적용하고 늦은 결과가 새 입력을 덮지 않는다',async()=>{
  const remembered=rememberWorker(storage(),webcrypto);await remembered.saveIdentity(a,identity);const page=screen(remembered);await page.memory.restore(a);assert.equal(page.elements.workerName.value,identity.name);assert.equal(page.elements.birthDigits.value,identity.birthDigits);assert.equal(page.elements.rememberIdentity.checked,true);
  await page.memory.restore(b);assert.equal(page.elements.workerName.value,'');assert.equal(page.elements.birthDigits.value,'');assert.equal(page.elements.rememberIdentity.checked,false);
  const gate=deferred(),slow=screen({...remembered,loadIdentity:async()=>{await gate.promise;return identity;}}),pending=slow.memory.restore(a);slow.elements.workerName.value='새 가상 입력';slow.elements.workerName.input();gate.resolve();await pending;assert.equal(slow.elements.workerName.value,'새 가상 입력');assert.equal(slow.elements.birthDigits.value,'');assert.equal(slow.elements.rememberIdentity.checked,false);
});

test('정보 저장 해제 후 입력과 로그인 시도가 있어도 늦은 삭제는 유지된다',async()=>{
  const data=storage(),base=rememberWorker(data,webcrypto);await base.saveIdentity(a,identity);const gate=deferred();let deletion;
  const page=screen({...base,clearIdentity:(...args)=>deletion=(async()=>{await gate.promise;return base.clearIdentity(...args);})()});await page.memory.restore(a);
  page.elements.rememberIdentity.checked=false;page.elements.rememberIdentity.onchange();page.elements.workerName.value='';page.elements.birthDigits.value='';page.elements.workerName.input();page.memory.invalidate();const state=page.memory.begin();page.memory.end(state);
  await page.memory.restore(a);assert.equal(page.elements.rememberIdentity.checked,false);assert.equal(page.elements.workerName.value,'');gate.resolve();await deletion;assert.equal(await base.loadIdentity(a),null);
});

test('다시 저장을 선택하면 진행 중인 삭제를 취소하고 저장소 장애를 표시한다',async()=>{
  const data=storage(),base=rememberWorker(data,webcrypto);await base.saveIdentity(a,identity);const gate=deferred();let deletion;
  const page=screen({...base,clearIdentity:(...args)=>deletion=(async()=>{await gate.promise;return base.clearIdentity(...args);})()});await page.memory.restore(a);page.elements.rememberIdentity.checked=false;page.elements.rememberIdentity.onchange();page.elements.rememberIdentity.checked=true;page.elements.rememberIdentity.onchange();gate.resolve();await deletion;assert.deepEqual(await base.loadIdentity(a),identity);
  const unavailable=screen(null);assert.equal(unavailable.elements.rememberIdentity.disabled,true);assert.equal(unavailable.forget.disabled,true);assert.match(unavailable.status.textContent,/사용할 수 없습니다/);
  const blocked=screen({...base,clearIdentityAll(){throw Error('차단');}});await blocked.memory.restore(a);blocked.forget.onclick();assert.match(blocked.status.textContent,/지우지 못했습니다/);assert.equal(blocked.elements.rememberIdentity.checked,true);
});

test('현장 전환이나 전체 삭제 뒤에는 대기 중인 저장값이 다시 나타나지 않는다',async()=>{
  const data=storage(),base=rememberWorker(data,webcrypto);await base.saveIdentity(a,identity);const deleteGate=deferred();let deletion;
  const page=screen({...base,clearIdentity:(...args)=>deletion=(async()=>{await deleteGate.promise;return base.clearIdentity(...args);})()});await page.memory.restore(a);page.elements.rememberIdentity.checked=false;page.elements.rememberIdentity.onchange();await page.memory.restore(b);assert.equal(page.elements.workerName.value,'');page.elements.rememberIdentity.checked=true;page.elements.rememberIdentity.onchange();deleteGate.resolve();await deletion;assert.equal(await base.loadIdentity(a),null);
  await base.saveIdentity(a,identity);const loadGate=deferred(),slow=screen({...base,loadIdentity:async()=>{await loadGate.promise;return identity;}}),pending=slow.memory.restore(a);slow.forget.onclick();loadGate.resolve();await pending;assert.equal(slow.elements.workerName.value,'');assert.equal(slow.elements.rememberIdentity.checked,false);assert.equal(await base.loadIdentity(a),null);
});

test('새 정보 저장은 이전에 지연된 같은 현장의 삭제보다 우선한다',async()=>{
  const data=storage(),base=rememberWorker(data,webcrypto);await base.saveIdentity(a,identity);const gate=deferred();let deletion;
  const page=screen({...base,clearIdentity:(...args)=>deletion=(async()=>{await gate.promise;return base.clearIdentity(...args);})()});await page.memory.restore(a);page.elements.rememberIdentity.checked=false;page.elements.rememberIdentity.onchange();assert.equal(await page.memory.save(a,identity,true),'');gate.resolve();await deletion;assert.deepEqual(await base.loadIdentity(a),identity);
});

test('아이디 저장 해제 뒤 로그인 방식을 바꿔도 지연된 삭제가 취소되지 않는다',async()=>{
  const data=storage(),base=rememberWorker(data,webcrypto);await base.save(a,'virtual_worker');const gate=deferred();let deletion;
  const remembered={...base,clear:(...args)=>deletion=(async()=>{await gate.promise;return base.clear(...args);})()},choice=field(),forget={},status={},areas=new Map();
  const login={elements:{method:field('id'),loginId:field(),workerName:field(),birthDigits:field(),rememberId:choice},querySelector:selector=>selector==='#remember-status'?status:selector==='#forget-remembered'?forget:(areas.get(selector)||areas.set(selector,{}).get(selector))};
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('function applyWorkerLoginMethod()'),end=source.indexOf('const flow=',start),context={login,crypto:{subtle:{}},localStorage:data,rememberWorker:()=>remembered,mountWorkerIdentityRemember:()=>({restore:async()=>{},invalidate(){}})};
  assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end)+'\nglobalThis.hooks={restoreRemembered};',context);await context.hooks.restoreRemembered(a);assert.equal(choice.checked,true);choice.checked=false;choice.onchange();login.elements.method.value='identity';login.elements.method.onchange();gate.resolve();await deletion;assert.equal(await base.load(a),null);
});

test('위치 확인 중 로그인 입력을 잠그고 제출 당시의 이름만 저장한다',async()=>{
  const location=deferred(),calls=[],saved=[],button={disabled:false},message={textContent:''},elements={method:field('identity'),loginId:field('id_worker'),workerName:field(identity.name),birthDigits:field(identity.birthDigits),password:field('virtual-secret')},rememberChoice=field(),forget={disabled:false};elements.loginId.disabled=true;
  const login={elements,querySelector:()=>button},identityMemory={begin:()=>({selected:true}),save:async(...args)=>{saved.push(args);return '';},end(){}},context={login,identityMemory,rememberChoice,forget,workerOpening:false,rememberEpoch:0,remembered:null,rememberSite:a,inviteInfo:{locationRequired:true},captureWorkerLocation:()=>location.promise,fetch:async(path,options)=>{calls.push({path,input:JSON.parse(options.body)});return {ok:true,json:async()=>({siteKey:a,worker:{},reportContext:{}})};},token:null,siteKey:a,adoptSiteAddress(){},showWorker:async()=>true,applyWorkerLoginMethod(){},message};
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('login.onsubmit=async event=>{'),end=source.indexOf('\nif(inviteInfo)',start);assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end),context);
  const pending=login.onsubmit({preventDefault(){}});for(const item of Object.values(elements))assert.equal(item.disabled,true);elements.workerName.value='나중 입력';elements.password.value='다른 암호';location.resolve({latitude:1,longitude:1});await pending;
  assert.equal(calls[0].input.name,identity.name);assert.equal(calls[0].input.password,'virtual-secret');assert.equal(saved[0][1].name,identity.name);assert.equal(saved[0][1].birthDigits,identity.birthDigits);assert.equal(elements.method.disabled,false);assert.equal(rememberChoice.disabled,false);
  context.inviteInfo={locationRequired:false};context.fetch=async()=>({ok:false,json:async()=>({error:'인증 실패'})});button.disabled=false;await login.onsubmit({preventDefault(){}});assert.equal(saved.length,1);assert.equal(message.textContent,'인증 실패');assert.equal(button.disabled,false);assert.equal(elements.method.disabled,false);
  context.inviteInfo={existingWorker:true,siteKey:a,locationRequired:false};context.siteKey=null;context.token='c'.repeat(43);context.fetch=async(path,options)=>{calls.push({path,input:JSON.parse(options.body)});return {ok:false,json:async()=>({error:'가상 실패'})};};
  await login.onsubmit({preventDefault(){}});assert.equal(calls.at(-1).input.siteKey,a);assert.equal(calls.at(-1).input.token,context.token);
});
