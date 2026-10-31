import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {officeSuggestionCurrent} from '../public/office-template.js';

test('관리자 작성 화면의 전체 해제는 선택·서명과 늦은 응답을 보호한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("        button.insertAdjacentHTML('afterend','<button type=\"button\" id=\"office-clear-line\">"),end=source.indexOf('\n',start);assert.ok(start>=0);
  const markup=[],buttons={'#office-clear-line':{},'#office-clear-references':{}},selects=[{value:'2'},{value:'3'}],references=[{checked:true},{checked:false}],submit={disabled:false},button={disabled:true,insertAdjacentHTML:(_where,html)=>markup.push(html)},setup={querySelector:()=>({insertAdjacentHTML:(_where,html)=>markup.push(html)})},fields={querySelector:key=>buttons[key],querySelectorAll:()=>references},form={querySelector:()=>submit},message={textContent:''};let clears=0;
  const getState=runInNewContext('(function(){let manual=0,epoch=0;'+source.slice(start,end)+';return ()=>({manual,epoch});})()', {button,setup,fields,form,message,selects,clear:{click:()=>{clears++;}}});
  assert.match(markup.join(' '),/결재선 전체 해제/);assert.match(markup.join(' '),/참조자 전체 해제/);const before=getState();buttons['#office-clear-line'].onclick();assert.deepEqual(selects.map(s=>s.value),['','']);assert.equal(clears,1);assert.equal(button.disabled,false);
  const base={siteId:7,kind:'품의서',otherKind:'',values:['',''],connected:true,open:true,enabled:true};assert.equal(officeSuggestionCurrent({...base,...before},{...base,...getState()}),false);
  buttons['#office-clear-references'].onclick();assert.equal(references[0].checked,false);assert.equal(clears,2);buttons['#office-clear-references'].onclick();assert.equal(clears,2);
  selects[0].value='4';submit.disabled=true;const prior=getState();buttons['#office-clear-line'].onclick();assert.equal(selects[0].value,'4');assert.equal(clears,2);assert.equal(getState().epoch,prior.epoch);assert.match(message.textContent,/저장/);
});
