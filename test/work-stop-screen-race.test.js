import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const from=source.indexOf("  if(state.page==='stops')"),to=source.indexOf("  if(state.page==='incident-guide')",from);
assert.ok(from>=0&&to>from);

test('같은 조건의 늦은 작업중지 목록 응답은 최신 화면을 덮지 않는다',async()=>{
  const pending=[],controls={'#stop-search':{},'#stop-query':{}},muted={},content={innerHTML:'',querySelector:()=>muted},state={page:'stops',siteId:1,query:'',admin:null};
  const context={state,content,detailEpoch:1,encodeURIComponent,api:()=>new Promise(resolve=>pending.push(resolve)),$:selector=>controls[selector],render:async()=>{},showError:error=>{throw error;}};
  const run=runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async(renderEpoch)=>{${source.slice(from,to)}})`,context);
  const first=run(1);context.detailEpoch=2;const second=run(2);
  pending[1]([]);await second;const current=content.innerHTML;
  pending[0]([{requester:'이전 결과',place:'가상 장소',reason:'가상 사유'}]);await first;
  assert.equal(content.innerHTML,current);
});

test('지난 화면의 실패는 무시하고 현재 화면의 실패는 전달한다',async()=>{
  const pending=[],state={page:'stops',siteId:1,query:'',admin:{id:1}},context={state,detailEpoch:1,encodeURIComponent,api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  const run=runInNewContext(`${source.match(/^const esc = .*$/m)[0]}\n(async(renderEpoch)=>{${source.slice(from,to)}})`,context);
  const old=run(1);state.admin={id:2};pending[0].reject(Error('이전 요청 실패'));await old;
  const current=run(1);pending[1].reject(Error('현재 요청 실패'));await assert.rejects(current,/현재 요청 실패/);
});
