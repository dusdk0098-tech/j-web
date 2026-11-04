import test from 'node:test';
import assert from 'node:assert/strict';
import {imageChoiceMarkup,refreshPlanImageChoices} from '../public/plan-charts.js';

test('사진 목록 갱신은 선택을 보존하고 삭제된 사진은 해제하도록 표시한다',()=>{
  const images=[{id:1,name:'기존 사진',category:'plan_diagram'},{id:2,name:'새 사진',category:'plan_diagram'},{id:3,name:'일반 첨부',category:'general'}],esc=value=>String(value).replaceAll('<','&lt;');
  const chart={querySelectorAll:()=>[{value:'1'},{value:'9'}],innerHTML:''},heavy={querySelectorAll:()=>[{value:'1'}],innerHTML:''},fields={querySelectorAll:selector=>selector.includes('chart')?[chart]:[heavy]};
  refreshPlanImageChoices(fields,images,esc);assert.match(chart.innerHTML,/value="1" checked/);assert.match(chart.innerHTML,/새 사진/);assert.match(chart.innerHTML,/value="9" checked/);assert.match(chart.innerHTML,/선택 해제 필요/);assert.doesNotMatch(chart.innerHTML,/일반 첨부/);assert.match(heavy.innerHTML,/data-heavy-image/);
  assert.match(imageChoiceMarkup([{id:4,name:'<사진>',category:'plan_diagram'}],[4],esc,'data-chart-image'),/&lt;사진>/);
});
