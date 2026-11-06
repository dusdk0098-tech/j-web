import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const line=source.split('\n').find(value=>value.includes('const table=rows.length?')&&value.includes('row.creator_name'));
assert.ok(line);
const render=runInNewContext(`(rows,esc,item)=>{${line};return table;}`);
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

test('일정 표는 날짜와 시간을 나누고 기존 등록인을 추측하지 않는다',()=>{
  const html=render([{id:1,kind:'회의',target_name:'',start_date:'2026-10-30',end_date:'2026-11-02',start_time:'09:17',end_time:'24:00',content:'<일정>',creator_name:''}],esc,()=>'<button>상세</button>');
  assert.match(html,/<th>날짜<\/th><th>시간<\/th>/);
  assert.match(html,/<td>2026-10-30 ~ 2026-11-02<\/td><td>09:17 ~ 24:00<\/td>/);
  assert.match(html,/<td>&lt;일정&gt;<\/td><td>기록 없음<\/td>/);
  assert.doesNotMatch(html,/<일정>/);
  const old=render([{kind:'기타',start_date:'2026-11-02',end_date:'2026-11-02',start_time:'',end_time:'',content:'내용',creator_name:'<관리자>'}],esc,()=> '');
  assert.match(old,/<td>미지정 ~ 미지정<\/td>/);
  assert.match(old,/<td>&lt;관리자&gt;<\/td>/);
  assert.match(render([],esc,()=>''),/등록된 시험 일정이 없습니다/);
});
