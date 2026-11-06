import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(doc.type==='instruction'){\n    const result=await api"),end=source.indexOf("  if(doc.type==='notice'){",start);assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
function screen(api){let active=true;const writes=[],context={doc:{id:7,type:'instruction',status:'approved'},api,currentDetail:()=>active,content:{insertAdjacentHTML:(_where,html)=>writes.push(html)},esc:value=>String(value??''),$:()=>null};return {writes,stop:()=>{active=false;},run:()=>runInNewContext(`(async()=>{${source.slice(start,end)}})()`,context)};}

test('지시서 조치 조회가 늦게 끝나면 이동한 화면을 변경하지 않는다',async()=>{
  const wait=deferred(),ui=screen(()=>wait.promise),pending=ui.run();ui.stop();wait.resolve({actor:'이전 가상 사용자',content:'이전 가상 내용'});await pending;assert.deepEqual(ui.writes,[]);
});

test('지시서 사진 조회가 늦게 끝나면 이동한 화면에 사진을 추가하지 않는다',async()=>{
  const wait=deferred(),ui=screen(path=>path.endsWith('/instruction-result')?Promise.resolve({actor:'가상',content:'조치',source:'manager',date:'2026-11-06'}):wait.promise),pending=ui.run();await new Promise(setImmediate);assert.equal(ui.writes.length,1);ui.stop();wait.resolve([{id:1,name:'이전 가상 사진.gif',phase:'before',size:40}]);await pending;assert.equal(ui.writes.length,1);
});


test('이전 지시서의 조회 실패는 새 화면에 전달하지 않는다',async()=>{
  for(const which of ['result','photos']){const wait=deferred(),ui=screen(path=>which==='photos'&&path.endsWith('/instruction-result')?Promise.resolve({actor:'가상',content:'조치',source:'manager',date:'2026-11-06'}):wait.promise),pending=ui.run();if(which==='photos')await new Promise(setImmediate);ui.stop();wait.reject(Error('이전 요청 실패'));await assert.doesNotReject(pending);}
});
