import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf("    if(select.value==='inspection'){");
const end=source.indexOf("    if(['safety_meeting','work_council','joint_inspection'].includes(select.value)){",start);
assert.ok(start>=0&&end>start);
const fields={meeting:'inspectionMeeting',event:'inspectionEvent',other:'inspectionOther',instruction:'inspectionInstruction'};
const row=(title)=>({date:'2026-10-31',title,details:JSON.stringify({meeting:title,event:title,other:title,instruction:title,rows:[{inspector:'가상 점검자',hazard:title,action:'가상 조치',timeFrom:'09:00',timeTo:'09:05'}]})});

// shortcut: 조회·적용에 필요한 DOM만 모사하며 실제 화면 배치는 별도 브라우저 시험이 필요하다.
function screen(){
  const nodes=new Map(),pending=[],saves=[],state={siteId:1,page:'documents'},dialog={open:true,showModal(){this.open=true;},close(){this.open=false;}};
  const makeNode=()=>({isConnected:true,value:'',textContent:'',html:'',buttons:[],rows:[],dataset:{},
    set innerHTML(value){this.html=value;this.textContent='';this.buttons=[...value.matchAll(/data-inspection-source="(\d+)"/g)].map(([,index])=>({dataset:{inspectionSource:index}}));},
    get innerHTML(){return this.html;},
    replaceChildren(){this.innerHTML='';},
    querySelectorAll(selector){assert.equal(selector,'[data-inspection-source]');return this.buttons;},
    querySelector(selector){if(selector==='[data-inspection-row]')return nodes.get('#inspection-rows').rows[0];assert.ok(nodes.has(selector),selector);return nodes.get(selector);},
    insertAdjacentHTML(position,html){
      if(html.includes('data-inspection-row')){
        const item={html,querySelector(selector){assert.equal(selector,'[data-inspection-remove]');return {};}};
        this.rows.push(item);this.lastElementChild=item;
      }
    }
  });
  const context={state,dialog,URLSearchParams,field:()=>'',
    $:selector=>{assert.ok(nodes.has(selector),selector);return nodes.get(selector);},
    api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),
    FormData:class{constructor(){return Object.values(fields).map(name=>[name,nodes.get(`#dialog-form [name=${name}]`).value]);}},flash(){},render:async()=>{}
  };
  const showDialogSource=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick="));
  runInNewContext(source.match(/^const esc = .*$/m)[0]+'\n'+showDialogSource+'\nglobalThis.mount=function(siteId,page,select){const details={},doc={id:42};\n'+source.slice(start,end)+'\n};',context);
  const open=(siteId=1)=>{
    for(const node of nodes.values())node.isConnected=false;
    nodes.clear();state.siteId=siteId;dialog.open=true;
    for(const key of ['#dialog-form','#dialog-form button[type=submit]','#dialog-title','#dialog-body','#daily-fields','#inspection-previous','#inspection-previous-list','#inspection-rows','#inspection-add','#dialog-form [name=date]','#dialog-error',...Object.values(fields).map(name=>`#dialog-form [name=${name}]`)])nodes.set(key,makeNode());
    const date=nodes.get('#dialog-form [name=date]'),target=nodes.get('#dialog-form [name=inspectionInstruction]'),error=nodes.get('#dialog-error'),list=nodes.get('#inspection-previous-list'),container=nodes.get('#daily-fields'),button=nodes.get('#inspection-previous'),select={value:'inspection'},rows=nodes.get('#inspection-rows');
    date.value='2026-11-01';context.showDialog('가상 점검 작성','',data=>new Promise((resolve,reject)=>saves.push({data,resolve,reject})));context.mount(siteId,state.page,select);
    const form=nodes.get('#dialog-form'),submit=nodes.get('#dialog-form button[type=submit]');
    return {date,target,error,list,container,select,submit,rows,inputs:Object.fromEntries(Object.entries(fields).map(([key,name])=>[key,nodes.get(`#dialog-form [name=${name}]`)])),save:()=>form.onsubmit({preventDefault(){},currentTarget:form}),load:()=>button.onclick(),changeDate(value){date.value=value;date.onchange?.();}};
  };
  return {open,pending,saves,state,dialog};
}

