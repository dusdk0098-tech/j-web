import test from 'node:test';
import assert from 'node:assert/strict';
import { mountJoinChoices } from '../public/join-choices.js';

class Node {
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.textContent='';this.hidden=false;this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this.attributes[name]=value;}
  closest(){return this.label;}
  before(node){this.beforeNode=node;}
  after(node){this.afterNode=node;}
  focus(){this.focused=true;}
  get options(){return this.children;}
}
test('가입 후보 선택은 현장 목록을 갱신하고 직접 입력을 보존한다',()=>{
  const company=new Node('input'),occupation=new Node('input');company.label=new Node('label');occupation.label=new Node('label');
  const form=new Node('form');form.ownerDocument={createElement:tag=>new Node(tag)};form.elements={company,occupation};const update=mountJoinChoices(form);
  const companySelect=company.label.beforeNode.children[0],occupationSelect=occupation.label.beforeNode.children[0],quick=occupation.label.afterNode,buttons=quick.children[1];
  update({companies:['가상 업체','가상 업체'],occupations:['가상 직종','<script>']});
  assert.deepEqual(companySelect.options.map(o=>o.value),['','가상 업체']);assert.deepEqual(buttons.children.map(b=>b.textContent),['가상 직종','<script>']);
  companySelect.value='가상 업체';companySelect.onchange();assert.equal(company.value,'가상 업체');
  buttons.children[0].onclick();assert.equal(occupation.value,'가상 직종');assert.equal(occupationSelect.value,'가상 직종');assert.equal(occupation.focused,true);
  occupation.value='직접 입력한 직종';occupation.oninput();assert.equal(occupationSelect.value,'');
  update({companies:[],occupations:['새 직종']});assert.equal(occupation.value,'직접 입력한 직종');assert.equal(company.label.beforeNode.hidden,true);assert.deepEqual(buttons.children.map(b=>b.textContent),['새 직종']);
});
