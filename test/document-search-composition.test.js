import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('문서와 업체 및 출입자 검색은 한글 조합 완료 후 엔터로 검색한다', () => {
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const lines=source.split(/\r?\n/);
  const wire=lines.find(line=>line.startsWith('function wireSearch()'));
  const line=lines.find(line=>line.includes("if($('#work-plan-company-filter'))$('#work-plan-company-filter').onkeydown"));
  const worker=lines.find(line=>line.includes("$('#worker-order').onchange=()=>$('#search').click();return;"));
  assert.ok(wire&&line&&worker);
  const handlers=line.slice(line.indexOf("if($('#work-plan-company-filter'))$('#work-plan-company-filter').onkeydown"));
  let clicks=0;
  const nodes={'#search':{click:()=>clicks++},'#query':{},'#work-plan-company-filter':{},'#meeting-company-filter':{}};
  runInNewContext(`${wire}\nwireSearch();\n${handlers}`,{$:key=>nodes[key],content:{querySelectorAll:()=>[]}});
  const workerNodes={'#search':nodes['#search'],'#query':{}};
  runInNewContext(worker.slice(worker.indexOf("$('#query').onkeydown"),worker.indexOf("$('#worker-order').onchange")),{$:key=>workerNodes[key]});
  nodes['#worker-query']=workerNodes['#query'];
  for(const key of ['#query','#work-plan-company-filter','#meeting-company-filter','#worker-query']){
    const onkeydown=nodes[key].onkeydown;
    onkeydown({key:'Enter',isComposing:true,keyCode:13});
    onkeydown({key:'Enter',isComposing:false,keyCode:229});
    onkeydown({key:'a',isComposing:false,keyCode:65});
    assert.equal(clicks,0);
    onkeydown({key:'Enter',isComposing:false,keyCode:13});
    assert.equal(clicks,1);
    clicks=0;
  }
});
