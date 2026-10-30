import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoinFlow } from '../public/join-flow.js';
import { readFileSync } from 'node:fs';

test('현장 확인 전 선택 화면과 등록 입력 단계는 숨겨진다',()=>{
  const html=readFileSync(new URL('../public/join.html',import.meta.url),'utf8'),css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(html,/<div id="worker-choices" hidden>/);assert.match(html,/<div id="join-details" hidden>/);assert.match(css,/#worker-choices:not\(\[hidden\]\)\{display:flex/);assert.match(css,/#join-form \[hidden\]\{display:none!important\}/);
});

test('현장 진입은 로그인과 동의 후 가입을 구분하고 닫힌 가입을 숨긴다',()=>{
  const loginChoice={},joinChoice={},consent={},details={},status={textContent:''},next={},back={},acknowledged={checked:false},choices={hidden:true,querySelector:key=>({'[data-choose-login]':loginChoice,'[data-choose-join]':joinChoice})[key]},login={hidden:true},form={hidden:true,elements:{acknowledged},querySelector:key=>({'#join-consent':consent,'#join-details':details,'#join-consent-status':status,'#join-next':next,'#join-back':back})[key]},message={textContent:'이전 메시지'},flow=createJoinFlow(choices,login,form,message);
  flow.open(false);assert.equal(choices.hidden,false);assert.equal(joinChoice.hidden,true);joinChoice.onclick();assert.equal(form.hidden,true);loginChoice.onclick();assert.equal(login.hidden,false);assert.equal(form.hidden,true);
  flow.open(true);assert.equal(joinChoice.hidden,false);assert.equal(login.hidden,true);joinChoice.onclick();assert.equal(form.hidden,false);assert.equal(consent.hidden,false);assert.equal(details.hidden,true);next.onclick();assert.equal(details.hidden,true);assert.match(status.textContent,/확인/);
  acknowledged.checked=true;next.onclick();assert.equal(consent.hidden,true);assert.equal(details.hidden,false);back.onclick();assert.equal(consent.hidden,false);assert.equal(details.hidden,true);assert.equal(acknowledged.checked,true);
  loginChoice.onclick();assert.equal(login.hidden,false);assert.equal(form.hidden,true);flow.hide();assert.equal(choices.hidden,true);assert.equal(login.hidden,true);assert.equal(form.hidden,true);flow.open(false);assert.equal(joinChoice.hidden,true);
});
