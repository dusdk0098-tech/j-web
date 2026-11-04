import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoinFlow } from '../public/join-flow.js';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';

test('현장 확인 전 선택 화면과 등록 입력 단계는 숨겨진다',()=>{
  const html=readFileSync(new URL('../public/join.html',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(html,/<div id="worker-choices" hidden>/);assert.match(html,/<div id="join-details" hidden>/);assert.match(css,/#worker-choices:not\(\[hidden\]\)\{display:flex/);assert.match(css,/#join-form \[hidden\]\{display:none!important\}/);
});

test('가입 시 아이디와 암호는 선택할 때만 입력할 수 있다',()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('function updateJoinCredentials()'),end=source.indexOf("form.querySelector('.fields').insertAdjacentHTML",start);assert.ok(start>=0&&end>start);
  const form={elements:{useCredentials:{checked:false},loginId:{disabled:true},password:{disabled:true}}};runInNewContext(source.slice(start,end),{form});form.elements.useCredentials.checked=true;form.elements.useCredentials.onchange();assert.equal(form.elements.loginId.disabled,false);assert.equal(form.elements.password.disabled,false);form.elements.useCredentials.checked=false;form.elements.useCredentials.onchange();assert.equal(form.elements.loginId.disabled,true);assert.equal(form.elements.password.disabled,true);
});

test('가입 완료 후 로그인 화면을 열며 중복 제출과 늦은 응답을 처리한다',async()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('form.onsubmit=async event=>{'),end=source.indexOf('async function showWorker(',start);assert.ok(start>=0&&end>start);
  const make=()=>{const submit={disabled:false},choiceLogin={},choiceJoin={},choices={hidden:true,querySelector:key=>({'[data-choose-login]':choiceLogin,'[data-choose-join]':choiceJoin})[key]},login={hidden:true},form={hidden:true,elements:{category:{dispatchEvent(){}},acknowledged:{checked:true},...Object.fromEntries(['birthDate','phone','emergencyName','emergencyPhone','address','nationality','bloodType','healthStatus','pledge'].map(key=>[key,{value:''}]))},querySelector:key=>key.startsWith('button[type=submit]')?submit:{},querySelectorAll:()=>[],reset(){}},message={textContent:''},flow=createJoinFlow(choices,login,form,message);let release,calls=0;const pending=new Promise(resolve=>{release=resolve;}),context={form,flow,message,Event:class {},document:{querySelector:()=>choices},fetch:()=>{calls++;return pending;},FormData:class {constructor(){return [];}},joinPad:{value:()=> '가상 서명',clear(){}},workerJoinCredentials:()=>({token:'가상'}),params:{},siteKey:null,adoptSiteAddress(){},updateWorkerRequirements(){}};runInNewContext(source.slice(start,end),context);flow.open(true);choiceJoin.onclick();return {form,login,choices,message,flow,submit,release,calls:()=>calls};};
  const first=make(),event={preventDefault(){}};const request=first.form.onsubmit(event);await first.form.onsubmit(event);assert.equal(first.calls(),1);first.release({ok:true,json:async()=>({siteKey:'가상'})});await request;assert.equal(first.login.hidden,false);assert.equal(first.form.hidden,true);assert.match(first.message.textContent,/등록이 완료/);assert.equal(first.submit.disabled,false);
  for(const ok of [true,false]){const late=make(),request=late.form.onsubmit(event);late.flow.hide();late.message.textContent='로그인 완료';late.release({ok,json:async()=>ok?{siteKey:'가상'}:{error:'가상 오류'}});await request;assert.equal(late.login.hidden,true);assert.equal(late.choices.hidden,true);assert.equal(late.message.textContent,'로그인 완료');}
});

test('현장 진입은 로그인과 동의 후 가입을 구분하고 닫힌 가입을 숨긴다',()=>{
  const loginChoice={},joinChoice={},consent={},details={},status={textContent:''},next={},back={},acknowledged={checked:false},choices={hidden:true,querySelector:key=>({'[data-choose-login]':loginChoice,'[data-choose-join]':joinChoice})[key]},login={hidden:true},form={hidden:true,elements:{acknowledged},querySelector:key=>({'#join-consent':consent,'#join-details':details,'#join-consent-status':status,'#join-next':next,'#join-back':back})[key]},message={textContent:'이전 메시지'},flow=createJoinFlow(choices,login,form,message);
  flow.open(false);assert.equal(choices.hidden,false);assert.equal(joinChoice.hidden,true);joinChoice.onclick();assert.equal(form.hidden,true);loginChoice.onclick();assert.equal(login.hidden,false);assert.equal(form.hidden,true);
  flow.open(true);assert.equal(joinChoice.hidden,false);assert.equal(login.hidden,true);joinChoice.onclick();assert.equal(form.hidden,false);assert.equal(consent.hidden,false);assert.equal(details.hidden,true);next.onclick();assert.equal(details.hidden,true);assert.match(status.textContent,/확인/);
  acknowledged.checked=true;next.onclick();assert.equal(consent.hidden,true);assert.equal(details.hidden,false);back.onclick();assert.equal(consent.hidden,false);assert.equal(details.hidden,true);assert.equal(acknowledged.checked,true);
  acknowledged.checked=false;next.onclick();assert.equal(consent.hidden,false);assert.equal(details.hidden,true);assert.match(status.textContent,/세 가지.*모두/);acknowledged.checked=true;next.onclick();assert.equal(details.hidden,false);assert.equal(status.textContent,'');
  loginChoice.onclick();assert.equal(login.hidden,false);assert.equal(form.hidden,true);flow.hide();assert.equal(choices.hidden,true);assert.equal(login.hidden,true);assert.equal(form.hidden,true);flow.open(false);assert.equal(joinChoice.hidden,true);
  flow.open(true);joinChoice.onclick();assert.equal(flow.registered(),true);assert.equal(login.hidden,false);assert.equal(form.hidden,true);flow.hide();message.textContent='로그인 완료';assert.equal(flow.registered(),false);assert.equal(login.hidden,true);assert.equal(choices.hidden,true);assert.equal(message.textContent,'로그인 완료');
});

function pendingRegistration(options={}){
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('form.onsubmit=async event=>{'),end=source.indexOf('async function showWorker(',start);
  const submit={disabled:false},choiceLogin={},choiceJoin={},registrationStatus={textContent:''},choices={hidden:true,querySelector:key=>({'[data-choose-login]':choiceLogin,'[data-choose-join]':choiceJoin,'#join-request-status':registrationStatus})[key]},login={hidden:true},message={textContent:''},state={reset:0,cleared:0,adopted:0,signature:'가상 서명'};
  const values={name:'전송한 가상 이름',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'virtual_worker',password:'virtual-password-123',birthDate:'2000-01-01',phone:'010-0000-0000'};
  const fields=Object.fromEntries(['name','category','company','occupation','loginId','password','birthDate','phone','emergencyName','emergencyPhone','address','nationality','bloodType','healthStatus','pledge'].map(key=>[key,{value:values[key]||''}]));
  fields.category.dispatchEvent=event=>{assert.equal(event.type,'change');state.categoryChanges=(state.categoryChanges||0)+1;};
  const form={hidden:true,elements:{...fields,acknowledged:{checked:true},...(options.identityOnly?{useCredentials:{checked:false}}:{})},querySelector:key=>key.startsWith('button[type=submit]')?submit:{},querySelectorAll:()=>[],reset(){state.reset++;fields.name.value='';}};
  const flow=createJoinFlow(choices,login,form,message);let release,reject,calls=0;
  const pending=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
  const context={form,flow,message,Event:class {constructor(type){this.type=type;}},document:{querySelector:()=>choices},fetch:(...args)=>{calls++;return options.fetch?options.fetch(...args):pending;},FormData:class {constructor(){return ['name','category','company','occupation',...(options.identityOnly?[]:['loginId','password'])].map(key=>[key,fields[key].value]);}},joinPad:{value(){if(!state.signature)throw Error('서명 누락');return state.signature;},clear(){state.cleared++;state.signature='';}},workerJoinCredentials:options.credentials||(()=>({token:'가상'})),params:{},siteKey:null,adoptSiteAddress(){state.adopted++;},updateWorkerRequirements(){},updateJoinCredentials(){}};
  assert.ok(start>=0&&end>start);runInNewContext(source.slice(start,end),context);flow.open(true);choiceJoin.onclick();
  return {form,flow,choices,login,message,registrationStatus,state,fields,choiceLogin,choiceJoin,submit,release,reject,calls:()=>calls};
}

test('가입 완료 시 양식을 초기화하고 구분별 조건을 다시 적용한다',async()=>{
  const ui=pendingRegistration(),request=ui.form.onsubmit({preventDefault(){}});ui.release({ok:true,status:201,json:async()=>({siteKey:'가상'})});await request;
  assert.equal(ui.state.reset,1);assert.equal(ui.state.categoryChanges,1);assert.equal(ui.state.cleared,1);assert.equal(ui.login.hidden,false);
});

test('가입 응답이 늦게 와도 새로 연 가입 화면과 입력을 바꾸지 않는다',async()=>{
  for(const ok of [true,false]){
    const ui=pendingRegistration(),request=ui.form.onsubmit({preventDefault(){}});
    ui.choiceLogin.onclick();ui.choiceJoin.onclick();ui.fields.name.value='다시 입력한 가상 이름';ui.state.signature='새 가상 서명';ui.message.textContent='새 화면 안내';
    ui.release({ok,status:ok?201:400,json:async()=>ok?{siteKey:'가상'}:{error:'이전 요청 오류'}});await request;
    assert.equal(ui.form.hidden,false);assert.equal(ui.login.hidden,true);assert.equal(ui.fields.name.value,'다시 입력한 가상 이름');
    assert.equal(ui.state.signature,'새 가상 서명');assert.equal(ui.state.reset,0);assert.equal(ui.state.cleared,0);assert.equal(ui.state.adopted,0);assert.equal(ui.message.textContent,'새 화면 안내');
    assert.match(ui.registrationStatus.textContent,ok?/이전에 전송한 등록이 완료/:/이전 요청 오류/);
  }
});

test('가입 전송 후 수정한 입력은 보존하고 통신 오류는 결과 미확인으로 안내한다',async()=>{
  const edited=pendingRegistration(),event={preventDefault(){}},request=edited.form.onsubmit(event);edited.fields.name.value='전송 후 수정한 가상 이름';edited.state.signature='수정한 가상 서명';
  edited.release({ok:true,status:201,json:async()=>({siteKey:'가상'})});await request;
  assert.equal(edited.form.hidden,false);assert.equal(edited.fields.name.value,'전송 후 수정한 가상 이름');assert.equal(edited.state.signature,'수정한 가상 서명');
  assert.equal(edited.state.reset,0);assert.equal(edited.state.cleared,0);assert.match(edited.message.textContent,/등록.*완료/);assert.match(edited.message.textContent,/수정.*저장되지/);
  const lost=pendingRegistration(),failed=lost.form.onsubmit(event);lost.reject(new Error('가상 네트워크 오류'));await failed;
  assert.equal(lost.form.hidden,false);assert.equal(lost.state.reset,0);assert.match(lost.message.textContent,/결과.*확인하지 못/);assert.match(lost.message.textContent,/로그인/);
});

test('가입 화면 전환 중 결과와 오류를 구분하고 새 로그인에 이전 응답을 표시하지 않는다',async()=>{
  for(const response of [{ok:false,status:500,json:async()=>({error:'서버 오류'})},{ok:true,status:201,json:async()=>{throw Error('응답 손상');}}]){
    const ui=pendingRegistration(),request=ui.form.onsubmit({preventDefault(){}});ui.release(response);await request;
    assert.match(ui.message.textContent,/결과.*확인하지 못/);assert.equal(ui.state.reset,0);
  }
  const rejected=pendingRegistration(),first=rejected.form.onsubmit({preventDefault(){}});rejected.release({ok:false,status:400,json:async()=>({error:'가상 입력 오류'})});await first;assert.equal(rejected.message.textContent,'가상 입력 오류');
  const changed=pendingRegistration(),second=changed.form.onsubmit({preventDefault(){}});changed.state.signature='';changed.release({ok:true,status:201,json:async()=>({siteKey:'가상'})});await second;assert.equal(changed.state.reset,0);assert.match(changed.message.textContent,/수정.*저장되지/);
  const logged=pendingRegistration(),third=logged.form.onsubmit({preventDefault(){}});logged.flow.hide();logged.message.textContent='다른 계정 로그인';logged.release({ok:true,status:201,json:async()=>({siteKey:'가상'})});await third;
  assert.equal(logged.message.textContent,'다른 계정 로그인');assert.equal(logged.registrationStatus.textContent,'');assert.equal(logged.state.adopted,0);
});

test('가입 응답이 유실돼도 저장된 가상 계정으로 로그인할 수 있다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-join-loss-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
    const admin=(await send('/api/login',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites',{name:'가상 현장'},admin)).json(),invite=await (await send(`/api/sites/${site.id}/invitation`,{},admin)).json(),token=new URL(invite.link).searchParams.get('token');let savedStatus;
    const ui=pendingRegistration({credentials:()=>({token}),fetch:async(path,request)=>{const response=await fetch(base+path,request);savedStatus=response.status;throw Error('가입 응답 유실');}}),png=new PNG({width:1,height:1});png.data[3]=255;ui.state.signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
    await ui.form.onsubmit({preventDefault(){}});assert.equal(savedStatus,201);assert.match(ui.message.textContent,/결과.*확인하지 못/);assert.match(ui.message.textContent,/로그인/);assert.equal(ui.state.reset,0);
    const login=await send('/api/worker/login',{token,loginId:ui.fields.loginId.value,password:ui.fields.password.value});assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie'));
    let identityRequest;const identityUi=pendingRegistration({identityOnly:true,credentials:()=>({token}),fetch:async(path,request)=>{identityRequest=JSON.parse(request.body);const response=await fetch(base+path,request);assert.equal(response.status,201);throw Error('가상 응답 유실');}});identityUi.fields.name.value='다른 가상 이름';identityUi.state.signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
    await identityUi.form.onsubmit({preventDefault(){}});assert.equal(identityRequest.identityOnly,true);assert.equal(identityRequest.loginId,undefined);assert.equal(identityRequest.password,undefined);assert.match(identityUi.message.textContent,/결과.*확인하지 못/);const identityLogin=await send('/api/worker/login',{token,method:'identity',name:identityUi.fields.name.value,birthDigits:'000101'});assert.equal(identityLogin.status,200);assert.ok(identityLogin.headers.get('set-cookie'));
    const workers=await fetch(base+`/api/workers?siteId=${site.id}`,{headers:{cookie:admin}});assert.equal((await workers.json()).length,2);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
