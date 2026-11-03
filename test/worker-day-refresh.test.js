import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {startWorkerLoads} from '../public/worker-loads.js';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const part=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function screen(){
  class Node {
    constructor(){this.children=[];this._text='';this.hidden=false;this.disabled=false;this.connected=true;}
    set textContent(value){this._text=value;for(const child of this.children)child.connected=false;this.children=[];}
    get textContent(){return this._text;}
    get isConnected(){return this.connected&&(this.parent?this.parent.isConnected:true);}
    append(...nodes){for(const node of nodes){node.parent=this;node.connected=true;this.children.push(node);}}
    replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
    setAttribute(){}
    prepend(...nodes){for(const node of nodes){node.parent=this;node.connected=true;}this.children.unshift(...nodes);}
    after(...nodes){if(!this.parent)return;const index=this.parent.children.indexOf(this);for(const node of nodes){node.parent=this.parent;node.connected=true;}this.parent.children.splice(index+1,0,...nodes);}
    before(...nodes){if(!this.parent)return;const index=this.parent.children.indexOf(this);for(const node of nodes){node.parent=this.parent;node.connected=true;}this.parent.children.splice(index,0,...nodes);}
    remove(){this.connected=false;}
  }
  const elements=Object.fromEntries(['equipment','sober','exercise','briefing','rights'].map(name=>[name,{checked:false}]));
  const form=()=>{const node=new Node(),submit=new Node();node.elements=structuredClone(elements);node.resets=0;node.querySelector=()=>submit;node.querySelectorAll=()=>[];node.reset=()=>{node.resets++;Object.values(node.elements).forEach(input=>input.checked=false);};return node;};
  const documentEvents=new Map(),windowEvents=new Map(),timers=new Map(),requests=[],downloads=[],pads=[],panel=new Node(),checkForm=form(),dailyForm=form(),trainingList=new Node(),training=new Node(),meetings=new Node(),meetingList=new Node(),notices=new Node(),noticeList=new Node(),rights={checked:true},checkStatus=new Node(),dailyStatus=new Node(),message=new Node(),initialLoads=[];
  notices.querySelector=()=>noticeList;meetings.querySelector=()=>meetingList;
  training.querySelector=key=>key==='#training-list'?trainingList:rights;
  const document={visibilityState:'visible',body:new Node(),createElement:()=>{const node=new Node();node.click=()=>downloads.push(node.download);return node;},addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)};
  const window={addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};
  const signaturePad=canvas=>{const pad={clears:0,clear(){this.clears++;},value(){return canvas.signature||'virtual-signature';}};pads.push(pad);return pad;};
  let clock=Date.parse('2032-05-03T04:00:00Z'),timerId=0;
  class Clock extends Date {static now(){return clock;}}
  const context={reportContext:{workerId:1,siteId:7,generation:'original'},siteKey:'virtual-site',panel,logout:{disabled:false},worker:{id:1,site_id:7},button:{disabled:true},message,flow:{open(){context.opened=true;}},document,window,checkForm,checkStatus,check:new Node(),pad:signaturePad({}),dailyForm,dailyStatus,dailyPad:signaturePad({}),training,meetings,notices,initialLoads,educationKinds:{},signaturePad,startWorkerLoads,Date:Clock,performance:{now:()=>clock},AbortController,
    mountWorkerPassword:parent=>parent.append(new Node()),URL:{createObjectURL:()=> 'blob:virtual',revokeObjectURL(){}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options)=>new Promise((resolve,reject)=>{requests.push({url,options,resolve,reject});options?.signal?.addEventListener('abort',()=>reject(Object.assign(Error('timeout'),{name:'AbortError'})));})
  };
  const helper=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8'),functions=helper.slice(helper.indexOf('export function workerDocumentRequest'),helper.indexOf('export async function mountWorkerDocuments')).replaceAll('export ','');
  const code=[functions,
    part('    const workerSiteKey=','    const month='),
    part('    const dailyNames=','    const training=document'),
    part('    const trainingList=','    const meetings=document'),
    part('    const meetingList=','    const instructions=document'),
    part("    const list=notices.querySelector",'    const archive=document'),
    part('    let checkGeneration=','    const stop=document'),
    part('    const dayStatus=','    startWorkerLoads(initialLoads,'),
    'globalThis.actions={refreshWorkerDay,stopWorkerDay,loadDaily,loadTraining,loadCheck,loadNotices,loadMeetings,dayStatus,trainingStatus,noticeStatus};'
  ].join('\n');
  runInNewContext(code,context);
  const reply=async(request,data,status=200)=>{request.resolve({ok:status>=200&&status<300,status,json:async()=>data});await tick();};
  const session=(date='2026-10-31',overrides={})=>({worker:{id:1,site_id:7},reportContext:{workerId:1,siteId:7,generation:'original'},date,serverNow:date+'T14:59:00.000Z',nextDayAt:date+'T15:00:00.000Z',...overrides});
  const pending=url=>requests.filter(request=>request.url===url).at(-1);
  const items=(id=1)=>[{id,type:'education',title:'가상 교육 '+id,body:'가상 내용',details:{},files:[],has_signature:false}];
  const noticeItems=(id=1)=>[{id,title:'가상 공지 '+id,body:'가상 공지 내용',files:[],read_at:null,version:1}];
  const finishLoads=async(check=null,trainingItems=items())=>{await reply(pending('/api/worker/self-check'),{check});await reply(pending('/api/worker/daily-training'),[]);await reply(pending('/api/worker/training'),trainingItems);await reply(pending('/api/worker/notices'),noticeItems());await reply(pending('/api/worker/meetings'),[{id:1,date:'2026-10-31',type:'safety_meeting',title:'가상 회의',details:{},body:'가상 본문',files:[],role:'worker'}]);};
  const start=async(check=null)=>{const work=context.actions.refreshWorkerDay();await reply(pending('/api/worker/session'),session());await work;await finishLoads(check);};
  const event=async(name,hidden=false)=>{document.visibilityState=hidden?'hidden':'visible';(documentEvents.get(name)||windowEvents.get(name))?.();await tick();};
  const fire=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);clock+=timer.delay;timer.fn();await tick();};
  return {context,requests,downloads,timers,panel,meetingList,checkForm,checkStatus,dailyForm,dailyStatus,trainingList,training,noticeList,noticeItems,rights,pads,message,documentEvents,windowEvents,reply,session,pending,items,finishLoads,start,event,fire,tick,advance(ms){clock+=ms;}};
}

