import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/client.js',import.meta.url),'utf8'),response=value=>({ok:true,json:async()=>value}),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function surface(fetcher){
  const fieldset={disabled:false},login={hidden:false,elements:{loginId:{value:'virtual_client'},password:{value:'virtual-password-123'}},querySelector:()=>fieldset,reset(){}},register={hidden:true,elements:{loginId:{value:''}},querySelector:()=>fieldset,reset(){}},auth={hidden:true},profile={hidden:true},message={textContent:''},values={replaceChildren(){},append(){}},verify={disabled:true},status={textContent:''},refresh={},showLogin={},showRegister={},kind={value:'individual'},businessNumber={},businessName={},checkId={},logout={};
  const elements={'#auth':auth,'#profile':profile,'#login-form':login,'#register-form':register,'#message':message,'#profile-values':values,'#client-recovery-verify':verify,'#client-recovery-status':status,'#client-recovery-refresh':refresh,'#show-login':showLogin,'#show-register':showRegister,'#kind':kind,'#business-number':businessNumber,'#business-name':businessName,'#check-id':checkId,'#logout':logout};
  class FormDataFake{constructor(form){this.form=form;}*[Symbol.iterator](){yield ['loginId',this.form.elements.loginId.value];yield ['password',this.form.elements.password.value];}}
  const initialized=runInNewContext(`(async()=>{${source}})()`,{document:{querySelector:key=>elements[key],createElement:()=>({textContent:''})},fetch:fetcher,FormData:FormDataFake});
  return {initialized,auth,profile,login,verify,status,refresh,showLogin};
}

test('다른 계정으로 로그인한 뒤 늦게 도착한 이전 이메일 상태를 버린다',async()=>{
  const first=deferred(),sending=deferred(),calls=[];let current={id:1,name:'가상 첫 계정',loginId:'first'},statusCalls=0;
  const ui=surface(async(path,options)=>{
    if(path==='/api/client/session')return response({client:current});
    if(path==='/api/client/login'){current={id:2,name:'가상 둘째 계정',loginId:'second'};return response({ok:true});}
    if(path==='/api/client/recovery/status'){statusCalls++;return statusCalls===1?first.promise:response({enabled:true,verified:true,clientId:2,version:'version-2'});}
    if(path==='/api/client/recovery/verification'){calls.push(JSON.parse(options.body));return sending.promise;}
    throw Error('예상하지 못한 요청');
  });
  await ui.initialized;ui.showLogin.onclick();await ui.login.onsubmit({preventDefault(){}});await tick();assert.equal(ui.status.textContent,'이메일 확인됨');assert.equal(ui.verify.disabled,false);
  first.resolve(response({enabled:true,verified:false,clientId:1,version:'version-1'}));await tick();assert.equal(ui.status.textContent,'이메일 확인됨');
  const pending=ui.verify.onclick();await tick();assert.deepEqual(calls,[{clientId:2,version:'version-2'}]);ui.showLogin.onclick();sending.resolve(response({ok:true}));await pending;assert.equal(ui.profile.hidden,true);assert.doesNotMatch(ui.status.textContent,/전달을 요청/);
});

test('조회 중 계정이 바뀌면 이메일 확인을 요청할 수 없다',async()=>{
  const ui=surface(async(path)=>{if(path==='/api/client/session')return response({client:{id:1,name:'가상 계정',loginId:'first'}});if(path==='/api/client/recovery/status')return response({enabled:true,verified:false,clientId:2,version:'version-2'});throw Error('예상하지 못한 요청');});
  await ui.initialized;await tick();assert.equal(ui.verify.disabled,true);assert.match(ui.status.textContent,/계정이 변경/);
});