test('이전 점검 조회 조건·빈 항목 적용·기존 입력과 행 보존',async()=>{
  const ui=screen(),form=ui.open(7),loaded=form.load();
  const url=new URL(ui.pending[0].url,'http://virtual.invalid');
  assert.equal(url.pathname,'/api/inspection/previous');assert.equal(url.searchParams.get('siteId'),'7');assert.equal(url.searchParams.get('before'),'2026-11-01');assert.equal(url.searchParams.get('excludeId'),'42');
  ui.pending[0].resolve([row('<가상 점검>')]);await loaded;assert.match(form.list.innerHTML,/&lt;가상 점검&gt;/);
  form.inputs.meeting.value='직접 작성';form.list.buttons[0].onclick();
  assert.equal(form.inputs.meeting.value,'직접 작성');for(const key of ['event','other','instruction'])assert.equal(form.inputs[key].value,'<가상 점검>');
  assert.equal(form.rows.rows.length,1);assert.match(form.rows.rows[0].html,/가상 점검자/);assert.match(form.rows.rows[0].html,/&lt;가상 점검&gt;/);
  form.list.buttons[0].onclick();assert.equal(form.rows.rows.length,1);
});

for(const outcome of ['success','error']){
  test(`새 작성창을 연 뒤 이전 창의 ${outcome} 응답은 새 창을 바꾸지 않는다`,async()=>{
    const ui=screen(),a=ui.open(),old=a.load();ui.dialog.close();const b=ui.open(),latest=b.load();
    ui.pending[1].resolve([row('새 가상 자료')]);await latest;const before=b.list.innerHTML;b.error.textContent='새 창 상태';
    if(outcome==='success')ui.pending[0].resolve([row('이전 가상 자료')]);else ui.pending[0].reject(Error('이전 가상 오류'));
    await old;assert.equal(b.list.innerHTML,before);assert.equal(b.error.textContent,'새 창 상태');assert.equal(b.target.value,'');
    b.list.buttons[0].onclick();assert.equal(b.target.value,'새 가상 자료');
  });
  test(`동시 조회 역순 ${outcome} 응답은 최신 결과를 보존한다`,async()=>{
    const ui=screen(),form=ui.open(),old=form.load(),latest=form.load();ui.pending[1].resolve([row('최신 가상 자료')]);await latest;
    const before=form.list.innerHTML;form.error.textContent='현재 상태';
    if(outcome==='success')ui.pending[0].resolve([row('이전 가상 자료')]);else ui.pending[0].reject(Error('이전 가상 오류'));
    await old;assert.equal(form.list.innerHTML,before);assert.equal(form.error.textContent,'현재 상태');form.list.buttons[0].onclick();assert.equal(form.target.value,'최신 가상 자료');
  });
}