test('공지 첨부는 원래 세션을 확인하고 공지 교체·날짜 전환·계정 변경 후 내려받지 않는다',async()=>{
  for(const mode of ['success','replace','day','session']){const ui=screen();await ui.start();const load=ui.context.actions.loadNotices();await ui.reply(ui.pending('/api/worker/notices'),ui.noticeItems().map(item=>({...item,files:[{id:9,name:'가상.txt'}]})));await load;const row=ui.noticeList.children[0],button=row.children[2],pending=button.onclick(),request=ui.pending('/api/worker/notices/1/files/9');assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'original');
    if(mode==='replace'){const next=ui.context.actions.loadNotices();await ui.reply(ui.pending('/api/worker/notices'),ui.noticeItems(2));await next;}if(mode==='day'){await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));}if(mode==='session')request.resolve({ok:false,status:409,json:async()=>({sessionChanged:true,error:'세션 변경'})});else request.resolve({ok:true,status:200,blob:async()=>new Blob(['가상'])});await pending;assert.deepEqual(ui.downloads,mode==='success'?['가상.txt']:[]);if(mode==='session')assert.equal(ui.context.actions.dayStatus.textContent,'세션 변경');
  }
});

test('서버 현장 자정에 완료 점검을 초기화하고 다음 날 점검과 교육을 표시한다',async()=>{
  const ui=screen();await ui.start({date:'2026-10-31',has_signature:true});
  assert.equal(ui.checkForm.hidden,true);assert.equal([...ui.timers.values()][0].delay,60050);
  ui.checkForm.elements.equipment.checked=true;
  await ui.fire();assert.equal(ui.pending('/api/worker/session').url,'/api/worker/session');
  await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));
  await ui.finishLoads(null,ui.items(2));
  assert.equal(ui.checkForm.hidden,false);assert.equal(ui.checkForm.querySelector('button').disabled,false);
  assert.equal(ui.checkForm.resets,1);assert.equal(ui.checkForm.elements.equipment.checked,false);
  assert.match(ui.trainingList.children[0].children[0].textContent,/가상 교육 2/);
});

