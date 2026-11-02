import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerInvitation,setWorkerInvitationMode} from '../public/worker-invitation.js';

function node(tag=''){
  let text='';return {tag,children:[],isConnected:true,attributes:{},set textContent(value){text=value;this.children=[];},get textContent(){return text;},append(...items){this.children.push(...items);},after(item){this.next=item;},replaceChildren(...items){this.children=items;text='';},setAttribute(key,value){this.attributes[key]=value;}};
}
const doc={createElement:node},worker={id:3,site_id:2,name:'가상 출입자',version:'a'.repeat(64),has_account:0};

test('개인 가입은 기존 구분 입력을 숨기고 일반 가입 복귀 때 다시 표시한다',()=>{
  const message={},labels={},elements=Object.fromEntries(['category','company','occupation'].map(name=>{labels[name]={};return [name,{closest:()=>labels[name]}];}));
  const form={elements,querySelector:()=>message};setWorkerInvitationMode(form,true);
  for(const name of Object.keys(elements)){assert.equal(elements[name].disabled,true);assert.equal(labels[name].hidden,true);}assert.match(message.textContent,/기존 구분/);
  setWorkerInvitationMode(form,false);for(const name of Object.keys(elements)){assert.equal(elements[name].disabled,false);assert.equal(labels[name].hidden,false);}assert.match(message.textContent,/협력업체/);
});

test('관리자는 선택한 출입자의 개인 QR만 발급하고 닫을 수 있다',async()=>{
  const saved=globalThis.location;globalThis.location={origin:'https://example.test'};try{
    const anchor=node(),calls=[];let release;const api=(path,options)=>{calls.push({path,options});return new Promise(resolve=>{release=resolve;});};
    mountWorkerInvitation(anchor,worker,api,()=>true,doc);const [button,result]=anchor.next.children;
    const pending=button.onclick();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.length,1);
    assert.equal(calls[0].path,'/api/workers/3/invitation');assert.deepEqual(JSON.parse(calls[0].options.body),{siteId:2,version:worker.version});
    const link='https://example.test/join?token='+'x'.repeat(43);release({link,image:'data:image/png;base64,AAAA',expiresAt:Date.now()+10000});await pending;
    assert.equal(button.disabled,false);assert.equal(result.children[0].alt,'개인 가입 QR 코드');assert.equal(result.children[1].value,link);assert.match(result.children[2].textContent,/이전 주소는 중지/);
    result.children[3].onclick();assert.equal(result.children.length,0);
    const withAccount=node();mountWorkerInvitation(withAccount,{...worker,has_account:1},api,()=>true,doc);assert.equal(withAccount.next,undefined);
  }finally{globalThis.location=saved;}
});

test('화면 전환 뒤 늦은 QR과 다른 출처의 QR을 표시하지 않는다',async()=>{
  const saved=globalThis.location;globalThis.location={origin:'https://example.test'};try{
    let current=true,release;const anchor=node(),api=()=>new Promise(resolve=>{release=resolve;});mountWorkerInvitation(anchor,worker,api,()=>current,doc);
    const [button,result]=anchor.next.children,pending=button.onclick();current=false;release({link:'https://example.test/join?token='+'x'.repeat(43),image:'data:image/png;base64,AAAA',expiresAt:Date.now()+10000});await pending;assert.equal(result.children.length,0);
    current=true;const retry=button.onclick();release({link:'https://other.test/join?token='+'x'.repeat(43),image:'data:image/png;base64,AAAA',expiresAt:Date.now()+10000});await retry;assert.equal(result.children.length,0);assert.match(result.textContent,/확인/);
  }finally{globalThis.location=saved;}
});
