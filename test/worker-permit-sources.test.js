import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerPermitSources} from '../public/permit-sources.js';

test('근로자 허가서 참조는 승인된 본인 문서만 다시 확인해 추가한다',async()=>{
  const previous=globalThis.document,make=tag=>({tag,children:[],append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
  globalThis.document={createElement:make,createTextNode:text=>({text})};
  try{
    const button={},status={},results=make('div'),date={value:'2026-11-01',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}},host={isConnected:true,querySelector(key){return {'[data-load]':button,'[data-status]':status,'[data-results]':results}[key];}},added=[];
    const row=(id,status='approved',site=1)=>({id,site_id:site,type:'permit',status,date:'2026-10-01',title:'가상 허가',details:JSON.stringify({safetyMeasures:[{accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 조치'}]})});
    let rows=[row(1),row(2,'draft'),row(3,'approved',2)],live=true;
    mountWorkerPermitSources({host,form:{elements:{date}},siteId:1,documentId:9,request:async()=>rows,active:()=>live,count:()=>added.length,add:item=>added.push(item)});
    await button.onclick();assert.equal(results.children.length,1);const copy=results.children[0].children[1];await copy.onclick();assert.deepEqual(added,[{accidentType:'가상 유형',hazard:'가상 위험',measure:'가상 조치'}]);
    rows=[row(1,'rejected')];await copy.onclick();assert.equal(added.length,1);assert.match(status.textContent,/변경/);
    rows=[row(1)];await button.onclick();const stale=results.children[0].children[1];date.value='2026-11-02';date.handlers.change();await stale.onclick();assert.equal(added.length,1);assert.equal(results.children.length,0);
    await button.onclick();const stopped=results.children[0].children[1];live=false;await stopped.onclick();assert.equal(added.length,1);
  }finally{globalThis.document=previous;}
});