test('앱 복귀의 중복 이벤트는 한 번 조회하며 미제출 점검·일일교육·동일 문서 서명을 보존한다',async()=>{
  const ui=screen();await ui.start();
  const row=ui.trainingList.children[0],canvas=row.children[2];canvas.signature='작성 중 서명';
  ui.checkForm.elements.equipment.checked=true;ui.dailyForm.elements.rights.checked=true;
  const count=ui.requests.length;
  await ui.event('visibilitychange',true);assert.equal(ui.timers.size,0);
  await ui.event('visibilitychange');await ui.event('pageshow');await ui.event('focus');
  assert.equal(ui.requests.length,count+1);
  await ui.reply(ui.pending('/api/worker/session'),ui.session());await ui.finishLoads();
  assert.equal(ui.checkForm.elements.equipment.checked,true);assert.equal(ui.dailyForm.elements.rights.checked,true);
  assert.equal(ui.trainingList.children[0],row);assert.equal(row.children[2].signature,'작성 중 서명');
  assert.equal(ui.checkForm.resets,0);
});

test('새 날짜의 미제출 점검 입력과 일일교육 입력은 보존한다',async()=>{
  const ui=screen();await ui.start();ui.checkForm.elements.sober.checked=true;ui.dailyForm.elements.rights.checked=true;
  await ui.event('focus');await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.finishLoads();
  assert.equal(ui.checkForm.elements.sober.checked,true);assert.equal(ui.dailyForm.elements.rights.checked,true);assert.equal(ui.checkForm.resets,0);
});

test('전날의 지연 조회와 실패는 다음 날 화면을 덮어쓰지 않는다',async()=>{
  const ui=screen();await ui.start();
  const oldCheck=ui.context.actions.loadCheck(),checkRequest=ui.pending('/api/worker/self-check');
  const oldTraining=ui.context.actions.loadTraining(),trainingRequest=ui.pending('/api/worker/training');
  const oldDaily=ui.context.actions.loadDaily(),dailyRequest=ui.pending('/api/worker/daily-training');
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.finishLoads(null,ui.items(2));
  await ui.reply(checkRequest,{check:{date:'2026-10-31',has_signature:true}});
  await ui.reply(trainingRequest,ui.items(1));dailyRequest.reject(Error('전날 오류'));
  await Promise.all([oldCheck,oldTraining,oldDaily]);
  assert.equal(ui.checkForm.hidden,false);assert.match(ui.trainingList.children[0].children[0].textContent,/교육 2/);
  assert.equal(ui.dailyStatus.textContent,'오늘 기록이 없습니다.');
});

test('통신 오류는 입력을 보존하고 재시도하며 자정 타이머를 넘기지 않는다',async()=>{
  const ui=screen();await ui.start();ui.checkForm.elements.exercise.checked=true;
  await ui.event('focus');ui.pending('/api/worker/session').reject(Error('연결 실패'));await ui.tick();
  assert.match(ui.context.actions.dayStatus.textContent,/연결 실패/);assert.equal([...ui.timers.values()][0].delay,60000);
  assert.equal(ui.checkForm.elements.exercise.checked,true);
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.finishLoads();
  assert.equal(ui.context.actions.dayStatus.textContent,'');assert.equal(ui.checkForm.hidden,false);
  const load=ui.context.actions.loadCheck();await ui.reply(ui.pending('/api/worker/self-check'),{error:'점검 조회 실패'},500);await load;
  assert.match(ui.checkStatus.textContent,/조회 실패/);assert.equal(ui.checkForm.elements.exercise.checked,true);assert.equal(ui.timers.size,1);
});

test('세션 만료와 다른 근로자·현장 세션은 패널과 갱신 이벤트를 종료한다',async()=>{
  for(const scenario of ['expired','worker','site']){
    const ui=screen();await ui.start();const before=ui.requests.length;await ui.event('focus');
    const data=ui.session();if(scenario==='worker')data.worker.id=2;if(scenario==='site')data.worker.site_id=8;
    await ui.reply(ui.pending('/api/worker/session'),scenario==='expired'?{error:'로그인 만료'}:data,scenario==='expired'?401:200);
    assert.equal(ui.panel.isConnected,false,scenario);assert.equal(ui.context.opened,true);
    assert.equal(ui.timers.size,0);assert.equal(ui.documentEvents.size,0);assert.equal(ui.windowEvents.size,0);
    assert.equal(ui.requests.length,before+1);
  }
});

