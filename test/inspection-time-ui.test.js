import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const addLine=source.split(/\r?\n/).find(line=>line.includes("const add=row=>{const list=$('#inspection-rows')"));
const saveLine=source.split(/\r?\n/).find(line=>line.includes("if(data.type==='inspection')data.details="));
assert.ok(addLine&&saveLine);
function screen(value){
  const list={lastElementChild:null,insertAdjacentHTML(_position,html){const fields={};for(const m of html.matchAll(/<(?:input|textarea)\b([^>]*)>/g)){const a=m[1],key=a.match(/data-inspection-field="([^"]+)"/)?.[1],mid=a.match(/data-inspection-midnight="([^"]+)"/)?.[1];if(key)fields['field:'+key]={value:a.match(/value="([^"]*)"/)?.[1]||'',disabled:/\bdisabled\b/.test(a)};if(mid)fields['midnight:'+mid]={checked:/\bchecked\b/.test(a)};}this.lastElementChild={fields,querySelector(selector){if(selector==='[data-inspection-remove]')return {};const name=selector.match(/data-inspection-(field|midnight)="([^"]+)"/)?.slice(1);return fields[name?.join(':')];}};}};
  const contextAdd={$:()=>list,esc:String};runInNewContext(addLine+';globalThis.add=add;',contextAdd);contextAdd.add({inspector:'가상 점검자',hazard:'가상 상태',timeFrom:'23:00',timeTo:value});
  const row=list.lastElementChild,data={type:'inspection'},context={data,document:{querySelectorAll:()=>[row]}};runInNewContext(saveLine,context);
  return {row,data,save(){runInNewContext(saveLine,context);return data.details.rows[0];}};
}
test('기존 24:00 시간은 화면 편집과 저장에서 보존되고 다른 시간으로 바꿀 수 있다',()=>{
  const ui=screen('24:00'),toggle=ui.row.fields['midnight:timeTo'],field=ui.row.fields['field:timeTo'];assert.equal(toggle.checked,true);assert.equal(field.disabled,true);assert.equal(ui.data.details.rows[0].timeTo,'24:00');
  toggle.checked=false;toggle.onchange();field.value='23:55';assert.equal(field.disabled,false);assert.equal(ui.save().timeTo,'23:55');
  toggle.checked=true;toggle.onchange();assert.equal(field.disabled,true);assert.equal(ui.save().timeTo,'24:00');
});

test('일반 시간은 24:00을 선택했다 해제해도 원래 입력을 유지한다',()=>{
  const ui=screen('07:25'),toggle=ui.row.fields['midnight:timeTo'],field=ui.row.fields['field:timeTo'];assert.equal(toggle.checked,false);assert.equal(field.disabled,false);assert.equal(ui.save().timeTo,'07:25');
  toggle.checked=true;toggle.onchange();assert.equal(ui.save().timeTo,'24:00');toggle.checked=false;toggle.onchange();assert.equal(ui.save().timeTo,'07:25');
});
