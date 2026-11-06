import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMusculoskeletal, mountMuscleReferences } from '../public/musculoskeletal.js';
import { Store } from '../store.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { riskScore, selectedMusculoskeletalItems } from '../public/risk-scale.js';
import { muscleDetailMarkup } from '../public/risk-detail.js';

const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
// shortcut: 이 편집기의 입력 태그만 모의 처리하며, 화면 배치 검증에는 실제 DOM이 필요하다.
function rowNode(){
  return {
    fields:[],
    set innerHTML(html){
      this.markup=html;
      this.fields=[...html.matchAll(/<(input|select) data-mus-field="([^"]+)"([^>]*)>([\s\S]*?)(?=<label>|<\/label>)/g)].map(([,tag,key,attributes,content])=>{
        const options=tag==='select'?[...content.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(([,value,attrs])=>({value,selected:attrs.includes('selected')})):[];
        return {dataset:{musField:key},tag,options,value:tag==='input'?decode(attributes.match(/value="([^"]*)"/)?.[1]||''):(options.find(option=>option.selected)||options[0]).value};
      });
      const companies=html.match(/<select data-mus-company>([\s\S]*?)<\/select>/)[1];
      this.selected={checked:/data-mus-selected checked/.test(html)};this.company={value:companies.match(/<option selected value="([^"]*)"/)?.[1]||companies.match(/<option value="([^"]*)" selected/)?.[1]||'0'};this.score={textContent:''};
    },
    querySelectorAll(selector){return selector==='[data-mus-field]'?this.fields:selector==='select[data-mus-field]'?this.fields.filter(field=>field.tag==='select'):[];},
    querySelector(selector){if(selector==='[data-mus-selected]')return this.selected;if(selector==='[data-mus-company]')return this.company;if(selector==='[data-mus-score]')return this.score;return this.fields.find(field=>selector===`[data-mus-field=${field.dataset.musField}]`);}
  };
}
function screen(t,rows=[],companies=[],initialScale='3x3'){
  const previous=globalThis.document;globalThis.document={createElement:rowNode};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const submit={disabled:false},events=[],list={children:[],append(row){this.children.push(row);row.remove=()=>{this.children.splice(this.children.indexOf(row),1);};},addEventListener(){},querySelectorAll(selector){return this.children.flatMap(row=>row.querySelectorAll(selector));}},controls={'[data-mus-list]':list,'[data-mus-status]':{textContent:''},'[data-mus-add]':{},'[data-mus-delete]':{},'[data-mus-select-all]':{},'[data-mus-delete-all]':{}},direct={disabled:false,fieldsetDisabled:false,matches(selector){assert.equal(selector,':disabled');return this.disabled||this.fieldsetDisabled;}};
  controls['[data-mus-direct]']=direct;
  const form={querySelector(selector){assert.equal(selector,'button[type=submit]');return submit;}},container={querySelector(selector){return controls[selector];},closest(selector){assert.equal(selector,'form');return form;},dispatchEvent(event){events.push(event);}};
  const scale={value:initialScale},editor=mountMusculoskeletal(container,{rows,companies,scale:()=>scale.value});
  return {editor,list,direct,submit,events,scale,status:controls['[data-mus-status]'],controls};
}

