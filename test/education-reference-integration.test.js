import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mountEducationReference} from '../public/education-reference.js';
import {educationKinds,educationTimeField,educationMethodFields,hasManagerEducationTargets} from '../public/education-kinds.js';
const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),worker=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8');
class Control extends EventTarget {
  value='';disabled=false;readOnly=false;isConnected=true;maxLength=-1;textContent='';onclick=null;nodes=new Map();dataset={};
  set innerHTML(value){this.html=value;this.nodes.clear();}
  get innerHTML(){return this.html;}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Control());return this.nodes.get(selector);}
  querySelectorAll(){return [];}
  insertAdjacentHTML(where,html){this.html=(this.html||'')+html;}
}
async function adminSetup(){
  const root=new Control(),fields=new Control(),kind=new Control(),body=new Control(),select=new Control(),submit=new Control(),dialog=new Control(),date=new Control(),draftWorkers=new Control();
  kind.value='regular';body.value='가상 기존 입력';select.value='education';dialog.open=true;
  const state={siteId:1,page:'documents',type:'education',types:{education:'교육'}};
  const nodes={'#dialog-form select[name=type]':select,'#daily-fields':fields,'#daily-fields [data-education-reference]':root,'#daily-fields [data-education-draft-workers]':draftWorkers,'#dialog-form [name=date]':date,'#dialog-form [name=educationKind]':kind,'#dialog-form [name=body]':body,'#dialog-form button[type=submit]':submit};
  const context={state,detailEpoch:1,dialog,$:selector=>{assert.ok(nodes[selector],selector);return nodes[selector];},api:async()=>[],showError:error=>{throw error;},showDialog(){},field:()=>'',today:()=>'',esc:String,educationKinds,educationTimeField,educationMethodFields,hasManagerEducationTargets,mountEducationReference,mountEducationDraftWorkers:()=>()=>undefined};
  const start=admin.indexOf('async function editDocument('),end=admin.indexOf('\nasync function loadDocuments',start);
  await runInNewContext(admin.slice(start,end)+';editDocument()',context);
  return {root,fields,kind,body,select,submit,dialog,state,context};
}
const buttons=s=>({normal:s.root.querySelector('[data-reference-normal]'),compact:s.root.querySelector('[data-reference-compact]'),apply:s.root.querySelector('[data-reference-apply]'),preview:s.root.querySelector('[data-reference-preview]')});
test('관리자 실제 작성 화면은 두 미리보기와 별도 추가를 연결하고 기존 입력과 input 알림을 유지한다',async()=>{
  const s=await adminSetup(),b=buttons(s);let inputs=0;s.body.addEventListener('input',()=>inputs++);
  assert.match(s.fields.innerHTML,/data-education-reference/);b.normal.onclick();const normal=b.preview.textContent;assert.equal(s.body.value,'가상 기존 입력');b.compact.onclick();assert.equal(b.preview.textContent,normal.replaceAll('\n',' '));b.apply.onclick();assert.equal(s.body.value,'가상 기존 입력\n\n'+normal.replaceAll('\n',' '));assert.equal(inputs,1);
});
test('관리자 실제 연결은 현장·페이지·렌더·유형 변경, 저장 중, 닫힘 뒤 적용을 차단한다',async()=>{
  for(const change of [s=>s.state.siteId++,s=>s.state.page='workers',s=>s.context.detailEpoch++,s=>s.select.value='tbm',s=>s.submit.disabled=true,s=>s.dialog.open=false]){
    const s=await adminSetup(),b=buttons(s);b.normal.onclick();change(s);b.apply.onclick();assert.equal(s.body.value,'가상 기존 입력');assert.equal(b.apply.disabled,true);
  }
  for(const change of [s=>s.select.onchange(),s=>s.dialog.dispatchEvent(new Event('close'))]){const s=await adminSetup(),b=buttons(s);b.normal.onclick();change(s);assert.equal(b.apply.onclick,null);assert.equal(b.apply.disabled,true);assert.equal(s.body.value,'가상 기존 입력');}
});
function workerSetup(editable=true){
  const root=new Control(),fields=new Control(),kind=new Control(),body=new Control(),submit=new Control(),close=new Control(),form=new Control(),editor={querySelector:()=>close,replaceChildren(){form.isConnected=false;}};
  kind.value='regular';body.value='가상 근로자 입력';form.elements={kind,body};form.querySelector=()=>submit;fields.querySelector=()=>root;
  const context={type:'education',editable,request:1,requestNo:1,form,fields,editor,mountEducationReference};
  const start=worker.indexOf("    if(type==='education'&&editable){"),end=worker.indexOf('    form.onsubmit=',start),closeLine=worker.split(/\r?\n/).find(line=>line.includes("editor.querySelector('[data-close]').onclick="));
  assert.ok(start>=0&&end>start);runInNewContext('let educationReference;'+worker.slice(start,end)+closeLine,context);
  return {root,fields,kind,body,submit,close,form,context};
}
test('근로자 실제 연결은 읽기 전용에 없고 편집 화면에서만 본문에 추가한다',()=>{
  const readOnly=workerSetup(false);assert.equal(readOnly.fields.innerHTML,undefined);
  const s=workerSetup(),b=buttons(s);let inputs=0;s.body.addEventListener('input',()=>inputs++);b.normal.onclick();const text=b.preview.textContent;assert.equal(s.body.value,'가상 근로자 입력');b.apply.onclick();assert.equal(s.body.value,'가상 근로자 입력\n\n'+text);assert.equal(inputs,1);
});
test('근로자 새 편집·닫힘·저장중·연결 해제와 교육 종류 변경은 이전 적용을 무효화한다',()=>{
  for(const change of [s=>s.context.requestNo++,s=>s.form.isConnected=false,s=>s.submit.disabled=true,s=>{s.kind.value='other';s.kind.dispatchEvent(new Event('change'));}]){const s=workerSetup(),b=buttons(s);b.normal.onclick();change(s);b.apply.onclick();assert.equal(s.body.value,'가상 근로자 입력');assert.equal(b.apply.disabled,true);}
  const s=workerSetup(),b=buttons(s);b.normal.onclick();s.close.onclick();assert.equal(b.apply.onclick,null);assert.equal(s.form.isConnected,false);assert.equal(s.body.value,'가상 근로자 입력');
});
test('참고자료와 양쪽 진입 모듈은 실제 HTTP에서 JS로 정확히 제공된다',{timeout:20000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-reference-assets-'));
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-reference-password'},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  try{
    const startup=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(stderr);})]);
    assert.match(String(startup[0]),/J웹:/);
    for(const file of ['education-reference.js','education-kinds.js','app.js','worker-documents.js']){
      const response=await fetch(`http://127.0.0.1:${port}/${file}`);
      assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),/javascript/);
      assert.equal(await response.text(),readFileSync(new URL('../public/'+file,import.meta.url),'utf8'));
    }
    assert.match(admin,/import \{ mountEducationReference \} from '.\/education-reference.js'/);
    assert.match(worker,/import \{ mountEducationReference \} from '.\/education-reference.js'/);
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
