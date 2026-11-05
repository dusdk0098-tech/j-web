import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPlanWorkerSearch} from '../public/plan-worker-other.js';

function screen(){
 const events=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}}),search={...events(),value:''},status={textContent:''},select={...events(),value:'2',options:[{value:'',textContent:'선택'},{value:'1',textContent:'가상 홍길동 · 서울 업체'},{value:'2',textContent:'가상 김하늘 · 부산 업체'},{value:'3',textContent:'가상 박하늘 · 서울 업체'}]},row={querySelector:key=>key==='[data-plan-worker-search]'?search:status};mountPlanWorkerSearch(row,select);return {search,status,select};
}
test('작업자 검색은 이름과 소속을 좁히면서 기존 선택을 유지한다',()=>{
 const {search,status,select}=screen();search.value='서울';search.handlers.input({isComposing:false});assert.deepEqual(select.options.map(o=>o.hidden),[false,false,false,false]);assert.equal(select.value,'2');assert.match(status.textContent,/2명/);
 search.value='홍길동';search.handlers.input({isComposing:false});assert.deepEqual(select.options.map(o=>o.hidden),[false,false,false,true]);select.value='1';select.handlers.change();assert.deepEqual(select.options.map(o=>o.hidden),[false,false,true,true]);search.value='찾을 수 없음';search.handlers.input({isComposing:false});assert.equal(select.options[1].hidden,false);assert.match(status.textContent,/0명/);search.value='';search.handlers.input({isComposing:false});assert.ok(select.options.every(o=>!o.hidden));
});
test('한글 조합 중 검색을 미루고 엔터는 양식 제출을 막는다',()=>{
 const {search,status,select}=screen();search.value='서울';search.handlers.input({isComposing:true});assert.match(status.textContent,/3명/);search.handlers.compositionend();assert.match(status.textContent,/2명/);let prevented=0;search.handlers.keydown({key:'Enter',isComposing:true,preventDefault(){prevented++;}});search.handlers.keydown({key:'Enter',isComposing:false,preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(select.value,'2');
 for(const file of ['../public/app.js','../public/worker-documents.js']){const text=readFileSync(new URL(file,import.meta.url),'utf8');assert.match(text,/data-plan-worker-search/);assert.match(text,/mountPlanWorkerSearch\(/);}
});