test('로그아웃 또는 현장 주소 변경 뒤 지연 응답은 적용하지 않는다',async()=>{
  for(const scenario of ['logout','site','removed']){
    const ui=screen();await ui.start();const old=ui.context.actions.loadCheck(),request=ui.pending('/api/worker/self-check');
    if(scenario==='logout')ui.context.logout.disabled=true;
    if(scenario==='site')ui.context.siteKey='another-site';
    if(scenario==='removed')ui.panel.remove();
    await ui.reply(request,{check:{date:'2026-10-31',has_signature:true}});await old;
    assert.equal(ui.checkForm.hidden,false,scenario);
    if(scenario!=='logout'){await ui.context.actions.refreshWorkerDay();assert.equal(ui.timers.size,0);}
  }
});

test('숨김 중 시작한 세션 응답은 다시 복귀한 최신 조회를 덮어쓰지 않는다',async()=>{
  const ui=screen();await ui.start();await ui.event('focus');const old=ui.pending('/api/worker/session');
  await ui.event('visibilitychange',true);await ui.event('visibilitychange');const current=ui.pending('/api/worker/session');
  assert.notEqual(old,current);await ui.reply(current,ui.session('2026-11-01'));await ui.finishLoads(null,ui.items(2));
  await ui.reply(old,ui.session('2026-10-31',{worker:{id:3,site_id:9}}));
  assert.equal(ui.panel.isConnected,true);assert.match(ui.trainingList.children[0].children[0].textContent,/교육 2/);
});

test('점검 저장보다 먼저 시작된 조회는 저장 결과를 되돌리지 않고 저장 실패 시 재시도 가능하다',async()=>{
  const ui=screen();await ui.start();const old=ui.context.actions.loadCheck(),oldRequest=ui.pending('/api/worker/self-check');
  const action=ui.checkForm.onsubmit({preventDefault(){}}),save=ui.pending('/api/worker/self-check');
  assert.equal(save.options.method,'POST');
  await ui.reply(save,{check:{date:'2026-10-31',has_signature:true}});await action;
  await ui.reply(oldRequest,{check:null});await old;assert.equal(ui.checkForm.hidden,true);
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.finishLoads();
  const failed=ui.checkForm.onsubmit({preventDefault(){}});
  await ui.reply(ui.pending('/api/worker/self-check'),{error:'저장 실패'},500);await failed;
  assert.equal(ui.checkForm.querySelector('button').disabled,false);assert.match(ui.checkStatus.textContent,/저장 실패/);
});

test('전날 점검 저장이 자정을 넘어 끝나면 새 날짜를 재조회한다',async()=>{
  const ui=screen();await ui.start();const action=ui.checkForm.onsubmit({preventDefault(){}}),save=ui.pending('/api/worker/self-check');
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));
  await ui.reply(ui.pending('/api/worker/daily-training'),[]);await ui.reply(ui.pending('/api/worker/training'),ui.items(2));
  await ui.reply(save,{check:{date:'2026-10-31',has_signature:true}});await action;
  const current=ui.pending('/api/worker/self-check');assert.notEqual(current,save);assert.equal(current.options.method,undefined);assert.equal(JSON.parse(current.options.headers['X-Worker-Report-Context']).generation,'original');
  await ui.reply(current,{check:null});assert.equal(ui.checkForm.hidden,false);assert.equal(ui.checkForm.querySelector('button').disabled,false);
});

test('자정 뒤 반복 통신 실패도 60초 간격으로 재시도한다',async()=>{
  const ui=screen();await ui.start();await ui.fire();
  ui.pending('/api/worker/session').reject(Error('자정 연결 실패'));await ui.tick();assert.equal([...ui.timers.values()][0].delay,60000);
  await ui.fire();ui.pending('/api/worker/session').reject(Error('계속 실패'));await ui.tick();assert.equal([...ui.timers.values()][0].delay,60000);
});

test('유효하지 않은 날짜 계약은 조회와 제출을 차단하고 재시도한다',async()=>{
  for(const overrides of [{date:'bad'},{nextDayAt:'bad'},{nextDayAt:'2026-10-31T14:59:00.000Z'}]){
    const ui=screen();const query=ui.context.actions.refreshWorkerDay();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-10-31',overrides));await query;
    await ui.checkForm.onsubmit({preventDefault(){}});
    assert.equal(ui.requests.length,1);assert.match(ui.context.actions.dayStatus.textContent,/현장 날짜/);assert.equal(ui.timers.size,1);
  }
});

