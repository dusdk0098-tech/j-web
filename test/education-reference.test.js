import test from 'node:test';
import assert from 'node:assert/strict';
import {educationReference,mountEducationReference} from '../public/education-reference.js';

function setup(initial='기존 가상 본문'){
  class Control extends EventTarget {value='';disabled=false;readOnly=false;maxLength=-1;textContent='';onclick=null;}
  const controls=new Map(),root={isConnected:true,innerHTML:'',querySelector(selector){if(!controls.has(selector))controls.set(selector,new Control());return controls.get(selector);}},kind=new Control(),body=new Control();kind.value='supervisor_new';body.value=initial;let active=true;
  const mounted=mountEducationReference(root,{kind,body,active:()=>active});
  return {root,kind,body,mounted,setActive:value=>active=value,normal:controls.get('[data-reference-normal]'),compact:controls.get('[data-reference-compact]'),apply:controls.get('[data-reference-apply]'),preview:controls.get('[data-reference-preview]'),status:controls.get('[data-reference-status]')};
}

test('두 미리보기는 같은 안내의 줄바꿈만 달라지고 본문은 적용 전까지 보존된다',()=>{
  const s=setup();s.normal.onclick();const normal=s.preview.textContent;assert.equal(s.body.value,'기존 가상 본문');assert.ok(normal.includes('\n'));s.compact.onclick();assert.equal(s.preview.textContent,normal.replaceAll('\n',' '));assert.equal(s.body.value,'기존 가상 본문');assert.equal(educationReference('unknown'),'');
});

test('명시적 적용은 기존 본문 뒤에 한 번 추가하고 input 이벤트로 변경을 알린다',()=>{
  for(const initial of ['','기존 가상 본문']){const s=setup(initial);let inputs=0;s.body.addEventListener('input',event=>{inputs++;assert.equal(event.bubbles,true);});s.normal.onclick();const text=s.preview.textContent;s.apply.onclick();assert.equal(s.body.value,initial+(initial?'\n\n':'')+text);assert.equal(inputs,1);assert.equal(s.apply.disabled,true);assert.equal(s.preview.textContent,'');s.apply.onclick();assert.equal(inputs,1);}
});

test('종류나 본문 변경 이벤트는 이전 미리보기와 적용 버튼을 무효화한다',()=>{
  for(const [field,event] of [['kind','input'],['kind','change'],['body','input']]){const s=setup();s.normal.onclick();s[field].value=field==='kind'?'regular':'새 가상 본문';s[field].dispatchEvent(new Event(event));assert.equal(s.preview.textContent,'');assert.equal(s.apply.disabled,true);const before=s.body.value;s.apply.onclick();assert.equal(s.body.value,before);s.normal.onclick();assert.equal(s.apply.disabled,false);}
});

test('이벤트 없는 변경·읽기 전용·화면 이탈·해제 후에도 이전 참고자료가 적용되지 않는다',()=>{
  for(const change of [s=>s.kind.value='regular',s=>s.body.value='수정',s=>s.body.disabled=true,s=>s.body.readOnly=true,s=>s.root.isConnected=false,s=>s.setActive(false)]){const s=setup();s.normal.onclick();change(s);const before=s.body.value;s.apply.onclick();assert.equal(s.body.value,before);assert.equal(s.apply.disabled,true);}
  const s=setup();s.normal.onclick();s.mounted.destroy();assert.equal(s.apply.onclick,null);assert.equal(s.apply.disabled,true);s.body.dispatchEvent(new Event('input'));assert.equal(s.preview.textContent,'');
});

test('종류 미선택과 본문 길이 제한은 내용을 손상시키지 않고 추가를 차단한다',()=>{
  const s=setup();s.kind.value='';s.mounted.refresh();assert.equal(s.normal.disabled,true);s.normal.onclick();assert.equal(s.preview.textContent,'');s.kind.value='regular';s.mounted.refresh();s.normal.onclick();s.body.maxLength=s.body.value.length;s.apply.onclick();assert.equal(s.body.value,'기존 가상 본문');assert.match(s.status.textContent,/최대 길이/);
});
