import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('근로자 로그아웃은 원래 화면 세션을 보내고 변경 시 화면을 보존한다',async()=>{
  const line=readFileSync(new URL('../public/join.js',import.meta.url),'utf8').split('\n').find(value=>value.includes("const logout=panel.querySelector('#worker-logout')"));assert.ok(line);
  const logout={disabled:false},panel={isConnected:true,querySelector:()=>logout,remove(){this.isConnected=false;}},message={textContent:''},requests=[],reportContext={workerId:1,siteId:2,generation:'old'};let stopped=0;
  const context={panel,message,reportContext,button:{disabled:false},stopWorkerDay:()=>stopped++,refreshWorkerDay:async()=>{},fetch:async(path,options)=>{requests.push({path,options});return {ok:false,json:async()=>({sessionChanged:true,error:'계정 변경'})};}};
  runInNewContext(line,context);await logout.onclick();assert.equal(requests[0].path,'/api/worker/logout');assert.equal(JSON.parse(requests[0].options.headers['X-Worker-Report-Context']).generation,'old');assert.equal(stopped,1);assert.equal(panel.isConnected,true);assert.equal(message.textContent,'계정 변경');assert.equal(logout.disabled,false);
});
