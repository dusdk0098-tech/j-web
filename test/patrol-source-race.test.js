import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf("    if(select.value==='patrol'){");
const end=source.indexOf("    if(select.value==='inspection'){",start);
assert.ok(start>=0&&end>start);
const row=(title,instruction=title)=>({date:'2026-11-01',title,details:JSON.stringify({instruction})});

// shortcut: 조회·적용 이벤트에 필요한 DOM만 모사하며 화면 배치는 브라우저 시험에서 확인한다.
function screen(){
  const nodes=new Map(),pending=[],saves=[],state={siteId:1,page:'documents'},dialog={open:true,showModal(){this.open=true;},close(){this.open=false;}};
  const makeNode=()=>({isConnected:true,value:'',textContent:'',html:'',buttons:[],dataset:{},
    set innerHTML(value){this.html=value;this.textContent='';this.buttons=[...value.matchAll(/data-patrol-source="(\d+)"/g)].map(([,index])=>({dataset:{patrolSource:index}}));},
    get innerHTML(){return this.html;},
    replaceChildren(){this.innerHTML='';},
    querySelectorAll(selector){if(selector==='[data-patrol-activity]')return [];assert.equal(selector,'[data-patrol-source]');return this.buttons;},addEventListener(){}
  });
  const context={state,dialog,doc:null,actor:null,educationEpoch:1,detailEpoch:1,mountPatrolPrevious:()=>()=>{},confirm:()=>true,URLSearchParams,$:selector=>{assert.ok(nodes.has(selector),selector);return nodes.get(selector);},api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),FormData:class{constructor(){return [['patrolInstruction',nodes.get('#dialog-form [name=patrolInstruction]').value]];}},flash(){},render:async()=>{}};
  const showDialogSource=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick="));
  runInNewContext(source.match(/^const esc = .*$/m)[0]+'\n'+showDialogSource+'\nglobalThis.mount=function(siteId,page,select){const details={},patrolItems=[];\n'+source.slice(start,end)+'\n};',context);
  const open=(siteId=1)=>{
    for(const node of nodes.values())node.isConnected=false;
    nodes.clear();state.siteId=siteId;dialog.open=true;
    for(const key of ['#dialog-form','#dialog-form button[type=submit]','#dialog-title','#dialog-body','#daily-fields','#patrol-activities','#patrol-activity-add','#patrol-items','#patrol-previous','#patrol-previous-list','#dialog-form [name=patrolInspector]','#dialog-form [name=patrolOther]','#dialog-form [name=patrolNotes]','#patrol-sources','#patrol-source-list','#dialog-form [name=date]','#dialog-form [name=patrolInstruction]','#dialog-error'])nodes.set(key,makeNode());
    const date=nodes.get('#dialog-form [name=date]'),target=nodes.get('#dialog-form [name=patrolInstruction]'),error=nodes.get('#dialog-error'),list=nodes.get('#patrol-source-list'),button=nodes.get('#patrol-sources'),select={value:'patrol'};
    date.value='2026-11-01';context.showDialog('가상 순회 작성','',data=>new Promise((resolve,reject)=>saves.push({data,resolve,reject})));context.mount(siteId,state.page,select);
    const form=nodes.get('#dialog-form'),submit=nodes.get('#dialog-form button[type=submit]');
    return {date,target,error,list,select,submit,save:()=>form.onsubmit({preventDefault(){},currentTarget:form}),load:()=>button.onclick(),changeDate(value){date.value=value;date.onchange?.();}};
  };
  return {open,pending,saves,state,dialog};
}

test('순회 지시사항 조회는 현장·날짜를 전송하고 빈 지시를 제외하며 기존 입력을 보존한다',async()=>{
  const ui=screen(),form=ui.open(7),loaded=form.load();
  const url=new URL(ui.pending[0].url,'http://virtual.invalid');
  assert.equal(url.searchParams.get('siteId'),'7');assert.equal(url.searchParams.get('type'),'inspection');assert.equal(url.searchParams.get('to'),'2026-11-01');
  ui.pending[0].resolve([row('<가상 점검>','가상 지시'),row('빈 지시','')]);await loaded;
  assert.equal(form.list.buttons.length,1);assert.match(form.list.innerHTML,/&lt;가상 점검&gt;/);
  form.target.value='직접 작성';form.list.buttons[0].onclick();assert.equal(form.target.value,'직접 작성');assert.match(form.error.textContent,/지운 뒤/);
  form.target.value='';form.list.buttons[0].onclick();assert.equal(form.target.value,'가상 지시');
});

for(const outcome of ['success','error']){
  test(`현장 A 작성창을 닫고 같은 날짜 B 창을 연 뒤 A ${outcome} 응답은 B를 바꾸지 않는다`,async()=>{
    const ui=screen(),a=ui.open(),old=a.load();ui.dialog.open=false;
    const b=ui.open(2),latest=b.load();ui.pending[1].resolve([row('B 가상 자료')]);await latest;
    const before=b.list.innerHTML;b.error.textContent='B 상태';
    if(outcome==='success')ui.pending[0].resolve([row('A 가상 자료')]);else ui.pending[0].reject(Error('A 가상 오류'));
    await old;assert.equal(b.list.innerHTML,before);assert.equal(b.error.textContent,'B 상태');assert.equal(b.target.value,'');
    b.list.buttons[0].onclick();assert.equal(b.target.value,'B 가상 자료');
  });

  test(`같은 창 역순 ${outcome} 응답은 최신 목록과 오류 상태를 유지한다`,async()=>{
    const ui=screen(),form=ui.open(),old=form.load(),latest=form.load();
    ui.pending[1].resolve([row('최신 가상 자료')]);await latest;const before=form.list.innerHTML;form.error.textContent='현재 상태';
    if(outcome==='success')ui.pending[0].resolve([row('이전 가상 자료')]);else ui.pending[0].reject(Error('이전 가상 오류'));
    await old;assert.equal(form.list.innerHTML,before);assert.equal(form.error.textContent,'현재 상태');form.list.buttons[0].onclick();assert.equal(form.target.value,'최신 가상 자료');
  });
}

