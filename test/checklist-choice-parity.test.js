import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {recordInput} from '../domain.js';
import {checklistCategoryForKind,checklistKindLabels} from '../public/checklist-copy.js';

test('열세 체크리스트의 판정 선택지는 화면과 저장 검증에서 일치한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    if(select.value==='checklist'){"),end=source.indexOf("    if(select.value==='safety_log'){",start);
  assert.ok(start>=0&&end>start);
  const kinds=[['rain','rainChecks',[false,false,true,true,true,true,true]],['rain_detail','rainDetailChecks',[false,false,true,true,true,true,true]],['wet_season','wetSeasonChecks',Array(6).fill(true)],['heavy_rain','heavyRainChecks',[false,...Array(10).fill(true)]],['heat','heatChecks',[false,false,true,false,false,true,true,true]],['heat_detail','heatDetailChecks',[false,false,true,false,false,true,true,true]],['electrical','electricalChecks',Array(12).fill(true)],['wind','windChecks',Array(9).fill(true)],['thaw','thawChecks',Array(15).fill(true)],['cold','coldChecks',Array(10).fill(true)],['cold_detail','coldDetailChecks',Array(10).fill(true)],['formwork','formworkChecks',Array(7).fill(true)],['falling','fallingChecks',Array(8).fill(true)],['confined','confinedChecks',Array(4).fill(true)],['excavation','excavationChecks',Array(8).fill(true)],['fire','fireChecks',Array(5).fill(true)]];
  for(const [name,arrayName,expected] of kinds){
    const select={value:name,options:[]},fields={innerHTML:''},checks={innerHTML:''},category={value:''},search={value:''};
    const nodes={'#daily-fields':fields,'#dialog-form [name=checklistKind]':select,'#rain-checks':checks,'#checklist-category':category,'#checklist-search':search,'#checklist-copy':{},'#checklist-recent-date':{value:''},'#checklist-copy-list':{isConnected:true},'#dialog-form input[name=date]':{value:'2026-11-06'}},context={today:()=> '2026-11-06',select:{value:'checklist'},details:{kind:name,answers:[]},$:key=>nodes[key],document:{querySelectorAll:()=>[]},esc:String,filterChecklistKinds(){},checklistCategoryForKind,checklistKindLabels};
    for(const key of ['rainChecks','rainDetailChecks','windChecks','thawChecks','heatChecks','heatDetailChecks','coldChecks','coldDetailChecks','wetSeasonChecks','heavyRainChecks','electricalChecks','fireChecks','formworkChecks','fallingChecks','confinedChecks','excavationChecks','semiannualChecks','morningChecks','afternoonChecks','eveningChecks'])context[key]=key===arrayName?Array(expected.length).fill('가상 항목'):[];
    runInNewContext('function render(){'+source.slice(start,end)+'}\nglobalThis.render=render;',context);context.render();
    const rows=[...checks.innerHTML.matchAll(/<fieldset data-check-row>[\s\S]*?<\/fieldset>/g)].map(match=>match[0]);assert.equal(rows.length,expected.length);
    const answers=Array.from({length:expected.length},()=>({answer:'O',note:''})),input={siteId:1,type:'checklist',title:'가상 점검',date:'2026-10-30',details:{kind:name,answers}};
    for(let i=0;i<expected.length;i++){
      assert.equal(rows[i].includes('해당없음'),expected[i],name+' '+i);
      const trial={...input,details:{...input.details,answers:answers.map((row,j)=>j===i?{...row,answer:'해당없음'}:row)}};
      if(expected[i])assert.doesNotThrow(()=>recordInput(trial));else assert.throws(()=>recordInput(trial),/답변/);
    }
  }
});
