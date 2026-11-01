import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoinFlow } from '../public/join-flow.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('현장 확인 전 선택 화면과 등록 입력 단계는 숨겨진다',()=>{
  const html=readFileSync(new URL('../public/join.html',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(html,/<div id="worker-choices" hidden>/);assert.match(html,/<div id="join-details" hidden>/);assert.match(css,/#worker-choices:not\(\[hidden\]\)\{display:flex/);assert.match(css,/#join-form \[hidden\]\{display:none!important\}/);
});

test('가입 완료 후 로그인 화면을 열며 중복 제출과 늦은 응답을 처리한다',async()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8'),start=source.indexOf('form.onsubmit=async event=>{'),end=source.indexOf('async function showWorker(',start);assert.ok(start>=0&&end>start);
  const make=()=>{const submit={disabled:false},choiceLogin={},choiceJoin={},choices={hidden:true,querySelector:key=>({'[data-choose-login]':choiceLogin,'[data-choose-join]':choiceJoin})[key]},login={hidden:true},form={hidden:true,elements:{acknowledged:{checked:true},...Object.fromEntries(['birthDate','phone','emergencyName','emergencyPhone','address','nationality','bloodType','healthStatus','pledge'].map(key=>[key,{value:''}]))},querySelector:key=>key.startsWith('button[type=submit]')?submit:{},querySelectorAll:()=>[],reset(){}},message={textContent:''},flow=createJoinFlow(choices,login,form,message);let release,calls=0;const pending=new Promise(resolve=>{release=resolve;}),context={form,flow,message,document:{querySelector:()=>choices},fetch:()=>{calls++;return pending;},FormData:class {constructor(){return [];}},joinPad:{value:()=> '가상 서명',clear(){}},workerJoinCredentials:()=>({token:'가상'}),params:{},siteKey:null,adoptSiteAddress(){},updateWorkerRequirements(){}};runInNewContext(source.slice(start,end),context);flow.open(true);choiceJoin.onclick();return {form,login,choices,message,flow,submit,release,calls:()=>calls};};
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
