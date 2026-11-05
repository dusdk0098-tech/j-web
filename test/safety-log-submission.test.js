import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Store} from '../store.js';

test('안전 일지는 임시저장을 허용하고 필수 항목과 서명 후 결재 요청한다',()=>{
 const s=new Store(':memory:');try{
  const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'safety_log',title:'가상 일지',date:'2026-11-01'},full={weather:'맑음',todayWork:'가상 업무',tomorrowWork:'가상 계획'},png=new PNG({width:1,height:1});png.data[3]=255;const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
  for(const missing of ['weather','todayWork','tomorrowWork']){
   const details={...full,[missing]:'  '},doc=s.createDocument({...base,details});s.saveMeetingSignature(doc.id,signature);assert.throws(()=>s.transition(doc.id,'submit'),/날씨.*금일.*명일/);assert.equal(s.document(doc.id).status,'draft');assert.ok(s.meetingSignature(doc.id));assert.equal(s.document(doc.id).approval_cycle_id,null);
  }
  const doc=s.createDocument({...base,details:full});assert.throws(()=>s.transition(doc.id,'submit'),/서명/);assert.equal(s.document(doc.id).status,'draft');s.saveMeetingSignature(doc.id,signature);s.transition(doc.id,'submit');assert.equal(s.document(doc.id).status,'pending');
 }finally{s.close();}
});
