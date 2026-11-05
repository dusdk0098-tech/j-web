import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {requireEducationSubmission,readEducationMethod} from '../public/education-kinds.js';

const admin=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../public/worker-documents.js',import.meta.url),'utf8');
const complete={timeFrom:'09:00',timeTo:'10:00',educationPlace:'가상 장소',educationMethod:'가상 방법',instructor:'가상 강사',textbook:'가상 교재'};
const line=(source,text)=>{const found=source.split(/\r?\n/).find(row=>row.includes(text));assert.ok(found,text);return found;};

test('교육 결재 필수항목은 공백·한쪽 시간 누락을 포함해 정확히 안내한다',()=>{
  const labels={timeFrom:'교육시간',timeTo:'교육시간',educationPlace:'교육장소',educationMethod:'교육방법',instructor:'교육강사',textbook:'사용교재'};
  for(const [key,label] of Object.entries(labels))for(const value of ['', '  ', undefined]){
    assert.throws(()=>requireEducationSubmission({...complete,[key]:value}),error=>{
      assert.match(error.message,new RegExp(label));
      for(const other of new Set(Object.values(labels)))if(other!==label)assert.ok(!error.message.includes(other));
      return true;
    });
  }
  assert.doesNotThrow(()=>requireEducationSubmission(complete));
  assert.throws(()=>requireEducationSubmission({}),/교육시간, 교육장소, 교육방법, 교육강사/);
});

test('관리자 실제 결재 버튼은 누락을 차단하고 완성 요청과 오류를 처리한다',async()=>{
  for(const scenario of ['missing','complete','failed','other']){
    const button={dataset:{action:'submit'}},calls=[],errors=[],doc={id:7,type:scenario==='other'?'tbm':'education',edit_version:3};let renders=0;
    const details=scenario==='missing'||scenario==='other'?{}:complete;
    runInNewContext(line(admin,"document.querySelectorAll('[data-action]').forEach"),{document:{querySelectorAll:()=>[button]},doc,details,requireEducationSubmission,api:async(path,options)=>{calls.push({path,input:JSON.parse(options.body)});if(scenario==='failed')throw Error('가상 전송 오류');},flash(){},render:async()=>{renders++;},showError:error=>errors.push(error.message)});
    await button.onclick();
    assert.equal(calls.length,scenario==='missing'?0:1);
    assert.equal(renders,['complete','other'].includes(scenario)?1:0);
    if(scenario==='missing')assert.match(errors[0],/교육시간, 교육장소, 교육방법, 교육강사/);
    if(scenario==='failed')assert.equal(errors[0],'가상 전송 오류');
    if(calls.length)assert.equal(calls[0].input.expectedEditVersion,3);
  }
});

