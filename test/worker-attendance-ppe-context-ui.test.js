import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const monthLine=source.split('\n').find(line=>line.includes('let monthGeneration=0;const load='));
const start=source.indexOf('    const loadPpe=async()=>'),end=source.indexOf("    ppe.querySelector('button').onclick=loadPpe",start);
assert.ok(monthLine&&start>=0&&end>start);

test('출역과 보호구 조회는 원래 계정으로 보내며 전환 시 입력과 이전 응답을 보존한다',async()=>{
  const requests=[],dayStatus={textContent:''},output={textContent:'이전 출역'},ppeStatus={textContent:''},ppeList={textContent:'작성 중 서명',replaceChildren(){this.textContent='';},append(){}},context={dayStatus,output,ppeStatus,ppeList,ppeRows:new Map(),ppeDrafts:new Set(),ppeGeneration:0,month:{value:'2026-11'},reportContext:{workerId:1,siteId:2,generation:'old'},active:true,workerPanelActive(){return context.active;},stopWorkerDay(){context.active=false;},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  runInNewContext(monthLine+'\n'+source.slice(start,end)+'\nglobalThis.actions={load,loadPpe};',context);
  const attendance=context.actions.load(),ppe=context.actions.loadPpe();
  for(const request of requests)assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'old');
  requests[0].resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'계정 변경'})});await attendance;
  assert.equal(context.active,false);assert.equal(dayStatus.textContent,'계정 변경');
  requests[1].resolve({ok:true,status:200,json:async()=>[]});await ppe;
  assert.equal(ppeList.textContent,'작성 중 서명');assert.equal(output.textContent,'이전 출역');
  await context.actions.load();await context.actions.loadPpe();assert.equal(requests.length,2);
  context.active=true;const ppeAgain=context.actions.loadPpe(),attendanceAgain=context.actions.load();requests[2].resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'보호구 계정 변경'})});await ppeAgain;
  requests[3].resolve({ok:true,status:200,json:async()=>({units:[]})});await attendanceAgain;assert.equal(dayStatus.textContent,'보호구 계정 변경');assert.equal(ppeList.textContent,'작성 중 서명');assert.equal(output.textContent,'이전 출역');
});
