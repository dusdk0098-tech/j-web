import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {equipmentAlias,equipmentAdditional,equipmentOptions} from '../public/equipment-filter.js';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('장비 별칭과 추가정보를 저장하고 이전 수정·복사·계획서 사본에 보존한다',()=>{
 const s=new Store(':memory:');try{const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,kind:'굴착기',model:'가상 모델',capacity:'10톤',manufacturer:'가상 제조사',registration:'가상 번호'},item=s.createEquipment({...base,alias:' 가상 별칭 ',additional:[{label:' 가상 항목 ',value:' 가상 내용 '}]});
 const details=()=>JSON.parse(s.equipment(site.id).find(row=>row.id===item.id).details);assert.equal(details().alias,'가상 별칭');assert.deepEqual(details().additional,[{label:'가상 항목',value:'가상 내용'}]);s.updateEquipment(item.id,{...base,model:'수정 모델'});assert.equal(details().alias,'가상 별칭');assert.equal(details().additional[0].value,'가상 내용');
 const prior=s.equipment(site.id).find(row=>row.id===item.id),expected=Object.fromEntries(['kind','model','capacity','manufacturer','registration','details'].map(key=>[key,prior[key]]));s.updateEquipment(item.id,{...base,model:'최신 모델',expected});assert.throws(()=>s.updateEquipment(item.id,{...base,model:'오래된 모델',expected}),error=>error.sessionStatus===409);let authCalls=0;assert.throws(()=>s.updateEquipment(item.id,{...base,alias:'저장 금지'},()=>{if(++authCalls===2)throw Error('세션 만료');}),/세션 만료/);assert.equal(details().alias,'가상 별칭');assert.throws(()=>s.updateEquipment(item.id,{...base,alias:3}),/별칭/);assert.throws(()=>s.updateEquipment(item.id,{...base,additional:[{label:'',value:'값'}]}),/추가정보/);assert.throws(()=>s.updateEquipment(item.id,{...base,additional:Array(21).fill({label:'가',value:'나'})}),/추가정보/);assert.equal(details().alias,'가상 별칭');
 const version=s.equipmentCopySource(site.id,item.id).version,copied=s.copyEquipment(site.id,item.id,{version,kind:'굴착기',model:'복사',registration:''});assert.equal(JSON.parse(copied.details).alias,'가상 별칭');assert.equal(JSON.parse(copied.details).additional[0].label,'가상 항목');
 const plan=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-01',details:{equipmentIds:[item.id]}});s.transition(plan.id,'submit');const frozen=JSON.parse(s.document(plan.id).details).equipmentSnapshot.find(row=>row.id===item.id);s.updateEquipment(item.id,{...base,alias:'변경',additional:[]});assert.equal(JSON.parse(frozen.details).alias,'가상 별칭');assert.equal(JSON.parse(frozen.details).additional[0].value,'가상 내용');assert.equal(details().alias,'변경');assert.deepEqual(details().additional,[]);
 }finally{s.close();}
});
test('장비 별칭과 추가정보 표시에서 특수문자를 보호한다',()=>{
 const row={id:1,kind:'굴착기',model:'가상',registration:'',details:JSON.stringify({alias:'가상 <별칭>',additional:[{label:'가상 <항목>',value:'가상 <내용>'}]})};assert.equal(equipmentAlias(row),'가상 <별칭>');assert.equal(equipmentAdditional(row)[0].label,'가상 <항목>');const html=equipmentOptions([row],'',0,esc);assert.match(html,/가상 &lt;별칭&gt;/);assert.doesNotMatch(html,/<별칭>/);assert.equal(equipmentAlias({details:'잘못된 값'}),'');assert.deepEqual(equipmentAdditional({details:'잘못된 값'}),[]);
});

test('계획서의 연결 장비는 별칭과 추가정보를 안전하게 표시한다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(value=>value.includes("if(selectedEquipment.length)content.querySelector"));assert.ok(line);let html='';const content={querySelector:()=>({insertAdjacentHTML:(_where,value)=>{html=value;}})},selectedEquipment=[{id:1,kind:'굴착기',model:'모델',registration:'번호',details:JSON.stringify({alias:'가상 <별칭>',additional:[{label:'가상 <항목>',value:'가상 <내용>'}]})}];runInNewContext(line,{content,selectedEquipment,details:{},equipmentFiles:[[]],equipmentAlias,equipmentAdditional,esc,doc:{site_id:1}});assert.match(html,/가상 &lt;별칭&gt;/);assert.match(html,/가상 &lt;항목&gt;: 가상 &lt;내용&gt;/);assert.doesNotMatch(html,/<별칭>|<항목>|<내용>/);
});
