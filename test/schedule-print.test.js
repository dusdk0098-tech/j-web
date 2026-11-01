import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const printRules=[...css.matchAll(/@media\s+print\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
  .flatMap(media=>[...media[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)]);
function printDisplay(selector){
  return printRules.filter(rule=>rule[1].split(',').map(value=>value.trim()).includes(selector))
    .flatMap(rule=>[...rule[2].matchAll(/(?:^|;)\s*display\s*:\s*([^;]+)/g)])
    .at(-1)?.[1].trim();
}

test('일정 항목은 전역 버튼 숨김을 이기는 달력 전용 인쇄 예외가 있다',()=>{
  assert.equal(printDisplay('.schedule-calendar [data-schedule-edit]'),'block!important');
  assert.equal(printDisplay('[data-schedule-edit]'),undefined);
  assert.equal(printDisplay('.schedule-calendar button'),undefined);
});

test('인쇄에서 일반 조작 버튼은 숨기고 날짜 숫자만 남긴다',()=>{
  assert.equal(printDisplay('button'),'none!important');
  assert.equal(printDisplay('.schedule-calendar .schedule-day'),'flex!important');
  assert.equal(printDisplay('.schedule-calendar .schedule-day span'),'none');
  assert.equal(printDisplay('[data-schedule-add]'),undefined);
});
