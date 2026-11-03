import test from 'node:test';
import assert from 'node:assert/strict';
import {workerDocumentRequest} from '../public/worker-documents.js';

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
