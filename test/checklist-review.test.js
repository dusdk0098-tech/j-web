import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { checklistQuestions } from '../public/checklist-copy.js';

const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8');
const render=runInNewContext(source.slice(source.indexOf('function displayFields('),source.indexOf('function pad('))+';displayDocumentDetails',{
  checklistQuestions,labels:{kind:'종류',note:'비고'},educationKinds:{},
  esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
});

test('결재 상세는 종류별 문항에 저장된 답변과 비고를 연결해 표시한다',()=>{
  for(const [kind,names] of Object.entries(checklistQuestions)){
    const answers=names.map((_,i)=>({answer:i===0?'X':'O',note:i===0?'<가상>':''}));
    const html=render({type:'checklist',details:JSON.stringify({kind,answers})});
    assert.ok(html.includes(names[0]),kind);assert.match(html,/X/);assert.match(html,/&lt;가상&gt;/);assert.doesNotMatch(html,/<가상>/);
  }
  const answers=Array.from({length:7},()=>({answer:'O',note:''}));
  const old=render({type:'checklist',details:JSON.stringify({kind:'rain',answers})});
  const current=render({type:'checklist',details:JSON.stringify({kind:'rain_detail',answers})});
  assert.match(old,/양수기 비치/);assert.doesNotMatch(old,/수중 배수 펌프/);assert.match(current,/수중 배수 펌프/);
  const heatAnswers=Array.from({length:8},()=>({answer:'O',note:''}));const oldHeat=render({type:'checklist',details:JSON.stringify({kind:'heat',answers:heatAnswers})}),newHeat=render({type:'checklist',details:JSON.stringify({kind:'heat_detail',answers:heatAnswers})});assert.doesNotMatch(oldHeat,/오후 1~3시/);assert.match(newHeat,/오후 1~3시/);
  const coldAnswers=Array.from({length:10},()=>({answer:'O',note:''}));const oldCold=render({type:'checklist',details:JSON.stringify({kind:'cold',answers:coldAnswers})}),newCold=render({type:'checklist',details:JSON.stringify({kind:'cold_detail',answers:coldAnswers})});assert.doesNotMatch(oldCold,/영하 작업 중지/);assert.match(newCold,/영하 작업 중지/);
  const malformed=render({type:'checklist',details:JSON.stringify({kind:'rain',answers:[{answer:'X',note:'보존'}]})});assert.match(malformed,/보존/);
});
