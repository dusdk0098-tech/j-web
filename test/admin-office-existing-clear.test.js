import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const lineFor=marker=>{const start=source.indexOf(marker),end=source.indexOf('\n',start);assert.ok(start>=0);return source.slice(start,end);};

test('기존 문서의 참조자 전체 해제는 저장 전까지 서버를 바꾸지 않는다',async()=>{
  for(const changeAccess of [false,true]){
    const edit={},clear={},submit={disabled:false},checks=[{checked:true,value:'2'},{checked:true,value:'3'}],calls=[],state={detail:4},doc={id:4,site_id:7,approval_cycle_id:8},refs=[{id:2},{id:3}],nodes={'#edit-office-references':edit,'#office-references-clear':clear,'#dialog-form button[type=submit]':submit};let save,html;
    const dialog={open:false},context={$:key=>nodes[key],state,doc,refs,changeAccess,dialog,currentDetail:()=>true,esc:String,document:{querySelectorAll:key=>key.endsWith(':checked')?checks.filter(c=>c.checked):checks},api:async(path,options)=>{calls.push({path,options});return options?{}:[{id:2,name:'가상',login_id:'virtual',active:true}];},showDialog:(_title,markup,callback)=>{dialog.open=true;html=markup;save=callback;},showError:error=>{throw error;}};
    runInNewContext(lineFor("    if($('#edit-office-references'))"),context);await edit.onclick();assert.match(html,/참조자 전체 해제/);submit.disabled=true;clear.onclick();assert.equal(checks[0].checked,true);submit.disabled=false;clear.onclick();assert.deepEqual(checks.map(c=>c.checked),[false,false]);assert.equal(calls.length,1);await save();const payload=JSON.parse(calls[1].options.body);assert.deepEqual(payload.reviewerIds,[]);if(changeAccess){assert.equal(payload.expectedCycleId,8);assert.deepEqual(payload.expectedReviewerIds,[2,3]);}
  }
});

test('기존 문서 결재선 해제는 늦은 이전 결재선과 저장 중 변경을 막는다',async()=>{
  const edit={},copy={isConnected:true,disabled:false},clear={},status={},submit={disabled:false},selects=Array.from({length:9},(_,i)=>({value:i===0?'2':''})),nodes={'#edit-approval-line':edit,'#approval-copy':copy,'#approval-clear':clear,'#approval-copy-status':status,'#dialog-form button[type=submit]':submit},calls=[],doc={id:4,site_id:7,type:'office'},line=[{reviewer_id:2,name:'가상',active:true}];let release,save,html;
  const dialog={open:false},context={$:key=>nodes[key]||selects[Number(key.match(/reviewer(\d+)/)?.[1])],doc,line,dialog,esc:String,currentDetail:()=>true,showDialog:(_title,markup,callback)=>{dialog.open=true;html=markup;save=callback;},showError:error=>{throw error;},api:async(path,options)=>{calls.push({path,options});if(options)return {};if(path.includes('previous-approval-line'))return new Promise(resolve=>{release=resolve;});return [{id:2,name:'가상',login_id:'virtual',active:true}];}};
  runInNewContext(lineFor("  if($('#edit-approval-line'))"),context);await edit.onclick();assert.match(html,/결재선 전체 해제/);const pending=copy.onclick();clear.onclick();release({document:{date:'2026-10-30'},reviewers:[{reviewer_id:2,active:true}]});await pending;assert.equal(selects[0].value,'');assert.equal(copy.disabled,false);assert.equal(calls.filter(c=>c.options).length,0);
  selects[0].value='2';submit.disabled=true;clear.onclick();assert.equal(selects[0].value,'2');submit.disabled=false;clear.onclick();await save(Object.fromEntries(selects.map((item,i)=>[`reviewer${i}`,item.value])));assert.deepEqual(JSON.parse(calls.find(c=>c.options).options.body).reviewerIds,[]);
});

test('문서 화면이 바뀌거나 다른 창이 열리면 늦은 계정 조회는 설정 창을 열지 않는다',async()=>{
  for(const kind of ['approval','reference'])for(const reason of ['navigation','dialog']){
    const edit={},dialog={open:false},doc={id:4,site_id:7,type:'office'},state={detail:4},nodes={'#edit-approval-line':edit,'#edit-office-references':edit},line=[],refs=[];let current=true,release,opened=0;
    const context={$:key=>nodes[key]||{},dialog,doc,state,line,refs,changeAccess:false,currentDetail:()=>current,api:()=>new Promise(resolve=>{release=resolve;}),showDialog:()=>{opened++;},showError:()=>{}};
    runInNewContext(lineFor(kind==='approval'?"  if($('#edit-approval-line'))":"    if($('#edit-office-references'))"),context);const pending=edit.onclick();if(reason==='navigation')current=false;else dialog.open=true;release([]);await pending;assert.equal(opened,0,`${kind}: ${reason}`);
  }
});
