import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewerLogin } from '../public/reviewer-login.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function screen(saved,api){
  const elements={loginId:{value:'',disabled:false},password:{value:'',disabled:false},rememberId:{checked:false,disabled:false},keepLogin:{checked:false,disabled:false}},button={disabled:false},status={textContent:''},message={textContent:''};
  const form={elements,querySelector:selector=>selector==='button'?button:status,reset(){elements.loginId.value='';elements.password.value='';elements.rememberId.checked=false;elements.keepLogin.checked=false;}};
  let refreshed=0;const submit=reviewerLogin({form,message,api,refresh:async()=>{refreshed++;},storage:()=>saved});
  return {elements,button,status,message,submit,refreshed:()=>refreshed};
}
const submit=page=>page.submit({preventDefault(){}});

test('직원 로그인은 선택한 아이디만 저장하고 로그인 유지 선택을 전달한다',async()=>{
  const saved=storage(),requests=[];let release;
  const page=screen(saved,async(path,options)=>{requests.push({path,...JSON.parse(options.body)});await new Promise(resolve=>{release=resolve;});});
  const e=page.elements;e.loginId.value='virtual_staff';e.password.value='virtual-secret';e.rememberId.checked=true;e.keepLogin.checked=true;
  const pending=submit(page);assert.equal(page.button.disabled,true);assert.equal(e.keepLogin.disabled,true);release();await pending;
  assert.deepEqual(requests,[{path:'/api/reviewer/login',loginId:'virtual_staff',password:'virtual-secret',keepLogin:true}]);assert.deepEqual([...saved.values.values()],['virtual_staff']);assert.equal(e.password.value,'');assert.equal(e.loginId.value,'virtual_staff');assert.equal(e.rememberId.checked,true);assert.equal(page.button.disabled,false);assert.equal(page.refreshed(),1);
  const restored=screen(saved,async()=>{});assert.equal(restored.elements.loginId.value,'virtual_staff');assert.equal(restored.elements.rememberId.checked,true);assert.equal(restored.elements.keepLogin.checked,false);
  restored.elements.password.value='another-secret';restored.elements.rememberId.checked=false;await submit(restored);assert.equal(saved.values.size,0);
});

test('인증 실패나 저장 차단은 암호를 보관하지 않고 로그인 화면을 계속 사용할 수 있게 한다',async()=>{
  const saved=storage();saved.setItem('jweb.reviewer.loginId','old_staff');const failed=screen(saved,async()=>{throw Error('인증 실패');});
  failed.elements.loginId.value='other_staff';failed.elements.password.value='secret';failed.elements.rememberId.checked=true;await submit(failed);assert.equal(failed.message.textContent,'인증 실패');assert.equal(saved.getItem('jweb.reviewer.loginId'),'old_staff');assert.equal(failed.refreshed(),0);assert.equal(failed.button.disabled,false);
  const blocked=screen({getItem(){throw Error('차단');}},async()=>{});assert.equal(blocked.elements.rememberId.disabled,true);assert.match(blocked.status.textContent,/저장할 수 없습니다/);blocked.elements.loginId.value='valid_staff';blocked.elements.password.value='secret';await submit(blocked);assert.equal(blocked.refreshed(),1);assert.equal(blocked.elements.rememberId.disabled,true);assert.equal(blocked.elements.keepLogin.disabled,false);
  const writeBlocked=screen({getItem:()=>null,setItem(){throw Error('차단');}},async()=>{});writeBlocked.elements.loginId.value='valid_staff';writeBlocked.elements.password.value='secret';writeBlocked.elements.rememberId.checked=true;await submit(writeBlocked);assert.equal(writeBlocked.refreshed(),1);assert.equal(writeBlocked.elements.rememberId.disabled,true);assert.match(writeBlocked.status.textContent,/저장할 수 없습니다/);
});

test('아이디 저장 해제는 로그인 전 즉시 반영되고 삭제 차단을 알린다',async()=>{
  const saved=storage();saved.setItem('jweb.reviewer.loginId','old_staff');const page=screen(saved,async()=>{throw Error('인증 실패');});
  assert.equal(page.elements.rememberId.checked,true);page.elements.rememberId.checked=false;page.elements.rememberId.onchange();assert.equal(saved.values.size,0);assert.equal(screen(saved,async()=>{}).elements.loginId.value,'');
  page.elements.password.value='wrong';await submit(page);assert.equal(page.message.textContent,'인증 실패');assert.equal(saved.values.size,0);
  const blocked=screen({getItem:()=> 'old_staff',removeItem(){throw Error('차단');}},async()=>{});blocked.elements.rememberId.checked=false;blocked.elements.rememberId.onchange();assert.equal(blocked.elements.rememberId.disabled,true);assert.match(blocked.status.textContent,/삭제할 수 없습니다/);
});

test('직원 로그인 유지 선택은 HTTP 쿠키에 반영되고 로그아웃은 세션을 폐기한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-options-')),socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const page=await send('/review');assert.match(await page.text(),/name="keepLogin"/);assert.equal((await send('/reviewer-login.js')).status,200);
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    assert.equal((await send('/api/reviewers','POST',{siteId:site.id,loginId:'virtual_staff',name:'가상 직원',password:'virtual-password-123'},admin)).status,201);
    const credentials={loginId:'virtual_staff',password:'virtual-password-123'},cookies=[];
    for(const option of [false,true,undefined]){const response=await send('/api/reviewer/login','POST',{...credentials,...(option===undefined?{}:{keepLogin:option})});assert.equal(response.status,200);const header=response.headers.get('set-cookie');assert.match(header,/HttpOnly; SameSite=Strict/);if(option===false)assert.doesNotMatch(header,/Max-Age/);else assert.match(header,/Max-Age=28800/);cookies.push(header.split(';')[0]);}
    assert.equal((await send('/api/reviewer/login','POST',{...credentials,keepLogin:'false'})).status,400);
    for(const cookie of cookies)assert.equal((await send('/api/reviewer/session','GET',undefined,cookie)).status,200);
    assert.equal((await send('/api/reviewer/logout','POST',{},cookies[1])).status,200);assert.equal((await send('/api/reviewer/session','GET',undefined,cookies[1])).status,401);assert.equal((await send('/api/reviewer/session','GET',undefined,cookies[0])).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
