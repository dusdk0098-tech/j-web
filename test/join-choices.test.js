import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
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
  update({companies:['가상 업체'],occupations:['가상 직종'],existingWorker:true});assert.equal(company.label.beforeNode.hidden,true);assert.equal(occupation.label.beforeNode.hidden,true);assert.equal(quick.hidden,true);assert.equal(companySelect.disabled,true);assert.equal(occupationSelect.disabled,true);
  update({companies:['가상 업체'],occupations:['가상 직종']});assert.equal(company.label.beforeNode.hidden,false);assert.equal(occupation.label.beforeNode.hidden,false);assert.equal(quick.hidden,false);assert.equal(companySelect.disabled,false);assert.equal(occupationSelect.disabled,false);
});

test('현장 후보가 없어도 기본 직종을 선택하고 등록 후보와 중복 없이 함께 표시한다',()=>{
  const company=new Node('input'),occupation=new Node('input');company.label=new Node('label');occupation.label=new Node('label');
  const form=new Node('form');form.ownerDocument={createElement:tag=>new Node(tag)};form.elements={company,occupation};const update=mountJoinChoices(form),select=occupation.label.beforeNode.children[0],quick=occupation.label.afterNode;
  update({companies:[],occupations:[]});assert.equal(occupation.label.beforeNode.hidden,false);assert.equal(select.options.length,46);assert.equal(quick.hidden,false);assert.deepEqual(quick.children[1].children.map(button=>button.textContent),['견출','기계설비-건축','기계설비-일반','기타','덕트','도장','목공-형틀','미장','반장','방수','배관-상하수도','보통인부','비계','석공','수장','유리','조경','조적','철근','코킹','콘크리트','토공','포장']);const first=quick.children[1].children[0];first.onclick();assert.equal(occupation.value,first.textContent);assert.equal(select.value,first.textContent);
  select.value='전기-내선';select.onchange();assert.equal(occupation.value,'전기-내선');
  update({occupations:['전기-내선','가상 현장 직종']});assert.equal(select.value,'전기-내선');assert.equal(select.options.filter(option=>option.value==='전기-내선').length,1);assert.deepEqual(quick.children[1].children.map(button=>button.textContent),['전기-내선','가상 현장 직종']);
  update({existingWorker:true});assert.equal(occupation.label.beforeNode.hidden,true);assert.equal(select.disabled,true);assert.equal(quick.hidden,true);
  update({occupations:[]});assert.equal(occupation.label.beforeNode.hidden,false);assert.equal(select.disabled,false);assert.equal(select.value,'전기-내선');assert.equal(quick.hidden,false);assert.equal(quick.children[1].children.length,23);
});

test('등록된 직종이 없는 가상 현장에서 기본 직종을 선택해 가입하고 로그인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-default-occupation-')),store=new Store(join(dir,'jweb.sqlite')),site=store.createSite({name:'가상 현장'}),token=store.createInvitation(site.id).token;store.close();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const infoResponse=await send(`/api/join?token=${token}`),info=await infoResponse.json();assert.equal(infoResponse.status,200);assert.deepEqual(info.occupations,[]);
    const company=new Node('input'),occupation=new Node('input');company.label=new Node('label');occupation.label=new Node('label');const form=new Node('form');form.ownerDocument={createElement:tag=>new Node(tag)};form.elements={company,occupation};mountJoinChoices(form)(info);
    const select=occupation.label.beforeNode.children[0];assert.ok(select.options.some(option=>option.value==='배관-상하수도'));select.value='배관-상하수도';select.onchange();
    const signup={token,name:'가상 근로자',category:'직영',occupation:occupation.value,loginId:'virtual_trade',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}};
    assert.equal((await send('/api/join','POST',signup)).status,201);assert.equal((await send('/api/worker/login','POST',{siteKey:info.siteKey,loginId:signup.loginId,password:signup.password})).status,200);
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],workers=await(await send(`/api/workers?siteId=${site.id}`,'GET',null,admin)).json();assert.equal(workers.find(worker=>worker.name===signup.name).occupation,'배관-상하수도');
    const asset=await send('/join-choices.js');assert.equal(asset.status,200);assert.match(await asset.text(),/배관-상하수도/);
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}if(dirname(resolve(dir))===resolve(tmpdir()))rmSync(dir,{recursive:true,force:true});}
});