const changes={
  '날짜 변경':(ui,form)=>form.changeDate('2026-11-02'),
  '날짜 변경 후 복귀':(ui,form)=>{form.changeDate('2026-11-02');form.changeDate('2026-11-01');},
  '유형 변경':(ui,form)=>{form.select.value='patrol';form.list.isConnected=false;},
  '유형 변경 후 재생성':(ui,form)=>{form.list.isConnected=false;return ui.open();},
  '현장 변경':ui=>{ui.state.siteId=2;},
  '페이지 변경':ui=>{ui.state.page='workers';},
  '창 닫기':ui=>{ui.dialog.close();}
};
for(const [name,change] of Object.entries(changes)){
  for(const outcome of ['success','error'])test(`${name} 후 늦은 ${outcome} 응답을 무시한다`,async()=>{
    const ui=screen(),form=ui.open(),loaded=form.load();change(ui,form);form.error.textContent='보존 상태';
    if(outcome==='success')ui.pending[0].resolve([row('이전 가상 자료')]);else ui.pending[0].reject(Error('이전 가상 오류'));
    await loaded;assert.equal(form.list.innerHTML,'');assert.equal(form.error.textContent,'보존 상태');assert.equal(form.target.value,'');
  });
  test(`${name} 후 이전 적용 버튼은 입력을 바꾸지 않는다`,async()=>{
    const ui=screen(),form=ui.open(),loaded=form.load();ui.pending[0].resolve([row('이전 가상 자료')]);await loaded;
    const apply=form.list.buttons[0].onclick,reopened=change(ui,form);apply();assert.equal(form.target.value,'');assert.equal(form.rows.rows.length,0);if(reopened){assert.equal(reopened.target.value,'');assert.equal(reopened.rows.rows.length,0);}
  });
}

test('재조회 즉시 이전 적용 버튼을 무효화하며 빈 결과를 표시한다',async()=>{
  const ui=screen(),form=ui.open(),first=form.load();ui.pending[0].resolve([row('이전 가상 자료')]);await first;
  const apply=form.list.buttons[0].onclick,second=form.load();assert.equal(form.list.buttons.length,0);apply();assert.equal(form.target.value,'');
  ui.pending[1].resolve([]);await second;assert.match(form.list.innerHTML,/이전 가상 점검이 없습니다/);
});
test('현재 조회 실패는 오류를 표시하며 재조회할 수 있다',async()=>{
  const ui=screen(),form=ui.open(),first=form.load();ui.pending[0].reject(Error('가상 조회 오류'));await first;assert.equal(form.error.textContent,'가상 조회 오류');
  const second=form.load();ui.pending[1].resolve([row('재조회 가상 자료')]);await second;form.list.buttons[0].onclick();assert.equal(form.target.value,'재조회 가상 자료');
});
for(const outcome of ['success','error'])test(`저장 ${outcome} 대기 중 적용은 화면과 전송값을 바꾸지 않는다`,async()=>{
  const ui=screen(),form=ui.open(),loaded=form.load();ui.pending[0].resolve([row('가상 안전 점검')]);await loaded;
  const saving=form.save();assert.equal(form.submit.disabled,true);form.list.buttons[0].onclick();
  assert.equal(form.target.value,'');assert.equal(form.rows.rows.length,0);assert.equal(ui.saves[0].data.inspectionInstruction,'');assert.match(form.error.textContent,/저장이 끝난 뒤/);
  if(outcome==='success')ui.saves[0].resolve();else ui.saves[0].reject(Error('가상 저장 실패'));await saving;assert.equal(form.submit.disabled,false);
  if(outcome==='success'){assert.equal(ui.dialog.open,false);form.list.buttons[0].onclick();assert.equal(form.target.value,'');}
  else{assert.equal(ui.dialog.open,true);assert.equal(form.error.textContent,'가상 저장 실패');form.list.buttons[0].onclick();assert.equal(form.target.value,'가상 안전 점검');const retry=form.save();assert.equal(ui.saves[1].data.inspectionInstruction,'가상 안전 점검');ui.saves[1].resolve();await retry;assert.equal(ui.dialog.open,false);}
});
test('저장 대기 중 도착한 조회 결과도 저장이 끝나기 전에는 적용할 수 없다',async()=>{
  const ui=screen(),form=ui.open(),loaded=form.load(),saving=form.save();ui.pending[0].resolve([row('늦은 가상 자료')]);await loaded;
  form.list.buttons[0].onclick();assert.equal(form.target.value,'');assert.equal(form.rows.rows.length,0);assert.equal(ui.saves[0].data.inspectionInstruction,'');assert.match(form.error.textContent,/저장이 끝난 뒤/);
  ui.saves[0].resolve();await saving;assert.equal(ui.dialog.open,false);
});
