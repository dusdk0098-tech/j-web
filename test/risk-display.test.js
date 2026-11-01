import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('위험요인 표시 선택은 해당 항목만 숨기고 생략 안내를 남긴다',()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf('const riskFields='),end=code.indexOf('\n}',code.indexOf('function configureRiskDisplay',start))+2;
  assert.ok(start>=0&&end>start);
  const createElement=tag=>({tag,children:[],hidden:false,append(...nodes){this.children.push(...nodes);},setAttribute(){},addEventListener(_type,fn){this.change=fn;},querySelectorAll(){return this.children.flatMap(label=>label.children||[]).filter(node=>node.tag==='input');}});
  const rows=['위험 분류','위험 형태','관련 근거','기존 조치','개선 후 위험 등급','개선 후 가능성','개선 후 중대성','개선 후 시험 점수','작업 내용'].map(text=>({hidden:false,querySelector:()=>({textContent:text})}));
  const panel={querySelectorAll:()=>rows,prepend(...nodes){this.controls=nodes[0];this.notice=nodes[1];}};
  const document={createElement,createTextNode:text=>({text})};
  runInNewContext(`${code.slice(start,end)};configureRiskDisplay(panel);`,{document,panel});
  const inputs=panel.controls.querySelectorAll('input');assert.equal(inputs.length,5);
  inputs[4].checked=false;inputs[4].change();assert.deepEqual(rows.map(row=>row.hidden),[false,false,false,false,true,true,true,true,false]);assert.match(panel.notice.textContent,/생략/);
  inputs[0].checked=false;inputs[0].change();inputs[4].checked=true;inputs[4].change();assert.equal(rows[0].hidden,true);assert.equal(rows[4].hidden,false);assert.match(panel.notice.textContent,/생략/);
  inputs[0].checked=true;inputs[0].change();assert.equal(panel.notice.textContent,'');assert.ok(rows.every(row=>!row.hidden));
});