test('교육 조회 실패는 작성 중 서명을 유지하고 최신 조회가 오래된 결과보다 우선한다',async()=>{
  const ui=screen();await ui.start();const row=ui.trainingList.children[0];row.children[2].signature='보존할 서명';
  const old=ui.context.actions.loadTraining(),oldRequest=ui.pending('/api/worker/training');
  const failed=ui.context.actions.loadTraining();await ui.reply(ui.pending('/api/worker/training'),{error:'교육 오류'},500);await failed;
  assert.equal(ui.trainingList.children[0],row);assert.equal(row.children[2].signature,'보존할 서명');assert.match(ui.context.actions.trainingStatus.textContent,/교육 오류/);
  const current=ui.context.actions.loadTraining();await ui.reply(ui.pending('/api/worker/training'),ui.items(2));await current;
  await ui.reply(oldRequest,ui.items(1));await old;assert.match(ui.trainingList.children[0].children[0].textContent,/교육 2/);
  const count=ui.requests.length;await row.children[4].onclick();assert.equal(ui.requests.length,count);
});

test('일일교육 저장은 중복을 막고 실패 시 입력을 보존하며 자정 뒤에는 새 날짜를 조회한다',async()=>{
  const ui=screen();await ui.start();ui.dailyForm.elements.rights.checked=true;
  const failed=ui.dailyForm.onsubmit({preventDefault(){}}),request=ui.pending('/api/worker/daily-training'),count=ui.requests.length;
  await ui.dailyForm.onsubmit({preventDefault(){}});assert.equal(ui.requests.length,count);
  await ui.reply(request,{error:'교육 저장 실패'},500);await failed;
  assert.equal(ui.dailyForm.querySelector('button').disabled,false);assert.match(ui.dailyStatus.textContent,/교육 저장 실패/);assert.equal(ui.dailyForm.elements.rights.checked,true);
  const saved=ui.dailyForm.onsubmit({preventDefault(){}}),saveRequest=ui.pending('/api/worker/daily-training');
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));
  await ui.reply(ui.pending('/api/worker/self-check'),{check:null});await ui.reply(ui.pending('/api/worker/training'),ui.items(2));
  await ui.reply(saveRequest,{ok:true});await saved;
  const current=ui.pending('/api/worker/daily-training');assert.notEqual(current,saveRequest);await ui.reply(current,[]);
  assert.equal(ui.dailyStatus.textContent,'오늘 기록이 없습니다.');assert.equal(ui.dailyForm.querySelector('button').disabled,false);
});

test('교육 서명 저장 중 복귀해도 동일 문서를 유지하고 저장 결과를 다시 조회한다',async()=>{
  const ui=screen();await ui.start();const row=ui.trainingList.children[0],button=row.children[4];
  const action=button.onclick(),save=ui.pending('/api/worker/training'),count=ui.requests.length;await button.onclick();assert.equal(ui.requests.length,count);
  await ui.event('focus');await ui.reply(ui.pending('/api/worker/session'),ui.session());await ui.finishLoads();assert.equal(ui.trainingList.children[0],row);
  await ui.reply(save,{ok:true});const refreshed=ui.pending('/api/worker/training');assert.notEqual(refreshed,save);
  await ui.reply(refreshed,ui.items().map(item=>({...item,has_signature:true})));await action;
  assert.match(ui.trainingList.children[0].children[2].textContent,/서명 완료/);
});

test('서버가 주는 23시간 또는 25시간 날짜 경계를 그대로 예약한다',async()=>{
  for(const hours of [23,25]){
    const ui=screen(),query=ui.context.actions.refreshWorkerDay(),serverNow='2026-11-01T04:00:00.000Z',nextDayAt=new Date(Date.parse(serverNow)+hours*3600000).toISOString();
    await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01',{serverNow,nextDayAt}));await query;
    assert.equal([...ui.timers.values()][0].delay,hours*3600000+50);
  }
});

test('공지 서명은 복귀 조회에 보존되고 자정에는 다음 날 목록으로 바뀐다',async()=>{
  const ui=screen();await ui.start();const row=ui.noticeList.children[0];row.children[2].signature='미완료 공지 서명';
  await ui.event('focus');await ui.reply(ui.pending('/api/worker/session'),ui.session());await ui.finishLoads();
  assert.equal(ui.noticeList.children[0],row);assert.equal(row.children[2].signature,'미완료 공지 서명');
  const old=ui.context.actions.loadNotices(),oldRequest=ui.pending('/api/worker/notices');
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));
  assert.equal(ui.noticeList.children.length,0);
  await ui.reply(ui.pending('/api/worker/notices'),ui.noticeItems(2));
  await ui.reply(oldRequest,ui.noticeItems(1));await old;
  assert.match(ui.noticeList.children[0].children[0].textContent,/공지 2/);
  const count=ui.requests.length;await row.children[4].onclick();assert.equal(ui.requests.length,count);
});

