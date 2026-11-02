import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {mountBoardComments} from '../public/board-comments.js';

test('직원 화면과 실제 HTTP: 다른 탭의 로그인 뒤 기존 댓글 초안을 보존한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-review-context-ui-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  const nativeFetch=globalThis.fetch,previousLocation=globalThis.location,previousDocument=globalThis.document;
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>nativeFetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    for(const id of ['ui_context_one','ui_context_two'])assert.equal((await send('/api/reviewers','POST',{siteId:site.id,loginId:id,name:id,password:'virtual-password-123'},admin)).status,201);
    let cookie='';globalThis.location=new URL(base+'/review');globalThis.fetch=async(input,options={})=>{const url=new URL(input instanceof Request?input.url:input,location.href),method=options.method||(input instanceof Request?input.method:'GET'),headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));if(cookie)headers.set('cookie',cookie);if(!['GET','HEAD'].includes(method))headers.set('origin',base);const response=await nativeFetch(url,{...options,method,headers}),setCookie=response.headers.get('set-cookie');if(setCookie?.startsWith('jweb_reviewer='))cookie=setCookie.split(';')[0];return response;};
    const {bindReviewerSession,clearReviewerSession}=await import('../public/reviewer-session.js?integration-test');
    const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=source.indexOf('async function api('),end=source.indexOf('\n',start);assert.ok(start>=0&&end>start);const api=runInNewContext(source.slice(start,end)+';api;',{fetch:(...args)=>globalThis.fetch(...args),bindReviewerSession,clearReviewerSession});
    await api('/api/reviewer/login',{method:'POST',body:JSON.stringify({loginId:'ui_context_one',password:'virtual-password-123'})});const session=await api('/api/reviewer/session'),post=await api('/api/reviewer/board-posts',{method:'POST',body:JSON.stringify({kind:'community_info',title:'가상 글',body:'본문',secret:false})});
    class Element{constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;this.hidden=false;this.value='';}append(...items){for(const item of items){item.parent=this;this.children.push(item);}}replaceChildren(){this.children=[];}setAttribute(){}set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text||'';}}
    globalThis.document={createElement:tag=>new Element(tag)};const article=new Element('article');mountBoardComments(article,{row:post,base:'/api/reviewer/board-posts',actorId:session.reviewer.id,api,active:()=>true});article.children[0].onclick();const area=article.children[1];
    for(let i=0;i<100&&!area.children.some(node=>node.tag==='form');i++)await new Promise(resolve=>setTimeout(resolve,10));
    const form=area.children.find(node=>node.tag==='form');assert.ok(form);const input=form.children[0].children[0],status=form.children[2];input.value='보존할 가상 댓글';
    const other=await send('/api/reviewer/login','POST',{loginId:'ui_context_two',password:'virtual-password-123'},cookie);assert.equal(other.status,200);cookie=other.headers.get('set-cookie').split(';')[0];const otherSession=await (await send('/api/reviewer/session','GET',undefined,cookie)).json();
    await form.onsubmit({preventDefault(){}});assert.equal(input.value,'보존할 가상 댓글');assert.match(status.textContent,/세션이 변경/);assert.equal(form.children[1].disabled,false);
    const rows=await (await nativeFetch(base+`/api/reviewer/board-posts/${post.id}/comments?version=${post.version}`,{headers:{cookie,'x-reviewer-context':otherSession.context}})).json();assert.deepEqual(rows,[]);
  }finally{globalThis.fetch=nativeFetch;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
