import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentKinds,equipmentOptions,equipmentFilterMarkup,mountEquipmentFilter} from '../public/equipment-filter.js';

test('장비 분류로 등록 장비를 좁히고 다시 돌아오면 선택을 유지한다',()=>{
  const items=[{id:1,kind:'굴착기',model:'A',registration:'가상 1'},{id:2,kind:'덤프트럭',model:'B',registration:'가상 2'},{id:3,kind:'기타 장비',model:'C',registration:'가상 3'}],escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');
  assert.ok(equipmentKinds(items).includes('기타 장비'));assert.match(equipmentOptions(items,'굴착기',1,escape),/가상 1/);assert.doesNotMatch(equipmentOptions(items,'굴착기',1,escape),/가상 2/);
  assert.match(equipmentFilterMarkup(items,1,escape),/value="1" selected/);
  const select=value=>({value,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},set innerHTML(html){this.html=html;this.value=html.match(/value="([^"]*)" selected/)?.[1]||'';}}),kind=select(''),equipment=select('1'),row={querySelector:selector=>selector.includes('kind')?kind:equipment};
  mountEquipmentFilter(row,items,escape);kind.value='굴착기';kind.handlers.change();assert.equal(equipment.value,'1');assert.doesNotMatch(equipment.html,/가상 2/);
  kind.value='덤프트럭';kind.handlers.change();assert.equal(equipment.value,'');equipment.value='2';equipment.handlers.change();kind.value='굴착기';kind.handlers.change();assert.equal(equipment.value,'1');kind.value='덤프트럭';kind.handlers.change();assert.equal(equipment.value,'2');
});