function references(ui,{worker=false,request}={}){
  const controls=Object.fromEntries(['reload','select','append','title','save','delete','status'].map(name=>[name,{value:'',textContent:'',disabled:false}])),state={active:true},events=[],calls=[];
  const container={isConnected:true,querySelector(selector){return controls[selector.match(/data-ref-(\w+)/)[1]];},closest(){return {querySelector(){return ui.submit;}};},dispatchEvent(event){events.push(event);}};
  const panel=mountMuscleReferences(container,{editor:ui.editor,scale:()=>ui.scale.value,siteId:7,worker,active:()=>state.active,request:async(...args)=>{calls.push(args);return request?request(...args):[];}});
  return {controls,state,events,calls,container,panel,choose(id){controls.select.value=String(id);controls.select.onchange();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('참고자료 관리자 저장은 선택한 입력의 독립 사본과 개선 후 등급을 보내며 중복 요청을 막는다',async t=>{
  const ui=screen(t,[{task:'보존할 입력',selected:true,improvedGrade:'중'},{task:'제외',selected:false,improvedGrade:'하'}],[],'three-level'),pending=deferred(),ref=references(ui,{request:()=>pending.promise}),before=ui.editor.read();
  ref.controls.title.value='  현장 자료  ';const save=ref.controls.save.onclick();await ref.controls.save.onclick();assert.equal(ref.calls.length,1);
  const [path,options]=ref.calls[0],body=JSON.parse(options.body);assert.equal(path,'/api/muscle-references');assert.equal(options.method,'POST');assert.equal(body.siteId,7);assert.equal(body.scale,'three-level');assert.equal(body.title,'현장 자료');assert.deepEqual(body.items,[before[0]]);
  ui.list.children[0].querySelector('[data-mus-field=task]').value='저장 대기 중 수정';assert.equal(body.items[0].task,'보존할 입력');pending.resolve({id:1});await save;assert.equal(ui.editor.read()[0].task,'저장 대기 중 수정');assert.match(ref.controls.status.textContent,/저장했습니다/);
});

test('참고자료 목록 선택과 추가는 기존 입력·미선택·개선 등급을 보존하고 제목을 이스케이프한다',async t=>{
  const ui=screen(t,[{task:'기존 입력',selected:true}],[],'three-level'),source=[{task:'사용자 작성',selected:false,improvedGrade:'하'}],ref=references(ui,{request:async()=>[{id:9,title:'<script>가상</script>',scale:'three-level',items:source}]});
  await ref.controls.reload.onclick();assert.equal(ref.calls[0][0],'/api/muscle-references?siteId=7&scale=three-level');assert.match(ref.controls.select.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(ref.controls.select.innerHTML,/<script>/);ref.choose(9);ref.controls.append.onclick();ref.controls.append.onclick();
  assert.deepEqual(ui.editor.read().map(row=>[row.task,row.selected,row.improvedGrade]),[['기존 입력',true,''],['사용자 작성',false,'하']]);assert.equal(ref.events.length,1);ui.list.children[1].querySelector('[data-mus-field=task]').value='수정';assert.equal(source[0].task,'사용자 작성');
  assert.match(ref.container.innerHTML,/사용자가 직접 작성/);assert.match(ref.container.innerHTML,/실제 위험 판정을 제공하지 않습니다/);
});

test('참고자료 잘못된 항목과 100개 초과는 전부 검증 후 추가하므로 기존 입력을 보존한다',async t=>{
  for(const [count,items,error] of [[99,[{selected:true},{selected:false}],/100개/],[1,[{selected:true},{selected:'true'}],/확인/],[1,[{selected:true,improvedGrade:'하'}],/확인/]])await t.test(`${count}개, ${JSON.stringify(items)}`,async sub=>{
    const ui=screen(sub,Array.from({length:count},()=>({task:'보존',selected:true}))),before=ui.editor.read(),ref=references(ui,{request:async()=>[{id:1,title:'자료',scale:'3x3',items}]});await ref.controls.reload.onclick();ref.choose(1);ref.controls.append.onclick();assert.deepEqual(ui.editor.read(),before);assert.equal(ref.events.length,0);assert.match(ref.controls.status.textContent,error);
  });
});

test('참고자료는 척도 변경 뒤 돌아와도 이전 조회 응답과 목록을 사용하지 않는다',async t=>{
  const ui=screen(t),pending=deferred(),ref=references(ui,{request:()=>pending.promise}),loading=ref.controls.reload.onclick();await ref.controls.reload.onclick();assert.equal(ref.calls.length,1);
  ui.scale.value='5x4';ref.panel.refresh();ui.scale.value='3x3';ref.panel.refresh();pending.resolve([{id:1,title:'늦은 자료',scale:'3x3',items:[{selected:true}]}]);await loading;assert.doesNotMatch(ref.controls.select.innerHTML,/늦은 자료/);ref.choose(1);ref.controls.append.onclick();assert.equal(ui.editor.read().length,0);
});

test('닫힌 창·현장 전환·문서 저장 중에는 참고자료 응답과 추가를 적용하지 않는다',async t=>{
  for(const reason of ['closed','site','saving'])await t.test(reason,async sub=>{
    const ui=screen(sub),pending=deferred(),ref=references(ui,{request:()=>pending.promise}),loading=ref.controls.reload.onclick();
    if(reason==='closed')ref.container.isConnected=false;if(reason==='site')ref.state.active=false;if(reason==='saving')ui.submit.disabled=true;
    pending.resolve([{id:1,title:'무시할 자료',scale:'3x3',items:[{selected:true}]}]);await loading;assert.doesNotMatch(ref.controls.select.innerHTML,/무시할 자료/);ref.choose(1);ref.controls.append.onclick();await ref.controls.save.onclick();assert.equal(ref.calls.length,1);assert.equal(ui.editor.read().length,0);
  });
});

test('근로자는 참고자료 조회·추가만 제공하며 삭제는 관리자 자료만 지우고 문서 입력을 보존한다',async t=>{
  const previousConfirm=globalThis.confirm;globalThis.confirm=()=>true;t.after(()=>{if(previousConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=previousConfirm;});
  const ui=screen(t,[{task:'보존',selected:true}]),data=[{id:4,title:'시험',scale:'3x3',items:[{task:'참고',selected:true}]}],ref=references(ui,{worker:true,request:async()=>data});assert.doesNotMatch(ref.container.innerHTML,/data-ref-(save|delete|title)/);assert.equal(ref.controls.save.onclick,undefined);
  await ref.controls.reload.onclick();assert.equal(ref.calls[0][0],'/api/worker/muscle-references?scale=3x3');ref.choose(4);ref.controls.append.onclick();assert.equal(ui.editor.read().length,2);
  const admin=references(ui,{request:async()=>data}),before=ui.editor.read();await admin.controls.reload.onclick();admin.choose(4);await admin.controls.delete.onclick();assert.equal(admin.calls[1][0],'/api/muscle-references/4?siteId=7');assert.equal(admin.calls[1][1].method,'DELETE');assert.deepEqual(ui.editor.read(),before);assert.equal(admin.controls.append.disabled,true);
});

test('참고자료 삭제 확인을 취소하면 요청 없이 자료와 문서 입력을 유지한다',async t=>{
  const previousConfirm=globalThis.confirm;globalThis.confirm=()=>false;t.after(()=>{if(previousConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=previousConfirm;});
  const ui=screen(t,[{task:'보존',selected:true}]),before=ui.editor.read(),ref=references(ui,{request:async()=>[{id:4,title:'시험',scale:'3x3',items:[{selected:true}]}]});await ref.controls.reload.onclick();ref.choose(4);await ref.controls.delete.onclick();assert.equal(ref.calls.length,1);assert.equal(ref.controls.select.value,'4');assert.equal(ref.controls.delete.disabled,false);assert.deepEqual(ui.editor.read(),before);
});

test('참고자료 오류·빈 이름·미선택·다른 척도 응답에서는 입력을 보존하고 다시 시도할 수 있다',async t=>{
  const ui=screen(t,[{task:'보존',selected:false}]),before=ui.editor.read(),ref=references(ui,{request:async()=>{throw Error('시험 통신 실패');}});
  await ref.controls.save.onclick();assert.match(ref.controls.status.textContent,/이름/);ref.controls.title.value='이름';await ref.controls.save.onclick();assert.match(ref.controls.status.textContent,/항목을 선택/);assert.equal(ref.calls.length,0);
  await ref.controls.reload.onclick();assert.match(ref.controls.status.textContent,/통신 실패/);assert.equal(ref.controls.reload.disabled,false);assert.deepEqual(ui.editor.read(),before);
  const wrong=references(ui,{request:async()=>[{id:2,title:'다른 척도',scale:'5x4',items:[]}]});await wrong.controls.reload.onclick();assert.match(wrong.controls.status.textContent,/목록을 다시 확인/);assert.equal(wrong.controls.append.disabled,true);assert.deepEqual(ui.editor.read(),before);
});

test('근골격계 업체 선택은 같은 이름도 번호로 구분하며 이름을 안전하게 표시한다',t=>{
  const companies=[{id:1,name:'가상 <업체>'},{id:2,name:'가상 <업체>'}],ui=screen(t,[{contractorId:2,selected:true}],companies),html=ui.list.children[0].markup;
  assert.match(html,/가상 &lt;업체&gt; · 등록번호 1/);assert.match(html,/가상 &lt;업체&gt; · 등록번호 2/);assert.doesNotMatch(html,/<업체>/);assert.equal(ui.editor.read()[0].contractorId,2);
});

test('직접 입력은 기존 값과 순서를 보존하며 독립적인 빈 항목 세 개를 추가한다',t=>{
  const ui=screen(t,[{task:'기존 <작업>',hazard:'가상 부담',likelihood:'2',severity:'3',selected:false}]),before=ui.editor.read();
  ui.direct.onclick();const rows=ui.editor.read();assert.equal(rows.length,4);assert.deepEqual(rows[0],before[0]);
  for(const row of rows.slice(1)){assert.equal(row.selected,true);assert.ok(Object.entries(row).filter(([key])=>key!=='selected').every(([,value])=>value===''));}
  ui.list.children[1].querySelector('[data-mus-field=task]').value='새 가상 작업';assert.equal(ui.editor.read()[2].task,'');assert.equal(ui.editor.read()[3].task,'');
  assert.equal(ui.events.length,1);assert.equal(ui.events[0].type,'input');assert.equal(ui.events[0].bubbles,true);assert.match(ui.status.textContent,/3개/);
  ui.direct.onclick();assert.equal(ui.editor.read().length,7);assert.equal(ui.editor.read()[1].task,'새 가상 작업');
});

test('직접 입력은 97개에서 100개가 되고 98개 이상에서는 부분 추가도 하지 않는다',async t=>{
  for(const count of [97,98,99,100]){
    await t.test(`${count}개 기존 항목`,sub=>{const ui=screen(sub,Array.from({length:count},(_,i)=>({task:`가상 작업 ${i}`,selected:i%2===0}))),before=ui.editor.read();
    ui.direct.onclick();assert.deepEqual(ui.editor.read().slice(0,count),before);
    assert.equal(ui.editor.read().length,count===97?100:count);assert.equal(ui.events.length,count===97?1:0);
    if(count!==97)assert.match(ui.status.textContent,/100개/);
    });
  }
});

test('비편집 및 저장 중 직접 입력은 기존 항목과 변경 이벤트를 만들지 않는다',t=>{
  const ui=screen(t,[{task:'보존할 작업',selected:true}]),before=ui.editor.read();
  for(const [control,key] of [[ui.direct,'disabled'],[ui.direct,'fieldsetDisabled'],[ui.submit,'disabled']]){
    control[key]=true;ui.direct.onclick();assert.deepEqual(ui.editor.read(),before);assert.equal(ui.events.length,0);assert.equal(ui.status.textContent,'');control[key]=false;
  }
  ui.direct.onclick();assert.equal(ui.editor.read().length,4);assert.equal(ui.events.length,1);
});

test('직접 입력 결과는 관리자와 권한 있는 근로자의 저장을 거쳐 기존 결재 기록을 보존한다',t=>{
  const ui=screen(t,[{task:'기존 작업',selected:true}]);ui.direct.onclick();ui.list.children[1].querySelector('[data-mus-field=task]').value='직접 입력 작업';
  const store=new Store(':memory:');t.after(()=>store.close());const site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id),worker=store.join(invite.token,{name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종',loginId:'muscle_direct_worker',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
  store.setWorkerPermissions(site.id,worker.id,['risk']);
  const input={siteId:site.id,type:'risk',title:'직접 입력 시험',date:'2026-10-31',details:{scale:'3x3',items:[],musculoskeletalItems:ui.editor.read()}};
  const adminDoc=store.createDocument(input),workerDoc=store.createWorkerDocument(site.id,worker.id,input);
  for(const doc of [adminDoc,workerDoc])assert.deepEqual(JSON.parse(doc.details).musculoskeletalItems.map(row=>row.task),['기존 작업','직접 입력 작업','','']);
  const submitted=store.transition(adminDoc.id,'submit');store.transition(adminDoc.id,'withdraw');
  ui.direct.onclick();const next={...input,details:{...input.details,musculoskeletalItems:ui.editor.read()}};store.updateDocument(adminDoc.id,next);store.updateWorkerDocument(site.id,worker.id,workerDoc.id,next);
  assert.equal(JSON.parse(store.document(adminDoc.id).details).musculoskeletalItems.length,7);assert.equal(JSON.parse(store.workerDocument(site.id,worker.id,workerDoc.id).details).musculoskeletalItems.length,7);
  assert.equal(JSON.parse(store.approvalCycle(adminDoc.id,submitted.approval_cycle_id).document.details).musculoskeletalItems.length,4);
});

test('개선 후 등급은 세 등급 입력과 재열기를 지원하고 척도 변경 전 지우도록 보호한다',t=>{
  const ui=screen(t,[{task:'가상 작업',selected:true}],[],'three-level'),input=ui.list.children[0].querySelector('[data-mus-field=improvedGrade]');
  assert.equal(input.disabled,false);assert.deepEqual(input.options.filter(option=>!option.disabled).map(option=>option.value),['','상','중','하']);
  assert.equal(ui.list.children[0].querySelector('[data-mus-field=improvedLikelihood]'),undefined);assert.equal(ui.list.children[0].querySelector('[data-mus-field=improvedSeverity]'),undefined);
  for(const value of ['상','중','하']){
    input.value=value;assert.equal(ui.editor.read()[0].improvedGrade,value);assert.equal(ui.editor.conflicts('three-level'),false);
    for(const scale of ['','3x3','5x4'])assert.equal(ui.editor.conflicts(scale),true);
    const reopened=screen(t,ui.editor.read(),[],'three-level');assert.equal(reopened.editor.read()[0].improvedGrade,value);
  }
  input.value='';for(const scale of ['','3x3','5x4']){assert.equal(ui.editor.conflicts(scale),false);ui.scale.value=scale;ui.editor.refresh();assert.equal(input.disabled,true);}
  ui.scale.value='three-level';ui.editor.refresh();assert.equal(input.disabled,false);assert.equal(input.value,'');
});

test('이전 근골격계 개선 후 등급은 독립 복사하고 잘못된 등급이나 척도는 부분 추가하지 않는다',t=>{
  const ui=screen(t,[{task:'기존 작업',improvedGrade:'중',selected:true}],[],'three-level'),source=[{task:'이전 작업',improvedGrade:'하',selected:false}];
  assert.equal(ui.editor.append(source),1);assert.equal(ui.editor.read()[1].improvedGrade,'하');assert.equal(ui.editor.read()[1].selected,false);
  ui.list.children[1].querySelector('[data-mus-field=improvedGrade]').value='상';assert.equal(source[0].improvedGrade,'하');assert.equal(ui.editor.read()[0].improvedGrade,'중');
  const before=ui.editor.read();for(const invalid of ['최상',1,null,'x'.repeat(2001)]){assert.throws(()=>ui.editor.append([...source,{selected:true,improvedGrade:invalid}]),/확인/);assert.deepEqual(ui.editor.read(),before);}
  for(const scale of ['','3x3','5x4']){ui.scale.value=scale;assert.throws(()=>ui.editor.append(source),/확인/);assert.deepEqual(ui.editor.read(),before);}
});

test('근골격계 상세와 결재 사본 렌더링에 개선 후 등급이 표시된다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const riskFields=runInNewContext(`${source.match(/^const riskFields=.*;$/m)[0]}\nriskFields`),details={scale:'three-level',musculoskeletalItems:[{task:'선택한 <작업>',grade:'상',improvedGrade:'하',selected:true},{task:'선택 안 한 작업',improvedGrade:'중',selected:false}]};let html='';
  const content={querySelector(selector){assert.equal(selector,'.action-row');return {insertAdjacentHTML(position,value){assert.equal(position,'beforebegin');html=value;}};}};
  runInNewContext(source.match(/^  if\(doc.type==='risk'&&details.musculoskeletalItems\?\.length\).*$/m)[0],{doc:{type:'risk'},details,content,esc,riskFields,muscleDetailMarkup});
  assert.match(html,/<strong>개선 후 위험 등급<\/strong> 하/);assert.match(html,/선택한 &lt;작업&gt;/);assert.doesNotMatch(html,/선택 안 한 작업|시험 점수:/);
  const start=source.indexOf('function capturedFields('),end=source.indexOf('function capturedFiles(',start),captured=runInNewContext(`${source.slice(start,end)}\ncapturedFields(details)`,{details,esc,riskFields,dailyFields:{},planFields:{},permitFields:{}});
  assert.match(captured,/<dt>개선 후 위험 등급<\/dt><dd>하<\/dd>/);assert.match(captured,/<dt>개선 후 위험 등급<\/dt><dd>중<\/dd>/);assert.match(captured,/선택한 &lt;작업&gt;/);
});

test('근골격계 전체 선택과 삭제는 확인과 기존 항목 선택을 지킨다',t=>{
  const previous=globalThis.confirm;let approve=false;globalThis.confirm=()=>approve;t.after(()=>{if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;});
  const ui=screen(t,[{task:'가상 A',selected:true},{task:'가상 B',selected:false}]),all=ui.controls['[data-mus-select-all]'];
  assert.equal(all.checked,false);assert.equal(all.indeterminate,true);
  all.checked=true;all.onchange();assert.deepEqual(ui.editor.read().map(row=>row.selected),[true,true]);assert.equal(all.indeterminate,false);
  all.checked=false;all.onchange();assert.deepEqual(ui.editor.read().map(row=>row.selected),[false,false]);
  ui.controls['[data-mus-delete-all]'].onclick();assert.equal(ui.editor.read().length,2);assert.equal(ui.events.length,0);
  ui.list.children[0].selected.checked=true;ui.controls['[data-mus-delete]'].onclick();assert.equal(ui.editor.read().length,1);assert.equal(ui.editor.read()[0].task,'가상 B');assert.equal(ui.events.length,1);
  approve=true;ui.submit.disabled=true;all.checked=true;all.onchange();ui.controls['[data-mus-delete]'].onclick();ui.controls['[data-mus-delete-all]'].onclick();assert.equal(ui.editor.read().length,1);assert.equal(ui.editor.read()[0].selected,false);ui.submit.disabled=false;ui.controls['[data-mus-delete-all]'].onclick();assert.equal(ui.editor.read().length,0);assert.equal(all.checked,false);assert.equal(ui.events.length,2);
});
