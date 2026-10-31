import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('안전관리비 검색은 항목·내역·비고를 찾고 월 전체 합계를 유지한다',async()=>{
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf("  if(state.page==='safety-costs'){"),end=code.indexOf("  if(state.page==='rigging'){",start);
  assert.ok(start>=0&&end>start);
  const data={total:'3000',rows:[{id:1,date:'2026-10-01',category:1,description:'가상 장갑',note:'빨강',unit_price:'1000',quantity:'1',unit:'개',amount:'1000'},{id:2,date:'2026-10-02',category:2,description:'가상 모자',note:'파랑',unit_price:'2000',quantity:'1',unit:'개',amount:'2000'}]};
  async function check(keyword,expected,absent){
    const nodes={'#cost-search':{insertAdjacentHTML(_where,html){this.html=html;}},'#cost-photos':{previousElementSibling:{}},'#new-cost':{},'#new-cost-report':{}};
    const content={innerHTML:'',querySelector:()=>({insertAdjacentHTML(){}})};
    const context={state:{page:'safety-costs',siteId:7,costMonth:'2026-10',costKeyword:keyword},content,api:async()=>structuredClone(data),today:()=>'',costCategories:['보호구','안전시설'],esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),$:key=>nodes[key],document:{querySelectorAll:()=>[]},showDialog(){},field(){},render:async()=>{},showError(){},encodeURIComponent};
    await runInNewContext('(async()=>{'+code.slice(start,end)+'})()',context);
    assert.match(content.innerHTML,/해당 월 합계: 3000원/);assert.ok(content.innerHTML.includes(expected));assert.ok(!content.innerHTML.includes(absent));return nodes;
  }
  await check('보호구','가상 장갑','가상 모자');await check('모자','가상 모자','가상 장갑');await check('빨강','가상 장갑','가상 모자');
  const nodes=await check('없는 검색어','등록된 시험 사용내역이 없습니다.','가상 장갑');assert.match(nodes['#cost-photos'].previousElementSibling.textContent,/검색 조건/);
  const escaped=await check('<"','등록된 시험 사용내역이 없습니다.','가상 장갑');assert.match(escaped['#cost-search'].html,/&lt;&quot;/);
});
