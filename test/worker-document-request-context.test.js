import test from 'node:test';
import assert from 'node:assert/strict';
import {workerDocumentRequest,downloadWorkerAttachment} from '../public/worker-documents.js';

test('근로자 문서 요청은 화면 세션을 보내고 변경 감지 후 동시에 진행 중인 응답과 저장을 막는다',async()=>{
  const previous=globalThis.fetch,requests=[],changes=[];globalThis.fetch=(path,options)=>new Promise(resolve=>requests.push({path,options,resolve}));
  try{
    const json=workerDocumentRequest({workerId:1,siteId:2,generation:'old'},()=>true,text=>changes.push(text));
    const old=json('/api/worker/documents'),changed=json('/api/worker/document-options?type=risk');old.catch(()=>{});changed.catch(()=>{});
    assert.equal(JSON.parse(requests[0].options.headers['X-Worker-Report-Context']).generation,'old');
    requests[1].resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'계정 변경'})});await assert.rejects(changed,/계정 변경/);
    requests[0].resolve({ok:true,status:200,json:async()=>[{title:'다른 문서'}]});await assert.rejects(old,/로그인 세션/);await assert.rejects(json('/api/worker/documents',{method:'POST',body:'{}'}),/로그인 세션/);assert.deepEqual(changes,['계정 변경']);assert.equal(requests.length,2);
  }finally{globalThis.fetch=previous;}
});

test('일반 문서 충돌은 세션 변경으로 처리하지 않고 다른 요청을 허용한다',async()=>{
  const previous=globalThis.fetch,changes=[];let count=0;globalThis.fetch=async()=>++count===1?{ok:false,status:409,json:async()=>({error:'문서 변경'})}:{ok:true,status:200,json:async()=>({ok:true})};
  try{const json=workerDocumentRequest({workerId:1},()=>true,text=>changes.push(text));await assert.rejects(json('/api/worker/documents/1'),/문서 변경/);assert.deepEqual(await json('/api/worker/documents'),{ok:true});assert.deepEqual(changes,[]);}finally{globalThis.fetch=previous;}
});

test('첨부 다운로드는 최초 세션과 파일 이름을 사용하고 화면 이탈 시 파일을 열지 않는다',async()=>{
  const original={fetch:globalThis.fetch,document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL,timer:globalThis.setTimeout},events=[],blob=new Blob(['가상 첨부']);let active=true,finish;
  globalThis.fetch=(path,options)=>new Promise(resolve=>{events.push({path,options});finish=resolve;});URL.createObjectURL=value=>{assert.equal(value,blob);events.push('create');return 'blob:virtual';};URL.revokeObjectURL=url=>events.push('revoke '+url);globalThis.setTimeout=fn=>{events.push('scheduled');fn();};
  globalThis.document={body:{append:link=>events.push(['append',link])},createElement:()=>({click(){events.push(['click',this.href,this.download]);},remove(){events.push('remove');}})};
  try{
    const request=workerDocumentRequest({workerId:1,generation:'old'},()=>active,()=>{}),path='/api/worker/documents/1/attachments/2';let work=downloadWorkerAttachment(request,path,'가상.txt',()=>active);assert.equal(JSON.parse(events[0].options.headers['X-Worker-Report-Context']).generation,'old');finish({ok:true,status:200,blob:async()=>blob});await work;
    assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='click'&&event[1]==='blob:virtual'&&event[2]==='가상.txt'));assert.ok(events.includes('revoke blob:virtual'));
    events.length=0;work=downloadWorkerAttachment(request,path,'가상.txt',()=>active);active=false;finish({ok:true,status:200,blob:async()=>blob});await assert.rejects(work,/로그인 세션/);assert.equal(events.includes('create'),false);
  }finally{globalThis.fetch=original.fetch;globalThis.document=original.document;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;globalThis.setTimeout=original.timer;}
});
