import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentCheckResults} from '../public/equipment-check-results.js';
import {readFileSync} from 'node:fs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('점검 유형별로 구분·판정·조치를 함께 표시하고 이전 항목과 HTML을 보존한다',()=>{
 const rows=[{checkType:'일반',section:'<구분>',name:'<항목>',result:'부적정',action:'<조치>'},{checkType:'장비',section:'기계',name:'같은 항목',result:'적정'},{name:'이전 항목',result:'해당없음'}],html=equipmentCheckResults(rows,esc);
 for(const expected of ['일반 점검','장비 점검','유형 미기록 점검','&lt;구분&gt;','&lt;항목&gt;','&lt;조치&gt;','부적정','이전 항목'])assert.ok(html.includes(expected),expected);assert.equal((html.match(/<table>/g)||[]).length,3);assert.doesNotMatch(html,/<구분>|<항목>|<조치>/);assert.match(equipmentCheckResults([],esc),/항목이 없습니다/);
});
test('관리자·제한 관리자·결재자가 같은 점검 표시를 사용한다',()=>{
 const app=readFileSync('public/app.js','utf8'),review=readFileSync('public/review.js','utf8');assert.ok((app.match(/equipmentCheckResults\(/g)||[]).length>=3);assert.equal((review.match(/equipmentCheckResults\(/g)||[]).length,2);assert.match(app,/equipment-check-results\.js/);assert.match(review,/equipment-check-results\.js/);
});

test('결재 사본은 점검 결과와 사진 링크를 함께 표시한다',async()=>{
 const {runInNewContext}=await import('node:vm'),source=readFileSync('public/review.js','utf8'),start=source.indexOf('function planCheckApproval('),end=source.indexOf('async function openEquipmentCheck(',start);assert.ok(start>=0&&end>start);const context={esc,equipmentCheckResults,displayFields:()=>''};runInNewContext(source.slice(start,end),context);const html=context.planLinks(5,{type:'plan',equipment:[],rigging:[],place:null,checks:[{id:7,date:'2026-11-06',items:[{checkType:'장비',name:'가상 점검',result:'적정'}],photos:[{id:9,name:'가상.png'}]}]},true);assert.match(html,/장비 점검/);assert.match(html,/가상 점검/);assert.match(html,/equipment-check-photo\/7\/9\?preview=1/);
});