test('공지 조회·저장 오류는 서명을 보존하고 저장 충돌은 현재 문서를 다시 표시한다',async()=>{
  const ui=screen();await ui.start();const row=ui.noticeList.children[0],confirm=row.children[4];row.children[2].signature='보존할 공지 서명';
  const load=ui.context.actions.loadNotices();await ui.reply(ui.pending('/api/worker/notices'),{error:'공지 조회 실패'},500);await load;
  assert.equal(ui.noticeList.children[0],row);assert.equal(row.children[2].signature,'보존할 공지 서명');
  const fail=confirm.onclick();await ui.reply(ui.pending('/api/worker/notices/1/confirm'),{error:'공지 저장 실패'},500);await fail;
  assert.equal(confirm.disabled,false);assert.match(ui.context.actions.noticeStatus.textContent,/공지 저장 실패/);
  const action=confirm.onclick(),request=ui.pending('/api/worker/notices/1/confirm'),count=ui.requests.length;await confirm.onclick();assert.equal(ui.requests.length,count);
  assert.equal(JSON.parse(request.options.body).version,1);
  await ui.reply(request,{error:'공지 내용 변경'},409);await ui.reply(ui.pending('/api/worker/notices'),ui.noticeItems().map(item=>({...item,version:2,body:'수정 공지'})));await action;
  assert.notEqual(ui.noticeList.children[0],row);assert.equal(ui.noticeList.children[0].children[1].textContent,'수정 공지');assert.match(ui.context.actions.noticeStatus.textContent,/공지 내용 변경/);
});

test('전날 공지 저장의 지연 실패는 오늘 공지에 표시되지 않는다',async()=>{
  const ui=screen();await ui.start();const action=ui.noticeList.children[0].children[4].onclick(),request=ui.pending('/api/worker/notices/1/confirm');
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.reply(ui.pending('/api/worker/notices'),ui.noticeItems(2));
  await ui.reply(request,{error:'전날 저장 실패'},500);await action;
  assert.equal(ui.context.actions.noticeStatus.textContent,'');assert.match(ui.noticeList.children[0].children[0].textContent,/공지 2/);
});

test('실제 showWorker 배치 구문에서 모든 업무 영역은 패널 자식이며 세션 종료 때 함께 제거된다',async()=>{
  const ui=screen();await ui.start();
  const names=['ppe','daily','training','meetings','instructions','notices','archive','check','stop','hazard'];
  const placement=source.split('\n').filter(line=>names.some(name=>line.startsWith('    const '+name+"=document.createElement('section');"))).join('\n');
  assert.equal(placement.split('\n').length,names.length);
  const context={panel:ui.panel,document:ui.context.document,button:ui.context.button,flow:ui.context.flow,message:ui.message,stopWorkerDay:ui.context.actions.stopWorkerDay};
  const end=source.split('\n').find(line=>line.startsWith('    function endWorkerDay('));assert.ok(end);
  runInNewContext(placement+'\n'+end+'\nglobalThis.sections=['+names.join(',')+'];globalThis.end=endWorkerDay;',context);
  for(const section of context.sections){assert.equal(section.parent,ui.panel);assert.equal(section.isConnected,true);}
  context.end('로그인 만료');
  for(const section of context.sections)assert.equal(section.isConnected,false);
  assert.equal(ui.panel.isConnected,false);assert.equal(ui.documentEvents.size,0);assert.equal(ui.windowEvents.size,0);assert.equal(ui.timers.size,0);
});

test('세션 응답 지연을 자정 예약에서 빼고 이미 지난 경계는 제한적으로 재확인한다',async()=>{
  const ui=screen();let query=ui.context.actions.refreshWorkerDay();ui.advance(5000);
  await ui.reply(ui.pending('/api/worker/session'),ui.session());await query;assert.equal([...ui.timers.values()][0].delay,55050);
  await ui.finishLoads();await ui.event('focus');ui.advance(1500);
  const near=ui.session('2026-10-31',{serverNow:'2026-10-31T14:59:59.000Z'});
  await ui.reply(ui.pending('/api/worker/session'),near);assert.equal([...ui.timers.values()][0].delay,50);
  const before=ui.requests.length;await ui.checkForm.onsubmit({preventDefault(){}});assert.equal(ui.requests.length,before);
  await ui.fire();ui.advance(1500);await ui.reply(ui.pending('/api/worker/session'),near);assert.equal([...ui.timers.values()][0].delay,60000);
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session('2026-11-01'));await ui.finishLoads();assert.equal(ui.checkForm.hidden,false);
});