test('근로자 실제 결재 버튼은 누락·편집 중 요청을 차단하고 실패 시 입력을 보존한다',async()=>{
  for(const scenario of ['missing','complete','failed','editing','other']){
    const node=()=>({children:[],append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
    const list=node(),editor={...node(),dataset:{docId:'7'}},doc={id:7,type:scenario==='other'?'tbm':'education',status:'draft',details:JSON.stringify(scenario==='missing'||scenario==='other'?{}:complete),edit_version:4},calls=[],errors=[];
    if(scenario==='editing')editor.children.push({value:'미저장 가상 입력'});
    const context={list,editor,document:{createElement:node},labels:{education:'교육',tbm:'TBM'},statuses:{draft:'임시저장'},reportContext:{siteId:1},json:async()=>[doc],requireEducationSubmission,send:async(path,method,input)=>{calls.push({path,method,input});if(scenario==='failed')throw Error('가상 전송 오류');},message:error=>errors.push(error.message)};
    await runInNewContext(line(worker,'const updateList=async')+';updateList();',context);
    const button=list.children[0].children.at(-1);await button.onclick();
    assert.equal(calls.length,['missing','editing'].includes(scenario)?0:1);
    if(scenario==='missing')assert.match(errors[0],/교육시간, 교육장소, 교육방법, 교육강사/);
    if(scenario==='editing'){assert.match(errors[0],/먼저 저장/);assert.equal(editor.children[0].value,'미저장 가상 입력');}
    if(scenario==='failed')assert.equal(errors[0],'가상 전송 오류');
    if(errors.length)assert.equal(button.disabled,false);
  }
});

test('근로자 교육 임시저장은 불완전해도 전송하며 실패 입력을 유지한다',async()=>{
  const start=worker.indexOf('    form.onsubmit='),end=worker.indexOf("    if(doc&&type==='work_plan')",start);
  for(const failed of [false,true]){
    const button={disabled:false},form={isConnected:true,elements:Object.fromEntries(['title','date','body','kind','otherTitle','audience','textbook',...Object.keys(complete)].map(key=>[key,{value:key==='body'?'가상 입력':key==='textbook'?'가상 교재':''}])),querySelector:()=>button},editor={clears:0,replaceChildren(){this.clears++;}},calls=[],status={textContent:''};
    runInNewContext(worker.slice(start,end),{form,editor,status,fields:{querySelectorAll:()=>[{value:'강의식'},{value:'토의식'}]},readEducationMethod,type:'education',doc:null,reportContext:{siteId:1},send:async(path,method,input)=>{calls.push(input);if(failed)throw Error('가상 전송 오류');},message:error=>{status.textContent=error.message;},updateList:async()=>{}});
    await form.onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].details.timeFrom,'');assert.equal(calls[0].details.educationPlace,'');assert.equal(calls[0].details.textbook,'가상 교재');assert.equal(calls[0].details.educationMethod,'강의식, 토의식');assert.equal(editor.clears,failed?0:1);assert.equal(form.elements.body.value,'가상 입력');assert.equal(button.disabled,false);assert.match(status.textContent,failed?/전송 오류/:/저장했습니다/);
  }
});

test('관리자 교육 임시저장 콜백과 대화상자는 불완전 저장·실패 입력 보존을 유지한다',async()=>{
  const start=admin.indexOf('async data=>{',admin.indexOf('async function editDocument(')),end=admin.indexOf('  },()=>select.value',start),dialogStart=admin.indexOf('function showDialog('),dialogEnd=admin.indexOf("\n$('#dialog-close')",dialogStart);
  assert.ok(start>=0&&end>start&&dialogEnd>dialogStart);
  for(const failed of [false,true]){
    const calls=[],nodes=Object.fromEntries(['#dialog-title','#dialog-body','#dialog-error','#dialog-form','#dialog-form button[type=submit]'].map(key=>[key,{querySelectorAll:()=>[{value:'시청각'},{value:'토의식'}]}])),data={type:'education',title:'가상 교육',date:'2026-11-02',body:'가상 입력',textbook:'가상 교재'},dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},state={siteId:1,page:'documents',admin:{id:1}};
    const context={readEducationMethod,doc:null,state,siteId:1,page:'documents',actor:state.admin,detailEpoch:1,educationEpoch:1,editCurrent:()=>true,educationDraftWorkers:()=>undefined,hasManagerEducationTargets:()=>false,$:key=>nodes[key],dialog,FormData:class{constructor(){return Object.entries(data);}},api:async(path,options)=>{calls.push(JSON.parse(options.body));if(failed)throw Error('가상 전송 오류');return {id:7};},flash(){},render:async()=>{}};
    const save=runInNewContext('('+admin.slice(start,end)+'\n})',context);
    const show=runInNewContext(admin.slice(dialogStart,dialogEnd)+';showDialog',context);
    show('가상 교육','가상 편집 화면',save);await nodes['#dialog-form'].onsubmit({preventDefault(){},currentTarget:{}});
    assert.equal(calls.length,1);assert.equal(calls[0].details.timeFrom,'');assert.equal(calls[0].details.instructor,'');assert.equal(calls[0].details.textbook,'가상 교재');assert.equal(calls[0].details.educationMethod,'시청각, 토의식');assert.equal(dialog.open,failed);assert.equal(data.body,'가상 입력');assert.equal(nodes['#dialog-body'].innerHTML,'가상 편집 화면');assert.equal(nodes['#dialog-form button[type=submit]'].disabled,false);if(failed)assert.equal(nodes['#dialog-error'].textContent,'가상 전송 오류');
  }
});
