import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('체크리스트 분류와 이름 검색은 기존 선택을 보존한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.match(/^function filterChecklistKinds\(.*$/m)?.[0];
  assert.ok(line);const context={};runInNewContext(line+'\nglobalThis.filter=filterChecklistKinds;',context);
  const option=(value,category,text,selected=false)=>({value,dataset:{category},textContent:text,selected,hidden:false});
  const [placeholder,rain,wind,morning]=[option('','','미선택'),option('rain','weather','우천시 체크리스트',true),option('wind','weather','강풍 대비 점검'),option('morning','daily','일일 안전 점검')],select={options:[placeholder,rain,wind,morning]};
  context.filter(select,'daily','');assert.equal(placeholder.hidden,false);assert.equal(rain.hidden,false);assert.equal(wind.hidden,true);assert.equal(morning.hidden,false);
  rain.selected=false;morning.selected=true;context.filter(select,'weather','강풍');assert.equal(rain.hidden,true);assert.equal(wind.hidden,false);assert.equal(morning.hidden,false);
  context.filter(select,'','');assert.ok(select.options.every(item=>!item.hidden));
});