test('응답 없는 세션 확인은 15초에 중단하고 60초 뒤 재시도한다',async()=>{
  const ui=screen(),query=ui.context.actions.refreshWorkerDay();
  assert.equal([...ui.timers.values()][0].delay,15000);await ui.fire();await query;
  assert.match(ui.context.actions.dayStatus.textContent,/시간이 초과/);assert.equal([...ui.timers.values()][0].delay,60000);
  await ui.fire();await ui.reply(ui.pending('/api/worker/session'),ui.session());await ui.finishLoads();assert.equal(ui.checkForm.hidden,false);
});

test('같은 근로자의 다른 로그인 세대는 기존 입력을 보존하고 저장을 멈춘다',async()=>{const ui=screen();await ui.start();ui.checkForm.elements.sober.checked=true;await ui.event('focus');await ui.reply(ui.pending('/api/worker/session'),ui.session(undefined,{reportContext:{workerId:1,siteId:7,generation:'new'}}));const before=ui.requests.length;await ui.checkForm.onsubmit({preventDefault(){}});assert.equal(ui.requests.length,before);assert.equal(ui.panel.isConnected,true);assert.equal(ui.checkForm.elements.sober.checked,true);assert.match(ui.context.actions.dayStatus.textContent,/입력 내용을 복사/);});
test('공지 세션409는 서명과 기존 화면을 보존한다',async()=>{const ui=screen();await ui.start();const row=ui.noticeList.children[0],button=row.children.at(-1);row.children[2].signature='가상 보존';const action=button.onclick(),request=ui.pending('/api/worker/notices/1/confirm'),before=ui.requests.length;assert.equal(JSON.parse(request.options.body).reportContext.generation,'original');await ui.reply(request,{error:'입력 내용을 복사',sessionChanged:true},409);await action;assert.equal(ui.requests.length,before);assert.equal(ui.noticeList.children[0],row);assert.equal(row.children[2].signature,'가상 보존');assert.equal(button.disabled,false);});

test('공지와 교육 조회가 다른 로그인으로 전환되면 입력을 보존하고 이후 저장을 멈춘다',async()=>{
  for(const [path,load,list] of [['/api/worker/notices','loadNotices','noticeList'],['/api/worker/training','loadTraining','trainingList']]){
    const ui=screen();await ui.start();const row=ui[list].children[0],canvas=row.children[2];canvas.signature='보존할 가상 서명';
    const pending=ui.context.actions[load](),request=ui.pending(path);assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'original');
    await ui.reply(request,{error:'입력 내용을 복사한 뒤 다시 로그인해 주세요.',sessionChanged:true},409);await pending;
    assert.equal(ui[list].children[0],row);assert.equal(canvas.signature,'보존할 가상 서명');assert.match(ui.context.actions.dayStatus.textContent,/입력 내용을 복사/);
    const count=ui.requests.length;await row.children[4].onclick();assert.equal(ui.requests.length,count);
  }
});

test('오래된 공지·교육 조회의 세션 오류는 최신 화면을 중단하지 않는다',async()=>{
  for(const [path,load,list] of [['/api/worker/notices','loadNotices','noticeList'],['/api/worker/training','loadTraining','trainingList']]){
    const ui=screen();await ui.start();const old=ui.context.actions[load](),oldRequest=ui.pending(path),current=ui.context.actions[load](),currentRequest=ui.pending(path);
    await ui.reply(currentRequest,path.endsWith('notices')?ui.noticeItems():ui.items());await current;
    await ui.reply(oldRequest,{error:'이전 세션',sessionChanged:true},409);await old;assert.equal(ui.context.actions.dayStatus.textContent,'');
    const before=ui.requests.length,action=ui[list].children[0].children[4].onclick();assert.equal(ui.requests.length,before+1);await ui.reply(ui.requests.at(-1),{error:'가상 저장 오류'},400);await action;
  }
});