const changes={
  '날짜 변경':(ui,form)=>form.changeDate('2026-11-02'),
  '날짜 변경 후 복귀':(ui,form)=>{form.changeDate('2026-11-02');form.changeDate('2026-11-01');},
  '종류 변경':(ui,form)=>{form.select.value='inspection';form.list.isConnected=false;},
  '종류 변경 후 순회 재생성':(ui,form)=>{form.list.isConnected=false;ui.open();},
  '현장 변경':ui=>{ui.state.siteId=2;},
  '페이지 변경':ui=>{ui.state.page='workers';},
  '창 닫기':ui=>{ui.dialog.open=false;}
};

for(const [name,change] of Object.entries(changes)){
  for(const outcome of ['success','error'])test(`${name} 후 늦은 ${outcome} 응답을 무시한다`,async()=>{
    const ui=screen(),form=ui.open(),loaded=form.load();change(ui,form);form.error.textContent='보존 상태';
    if(outcome==='success')ui.pending[0].resolve([row('이전 가상 자료')]);else ui.pending[0].reject(Error('이전 가상 오류'));
    await loaded;assert.equal(form.list.innerHTML,'');assert.equal(form.error.textContent,'보존 상태');assert.equal(form.target.value,'');
  });
  test(`${name} 후 이미 표시했던 지시사항 버튼도 입력을 바꾸지 않는다`,async()=>{
    const ui=screen(),form=ui.open(),loaded=form.load();ui.pending[0].resolve([row('이전 가상 자료')]);await loaded;
    const apply=form.list.buttons[0].onclick;change(ui,form);apply();assert.equal(form.target.value,'');
  });
}

test('다시 조회하면 이전 적용 버튼을 즉시 무효화하고 빈 결과를 표시한다',async()=>{
  const ui=screen(),form=ui.open(),first=form.load();ui.pending[0].resolve([row('이전 가상 지시')]);await first;
  const apply=form.list.buttons[0].onclick,second=form.load();assert.equal(form.list.buttons.length,0);apply();assert.equal(form.target.value,'');
  ui.pending[1].resolve([]);await second;assert.match(form.list.innerHTML,/가져올 지시사항이 없습니다/);
});

test('현재 창의 조회 실패는 오류를 표시하고 다시 조회할 수 있다',async()=>{
  const ui=screen(),form=ui.open(),first=form.load();ui.pending[0].reject(Error('가상 조회 오류'));await first;assert.equal(form.error.textContent,'가상 조회 오류');
  const second=form.load();ui.pending[1].resolve([row('재조회 가상 지시')]);await second;form.list.buttons[0].onclick();assert.equal(form.target.value,'재조회 가상 지시');
});

for(const outcome of ['success','error'])test(`순회 저장 ${outcome} 대기 중 지시사항 적용은 입력과 전송값을 바꾸지 않는다`,async()=>{
  const ui=screen(),form=ui.open(),loaded=form.load();ui.pending[0].resolve([row('가상 안전 지시')]);await loaded;
  const saving=form.save();assert.equal(form.submit.disabled,true);assert.equal(ui.saves[0].data.patrolInstruction,'');
  form.list.buttons[0].onclick();assert.equal(form.target.value,'');assert.equal(ui.saves[0].data.patrolInstruction,'');assert.match(form.error.textContent,/저장이 끝난 뒤/);
  if(outcome==='success')ui.saves[0].resolve();else ui.saves[0].reject(Error('가상 저장 실패'));
  await saving;assert.equal(form.submit.disabled,false);
  if(outcome==='success'){assert.equal(ui.dialog.open,false);form.list.buttons[0].onclick();assert.equal(form.target.value,'');}
  else{
    assert.equal(ui.dialog.open,true);assert.equal(form.error.textContent,'가상 저장 실패');
    form.list.buttons[0].onclick();assert.equal(form.target.value,'가상 안전 지시');
    const retry=form.save();assert.equal(ui.saves[1].data.patrolInstruction,'가상 안전 지시');ui.saves[1].resolve();await retry;assert.equal(ui.dialog.open,false);
  }
});

test('저장 대기 중 도착한 조회 결과도 저장 중에는 적용하지 않는다',async()=>{
  const ui=screen(),form=ui.open(),loaded=form.load(),saving=form.save();ui.pending[0].resolve([row('늦은 가상 안전 지시')]);await loaded;
  assert.equal(form.list.buttons.length,1);form.list.buttons[0].onclick();assert.equal(form.target.value,'');assert.equal(ui.saves[0].data.patrolInstruction,'');assert.match(form.error.textContent,/저장이 끝난 뒤/);
  ui.saves[0].resolve();await saving;assert.equal(ui.dialog.open,false);
});
