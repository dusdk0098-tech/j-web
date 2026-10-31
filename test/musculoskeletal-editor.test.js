import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMusculoskeletal } from '../public/musculoskeletal.js';
import { Store } from '../store.js';

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
function screen(t,rows=[],companies=[]){
  const previous=globalThis.document;globalThis.document={createElement:rowNode};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const submit={disabled:false},events=[],list={children:[],append(row){this.children.push(row);},addEventListener(){},querySelectorAll(selector){return this.children.flatMap(row=>row.querySelectorAll(selector));}},controls={'[data-mus-list]':list,'[data-mus-status]':{textContent:''},'[data-mus-add]':{},'[data-mus-delete]':{}},direct={disabled:false,fieldsetDisabled:false,matches(selector){assert.equal(selector,':disabled');return this.disabled||this.fieldsetDisabled;}};
  controls['[data-mus-direct]']=direct;
  const form={querySelector(selector){assert.equal(selector,'button[type=submit]');return submit;}},container={querySelector(selector){return controls[selector];},closest(selector){assert.equal(selector,'form');return form;},dispatchEvent(event){events.push(event);}};
  const editor=mountMusculoskeletal(container,{rows,companies,scale:()=> '3x3'});
  return {editor,list,direct,submit,events,status:controls['[data-mus-status]']};
}

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