test('자가점검·일일교육·회의 조회의 계정 변경은 작성 중 입력을 보존한다',async()=>{
  for(const [path,load] of [['/api/worker/self-check','loadCheck'],['/api/worker/daily-training','loadDaily'],['/api/worker/meetings','loadMeetings']]){
    const ui=screen();await ui.start();ui.checkForm.elements.sober.checked=true;ui.dailyForm.elements.rights.checked=true;const row=ui.meetingList.children[0],canvas=row.children[3];canvas.signature='보존할 회의 서명';
    const pending=ui.context.actions[load](),request=ui.pending(path);assert.equal(JSON.parse(request.options.headers['X-Worker-Report-Context']).generation,'original');await ui.reply(request,{error:'입력 내용을 복사한 뒤 다시 로그인해 주세요.',sessionChanged:true},409);await pending;
    assert.equal(ui.checkForm.elements.sober.checked,true);assert.equal(ui.dailyForm.elements.rights.checked,true);assert.equal(ui.meetingList.children[0],row);assert.equal(canvas.signature,'보존할 회의 서명');assert.match(ui.context.actions.dayStatus.textContent,/입력 내용을 복사/);
    const before=ui.requests.length;await row.children[5].onclick();await ui.checkForm.onsubmit({preventDefault(){}});await ui.dailyForm.onsubmit({preventDefault(){}});assert.equal(ui.requests.length,before);
  }
});

test('이전 자가점검·일일교육·회의 조회의 세션 오류는 최신 조회를 중단하지 않는다',async()=>{
  for(const [path,load] of [['/api/worker/self-check','loadCheck'],['/api/worker/daily-training','loadDaily'],['/api/worker/meetings','loadMeetings']]){
    const ui=screen();await ui.start();const old=ui.context.actions[load](),oldRequest=ui.pending(path),current=ui.context.actions[load](),currentRequest=ui.pending(path),data=path.endsWith('self-check')?{check:null}:path.endsWith('daily-training')?[]:[{id:1,date:'2026-10-31',type:'safety_meeting',title:'가상 회의',details:{},body:'가상 본문',files:[],role:'worker'}];
    await ui.reply(currentRequest,data);await current;await ui.reply(oldRequest,{error:'이전 세션',sessionChanged:true},409);await old;assert.equal(ui.context.actions.dayStatus.textContent,'');
    const before=ui.requests.length,action=ui.meetingList.children[0].children[5].onclick();assert.equal(ui.requests.length,before+1);await ui.reply(ui.requests.at(-1),{error:'가상 저장 오류'},400);await action;
  }
});

test('한 일일 조회에서 계정 변경을 감지하면 동시에 진행 중인 다른 응답도 반영하지 않는다',async()=>{
  for(const first of ['notice','training']){
    const ui=screen();await ui.start();const noticeRow=ui.noticeList.children[0],trainingRow=ui.trainingList.children[0];
    const notice=ui.context.actions.loadNotices(),noticeRequest=ui.pending('/api/worker/notices'),training=ui.context.actions.loadTraining(),trainingRequest=ui.pending('/api/worker/training');
    if(first==='notice'){await ui.reply(noticeRequest,{error:'계정 변경',sessionChanged:true},409);await notice;await ui.reply(trainingRequest,ui.items(99));await training;}
    else{await ui.reply(trainingRequest,{error:'계정 변경',sessionChanged:true},409);await training;await ui.reply(noticeRequest,ui.noticeItems(99));await notice;}
    assert.equal(ui.noticeList.children[0],noticeRow);assert.equal(ui.trainingList.children[0],trainingRow);assert.match(ui.context.actions.dayStatus.textContent,/계정 변경/);
  }
});

test('회의도 최초 세션으로 제출하고 409와 복귀 조회에서 서명을 유지한다',async()=>{const ui=screen();await ui.start();const row=ui.meetingList.children[0],button=row.children[5],canvas=row.children[3];canvas.signature='가상 유지';const action=button.onclick(),request=ui.pending('/api/worker/meetings');assert.equal(JSON.parse(request.options.body).reportContext.generation,'original');await ui.reply(request,{error:'입력 내용을 복사',sessionChanged:true},409);await action;assert.equal(ui.meetingList.children[0],row);assert.equal(canvas.signature,'가상 유지');assert.equal(button.disabled,false);await ui.event('focus');await ui.reply(ui.pending('/api/worker/session'),ui.session());await ui.finishLoads();assert.equal(ui.meetingList.children[0],row);assert.equal(canvas.signature,'가상 유지');await ui.event('visibilitychange',true);const count=ui.requests.length;await button.onclick();assert.equal(ui.requests.length,count);});
