import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
// shortcut: 실제 핸들러를 가상 DOM과 FileReader로 실행하며 화면 배치는 별도 브라우저 검증 대상이다.
function screen(kind,photo=true){
  const button={disabled:false},status={textContent:''},panel={isConnected:true},logout={disabled:false},requests=[],readers=[],reportContext={workerId:1,siteId:1,generation:'A'},fields=kind==='stop'?{place:'가상 장소',reason:'가상 사유',anonymous:'true'}:{title:'가상 제목',body:'가상 내용'};
  const form={elements:{photo:{files:photo?[{size:10,type:'image/png'}]:[]}},querySelector:()=>button,resets:0,reset(){this.resets++;}},context={panel,logout,dayStopped:false,siteKey:'site',workerSiteKey:'site',reportContext,[kind+'Form']:form,[kind+'Status']:status,loadHazards:async()=>{},FormData:class{constructor(){return Object.entries(fields);}},FileReader:class{constructor(){readers.push(this);}readAsDataURL(){}},fetch:async(url,options)=>{requests.push({url,data:JSON.parse(options.body)});return {ok:context.accept,status:context.accept?201:409,json:async()=>({error:'로그인 계정 또는 현장 세션이 변경되었습니다. 입력 내용을 복사한 뒤 다시 로그인해 주세요.'})};},accept:true};
  const helper=source.slice(source.indexOf('    const reportActive='),source.indexOf('    stopForm.onsubmit='));runInNewContext(helper+source.split('\n').find(line=>line.startsWith('    '+kind+'Form.onsubmit=')),context);
  return {context,button,status,panel,logout,requests,readers,form,fields,submit:()=>form.onsubmit({preventDefault(){}}),finish(){readers[0].result='data:image/png;base64,iVBORw0KGgo=';readers[0].onload();}};
}

test('위험신고 저장 후 목록 조회에 실패해도 저장 성공을 안내한다',async()=>{const ui=screen('hazard',false);ui.context.loadHazards=async()=>{throw Error('목록 조회 실패');};await ui.submit();assert.equal(ui.requests.length,1);assert.equal(ui.form.resets,1);assert.match(ui.status.textContent,/저장했습니다/);assert.match(ui.status.textContent,/목록.*확인/);});
for(const kind of ['stop','hazard']){
  for(const change of ['detach','logout','stopped','site'])test(kind+' 사진 읽기 중 '+change+' 변경은 POST 없이 입력을 보존한다',async()=>{const ui=screen(kind),pending=ui.submit();assert.equal(ui.readers.length,1);if(change==='detach')ui.panel.isConnected=false;if(change==='logout')ui.logout.disabled=true;if(change==='stopped')ui.context.dayStopped=true;if(change==='site')ui.context.siteKey='other';ui.finish();await pending;assert.equal(ui.requests.length,0);assert.equal(ui.form.resets,0);assert.match(ui.status.textContent,/입력 내용을 복사/);assert.equal(ui.button.disabled,false);});
  test(kind+' 다른 탭 계정 전환은 기존 작성 세션으로 전송하고 서버 거절 시 입력을 보존한다',async()=>{const ui=screen(kind),pending=ui.submit();ui.context.accept=false;ui.finish();await pending;assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].data.reportContext.generation,'A');assert.equal(ui.form.resets,0);assert.match(ui.status.textContent,/입력 내용을 복사/);});
  for(const photo of [true,false])test(kind+' 정상 저장 '+(photo?'사진':'사진 없음'),async()=>{const ui=screen(kind,photo),pending=ui.submit();if(photo)ui.finish();await pending;assert.equal(ui.requests.length,1);assert.equal(ui.form.resets,1);assert.equal(ui.requests[0].data.reportContext.workerId,1);assert.equal(!!ui.requests[0].data.photo,photo);});
  test(kind+' 중복 전송 방지',async()=>{const ui=screen(kind),first=ui.submit();await ui.submit();assert.equal(ui.readers.length,1);ui.finish();await first;assert.equal(ui.requests.length,1);});
  for(const change of ['text','photo'])test(kind+' 전송 중 새 '+change+' 입력은 성공 후에도 보존한다',async()=>{const ui=screen(kind,false);let release;const gate=new Promise(resolve=>{release=resolve;});ui.context.fetch=async(url,options)=>{ui.requests.push({url,data:JSON.parse(options.body)});await gate;return {ok:true,status:201,json:async()=>({})};};const pending=ui.submit();if(change==='text')ui.fields[kind==='stop'?'reason':'body']='새 가상 입력';else ui.form.elements.photo.files=[{size:10,type:'image/png'}];release();await pending;assert.equal(ui.form.resets,0);assert.match(ui.status.textContent,/새 입력.*유지/);assert.equal(ui.button.disabled,false);});
}
