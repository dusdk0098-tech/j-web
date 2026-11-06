import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {checklistCategoryForKind} from '../public/checklist-copy.js';

test('체크리스트 분류와 이름 검색은 기존 선택을 보존한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.match(/^function filterChecklistKinds\(.*$/m)?.[0];
  assert.ok(line);const context={};runInNewContext(line+'\nglobalThis.filter=filterChecklistKinds;',context);
  const option=(value,category,text,selected=false)=>({value,dataset:{category},textContent:text,selected,hidden:false});
  const [placeholder,rain,wind,morning]=[option('','','미선택'),option('rain','weather','우천시 체크리스트',true),option('wind','weather','강풍 대비 점검'),option('morning','daily','일일 안전 점검')],select={options:[placeholder,rain,wind,morning]};
  context.filter(select,'daily','');assert.equal(placeholder.hidden,false);assert.equal(rain.hidden,false);assert.equal(wind.hidden,true);assert.equal(morning.hidden,false);
  rain.selected=false;morning.selected=true;context.filter(select,'weather','강풍');assert.equal(rain.hidden,true);assert.equal(wind.hidden,false);assert.equal(morning.hidden,false);
  context.filter(select,'','');assert.ok(select.options.every(item=>!item.hidden));
});

test('작성 화면에서 검색과 종류 변경을 반복해도 종류별 답변을 복원한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    if(select.value==='checklist'){"),end=source.indexOf("    if(select.value==='safety_log'){",start);
  assert.ok(start>=0&&end>start);
  const category={value:''},search={value:''},checks={html:'',set innerHTML(value){this.html=value;},get innerHTML(){return this.html;}},kind={value:'',options:[]};
  const fields={set innerHTML(html){
    const body=html.match(/<select name="checklistKind">([\s\S]*?)<\/select>/)?.[1];assert.ok(body);
    kind.options=[...body.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(([,value,attrs,textContent])=>({value,textContent,dataset:{category:attrs.match(/data-category="([^"]*)"/)?.[1]||''},hidden:false,get selected(){return kind.value===value;}}));
    kind.value=body.match(/<option value="([^"]*)"[^>]*\bselected\b/)?.[1]||'';
  }};
  let currentRows=[];const nodes={'#daily-fields':fields,'#dialog-form [name=checklistKind]':kind,'#checklist-category':category,'#checklist-search':search,'#rain-checks':checks,'#checklist-copy':{},'#checklist-copy-list':{isConnected:true}};
  const context={select:{value:'checklist'},details:{kind:'rain',answers:[{answer:'O',note:'기존 가상 비고'}]},$:key=>nodes[key],document:{querySelectorAll:()=>currentRows},esc:String,checklistCategoryForKind};
  for(const name of ['rainChecks','rainDetailChecks','windChecks','thawChecks','heatChecks','heatDetailChecks','coldChecks','coldDetailChecks','wetSeasonChecks','heavyRainChecks','electricalChecks','fireChecks','formworkChecks','fallingChecks','confinedChecks','excavationChecks','semiannualChecks','morningChecks','afternoonChecks','eveningChecks'])context[name]=['가상 항목'];
  const filter=source.match(/^function filterChecklistKinds\(.*$/m)[0];runInNewContext(filter+'\nfunction render(){'+source.slice(start,end)+'}\nglobalThis.render=render;',context);context.render();
  assert.equal(kind.value,'rain');assert.match(checks.html,/기존 가상 비고/);assert.equal(kind.options.length,21);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'O':'기존 가상 비고'})}];kind.value='rain_detail';kind.onchange();assert.doesNotMatch(checks.html,/기존 가상 비고/);currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'상세 가상 비고'})}];kind.value='rain';kind.onchange();assert.match(checks.html,/기존 가상 비고/);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'O':'기존 가상 비고'})}];kind.value='heat';kind.onchange();currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'이전 고온 비고'})}];kind.value='heat_detail';kind.onchange();assert.doesNotMatch(checks.html,/이전 고온 비고/);currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'O':'새 고온 비고'})}];kind.value='heat';kind.onchange();assert.match(checks.html,/이전 고온 비고/);currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'이전 고온 비고'})}];kind.value='cold';kind.onchange();currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'이전 저온 비고'})}];kind.value='cold_detail';kind.onchange();assert.doesNotMatch(checks.html,/이전 저온 비고/);currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'O':'새 저온 비고'})}];kind.value='cold';kind.onchange();assert.match(checks.html,/이전 저온 비고/);currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'이전 고온 비고'})}];kind.value='rain';kind.onchange();
  category.value='daily';category.onchange();assert.equal(kind.options.find(item=>item.value==='rain').hidden,false);assert.equal(kind.options.find(item=>item.value==='wind').hidden,true);
  search.value='일일';search.oninput();assert.equal(kind.options.find(item=>item.value==='morning').hidden,false);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'수정한 가상 비고'})}];kind.value='morning';kind.onchange();assert.equal(kind.options.find(item=>item.value==='rain').hidden,true);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'7명':'아침 가상 비고'})}];category.value='';search.value='';category.onchange();kind.value='rain';kind.onchange();
  assert.match(checks.html,/수정한 가상 비고/);assert.match(checks.html,/<option selected>X<\/option>/);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'수정한 가상 비고'})}];kind.value='morning';kind.onchange();assert.match(checks.html,/7명/);assert.match(checks.html,/아침 가상 비고/);
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'7명':'아침 가상 비고'})}];kind.value='wind';kind.onchange();assert.match(checks.html,/시험 사진 비고/);
  nodes['#wind-photo-note']={value:'가상 사진 설명'};currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'O':'가상 점검 비고'})}];kind.value='rain';kind.onchange();
  currentRows=[{querySelector:key=>({value:key==='[data-answer]'?'X':'수정한 가상 비고'})}];kind.value='wind';kind.onchange();assert.match(checks.html,/가상 사진 설명/);assert.match(checks.html,/가상 점검 비고/);
});
