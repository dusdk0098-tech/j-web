import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistSources,mergeChecklistAnswers,checklistCategoryForKind} from '../public/checklist-copy.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('이전 점검은 같은 현장·종류·날짜 범위만 선택한다',()=>{
  const row=(id,site_id,kind,date,type='checklist')=>({id,site_id,type,date,title:'가상 점검',details:JSON.stringify({kind,answers:[{answer:'O',note:'가상'}],photoNote:'가상 사진'})});
  const rows=[row(1,7,'wind','2026-10-29'),row(2,8,'wind','2026-10-29'),row(3,7,'rain','2026-10-29'),row(4,7,'wind','2026-11-01'),row(5,7,'wind','2026-10-29','notice'),row(6,7,'wind','2026-10-30'),{...row(7,7,'wind','2026-10-29'),details:'invalid'}];
  const found=checklistSources(rows,7,'wind','2026-10-30',6);assert.deepEqual(found.map(item=>item.id),[1]);assert.equal(found[0].photoNote,'가상 사진');
  assert.throws(()=>checklistSources(null,7,'wind','2026-10-30'),/목록/);
});

test('이전 점검 적용은 빈 입력만 채우고 오류 시 기존 입력을 바꾸지 않는다',()=>{
  const current=[{answer:'X',note:''},{answer:'',note:'입력 비고'},{answer:null,note:''}],previous=[{answer:'O',note:'이전 비고'},{answer:'O',note:'이전 값'},{answer:'',note:'사진 설명'}];
  assert.deepEqual(mergeChecklistAnswers(current,previous),[{answer:'X',note:'이전 비고'},{answer:'O',note:'입력 비고'},{answer:null,note:'사진 설명'}]);
  assert.deepEqual(current,[{answer:'X',note:''},{answer:'',note:'입력 비고'},{answer:null,note:''}]);
  assert.throws(()=>mergeChecklistAnswers(current,previous.slice(1)),/항목/);assert.throws(()=>mergeChecklistAnswers(current,[previous[0],{},previous[2]]),/항목/);
});

test('작성 화면은 이전 기록을 선택해 빈 칸에 적용하고 현장이 바뀌면 차단한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    if(select.value==='checklist'){"),end=source.indexOf("    if(select.value==='safety_log'){",start);
  assert.ok(start>=0&&end>start);
  const kind={value:'wind',options:[]},copyButton={},copyList={isConnected:true,textContent:'',innerHTML:''},photoNote={value:''},date={value:'2026-10-30'};
  const firstAnswer={value:'X'},firstNote={value:''},secondAnswer={value:''},secondNote={value:'현재 비고'},rows=[{querySelector:key=>key==='[data-answer]'?firstAnswer:firstNote},{querySelector:key=>key==='[data-answer]'?secondAnswer:secondNote}];
  const nodes={'#daily-fields':{innerHTML:''},'#dialog-form [name=checklistKind]':kind,'#rain-checks':{innerHTML:''},'#checklist-category':{value:''},'#checklist-search':{value:''},'#checklist-copy':copyButton,'#checklist-copy-list':copyList,'#wind-photo-note':photoNote,'#dialog-form input[name=date]':date};
  const calls=[],state={siteId:7,page:'documents'},prior={id:5,site_id:7,type:'checklist',date:'2026-10-29',title:'<가상>',details:JSON.stringify({kind:'wind',answers:[{answer:'O',note:'이전 비고'},{answer:'O',note:'이전 설명'}],photoNote:'이전 사진 설명'})};
  const context={select:{value:'checklist'},details:{kind:'wind',answers:[]},$:key=>nodes[key],document:{querySelectorAll:()=>rows},esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'),filterChecklistKinds(){},checklistSources,mergeChecklistAnswers,checklistCategoryForKind,siteId:7,state,dialog:{open:true},doc:{id:10},URLSearchParams,api:async path=>{calls.push(path);return [prior];}};
  for(const name of ['rainChecks','rainDetailChecks','windChecks','thawChecks','heatChecks','coldChecks','wetSeasonChecks','heavyRainChecks','electricalChecks','fireChecks','formworkChecks','fallingChecks','confinedChecks','excavationChecks','semiannualChecks','morningChecks','afternoonChecks','eveningChecks'])context[name]=name==='windChecks'?['가상 1','가상 2']:[];
  runInNewContext('function render(){'+source.slice(start,end)+'}\nglobalThis.render=render;',context);context.render();await copyButton.onclick();
  assert.match(calls[0],/siteId=7&type=checklist&to=2026-10-30/);assert.match(copyList.innerHTML,/&lt;가상&gt;/);assert.doesNotMatch(copyList.innerHTML,/<가상>/);
  const target={matches:selector=>selector==='[data-checklist-copy]',dataset:{checklistCopy:'0'}};copyList.onclick({target});
  assert.equal(firstAnswer.value,'X');assert.equal(firstNote.value,'이전 비고');assert.equal(secondAnswer.value,'O');assert.equal(secondNote.value,'현재 비고');assert.equal(photoNote.value,'이전 사진 설명');
  await copyButton.onclick();state.siteId=8;firstAnswer.value='';copyList.onclick({target});assert.equal(firstAnswer.value,'');assert.match(copyList.textContent,/변경/);
});

test('서버가 이전 점검 모듈을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-checklist-')),reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 시작되지 않았습니다.');})]);
    const response=await fetch(`http://127.0.0.1:${port}/checklist-copy.js`);
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/export function checklistSources/);
  }finally{
    if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}
    rmSync(dir,{recursive:true,force:true});
  }
});
