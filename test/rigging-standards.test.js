import test from 'node:test';
import assert from 'node:assert/strict';
import {riggingStandardChoices,mountRiggingStandards} from '../public/rigging-standards.js';
import {Store} from '../store.js';

test('장구별 규격을 표시하고 다시 선택할 때 입력을 보존한다',()=>{
  const select=value=>({value,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},set innerHTML(html){this.html=html;this.value=html.match(/value="([^"]*)" selected/)?.[1]||'';}});
  const rope=select('1'),fastening=select('3'),ropeSpec=select(''),fasteningSpec=select(''),controls={riggingId:rope,fasteningId:fastening,ropeStandard:ropeSpec,fasteningStandard:fasteningSpec},row={querySelector(selector){return controls[selector.match(/"([^"]+)"/)[1]];}},assets=[{id:1,details:JSON.stringify({standards:['10mm','12mm']})},{id:2,standards:['20mm']},{id:3,standards:['5t']}];
  mountRiggingStandards(row,assets,{ropeStandard:'10mm',fasteningStandard:'5t'},String);
  assert.equal(ropeSpec.value,'10mm');assert.equal(fasteningSpec.value,'5t');
  ropeSpec.value='12mm';ropeSpec.handlers.change();rope.value='2';rope.handlers.change();assert.match(ropeSpec.html,/20mm/);assert.equal(ropeSpec.value,'');
  rope.value='1';rope.handlers.change();assert.equal(ropeSpec.value,'12mm');
  assert.deepEqual(riggingStandardChoices({standards:['10mm']},'이전 값'),['10mm','이전 값']);assert.deepEqual(riggingStandardChoices({details:'잘못된 자료'}),[]);
});

test('근로자 장구 선택 정보에 같은 현장의 등록 규격이 포함된다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),invite=s.createInvitation(a.id),worker=s.join(invite.token,{name:'가상 근로자',loginId:'spec_worker',password:'virtual-password-123',category:'직영',company:'가상 업체',occupation:'가상 직종',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),make=(siteId,name)=>s.createRigging({siteId,category:'줄걸이',kind:'가상 줄',name,standards:['10mm'],additional:[],spec:''});
    make(a.id,'같은 현장');make(b.id,'다른 현장');s.setWorkerPermissions(a.id,worker.id,['work_plan']);
    const options=s.workerDocumentOptions(a.id,worker.id,'work_plan');assert.equal(options.rigging.length,1);assert.equal(options.rigging[0].name,'같은 현장');assert.deepEqual(options.rigging[0].standards,['10mm']);
  }finally{s.close();}
});
