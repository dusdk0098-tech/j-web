import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {permitSources,permitSourceItems} from '../public/permit-sources.js';

const item={accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 조치'},make=(id,extra={})=>({id,site_id:1,type:'permit',status:'approved',date:'2026-10-01',title:'가상 허가',details:JSON.stringify({safetyMeasures:[item],secret:'복사하지 않음'}),...extra});
test('이전 대책은 같은 현장의 승인된 과거 허가서에서만 복사한다',()=>{
  const result=permitSources([make(1),make(2,{site_id:2}),make(3,{status:'draft'}),make(4,{date:'2026-11-01'}),make(5),make(6,{type:'risk'}),make(7,{details:'{'}),make(8,{details:JSON.stringify({safetyMeasures:[{...item,measure:'가'.repeat(2001)}]})})],1,'2026-10-31',5);assert.deepEqual(result.map(row=>row.id),[1]);assert.deepEqual(result[0].items,[item]);const copied=permitSourceItems(result[0],1);copied[0].measure='수정';assert.equal(result[0].items[0].measure,'가상 조치');assert.throws(()=>permitSourceItems(result[0],100),/100/);
});
test('이전 대책 화면은 늦은 조회를 무시하고 기존 항목을 보존해 추가한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("      const sourceList=$('#permit-source-list')"),end=source.indexOf('\n      return;',start);assert.ok(start>=0&&end>start);
  const list={isConnected:true,innerHTML:'',textContent:''},button={},date={value:'2026-10-31'},nodes={'#permit-source-list':list,'#permit-source-load':button,'#dialog-form input[name=date]':date},state={siteId:1,page:'documents'},added=[],existing=[{}];let resolveOld;const old=new Promise(resolve=>resolveOld=resolve);let count=0;
  const context={dialog:{open:true},state,siteId:1,page:'documents',select:{value:'permit'},doc:{id:5},$:selector=>nodes[selector],document:{querySelectorAll:()=>existing},URLSearchParams,api:async()=>++count===1?old:[make(1)],permitSources,permitSourceItems,esc:String,addSafety:row=>added.push(row)};runInNewContext(source.slice(start,end),context);const pending=button.onclick();await button.onclick();assert.match(list.innerHTML,/가상 허가/);resolveOld([make(4)]);await pending;assert.match(list.innerHTML,/가상 허가/);list.onclick({target:{matches:()=>true,dataset:{permitSource:'0'}}});assert.deepEqual(JSON.parse(JSON.stringify(added)),[item]);assert.equal(existing.length,1);date.value='2026-11-01';list.onclick({target:{matches:()=>true,dataset:{permitSource:'0'}}});assert.match(list.textContent,/다시 조회/);assert.equal(added.length,1);
});
