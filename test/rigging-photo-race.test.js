import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(){
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('    let riggingPhotoRequest=0;'),end=source.indexOf("    $('#new-rigging').onclick=",start);
  assert.ok(start>=0&&end>start);
  const pending=[],errors=[],add={disabled:false},remove={disabled:false,dataset:{removeRiggingPhoto:'7'}},input={files:[{name:'가상.png',size:10}]};
  const panel={isConnected:true,innerHTML:'',querySelector:key=>key==='#rigging-photo-add'?add:input,querySelectorAll:()=>[remove]};
  const state={page:'rigging',siteId:1,admin:{id:1}};
  const context={state,siteId:1,detailEpoch:1,riggingPhotoAdmin:state.admin,riggingPhotoEpoch:1,items:[{id:1,name:'가상 A'},{id:2,name:'가상 B'}],$:()=>panel,esc:String,confirm:()=>true,showError:error=>errors.push(error.message),api:(path,options)=>{const d=deferred();pending.push({path,options,...d});return d.promise;},fetch:()=>{const d=deferred();pending.push({upload:true,...d});return d.promise;},encodeURIComponent};
  runInNewContext(source.slice(start,end)+'\nglobalThis.showRiggingPhotos=showRiggingPhotos;',context);
  return {context,panel,state,pending,errors,add,remove};
}
test('장구 사진 조회는 다른 장구와 현장으로 이동한 뒤 응답을 표시하지 않는다',async()=>{
  const h=harness(),a=h.context.showRiggingPhotos(1),b=h.context.showRiggingPhotos(2);
  h.pending[1].resolve([]);await b;assert.match(h.panel.innerHTML,/가상 B/);
  h.pending[0].resolve([]);await a;assert.match(h.panel.innerHTML,/가상 B/);
  const late=h.context.showRiggingPhotos(1);h.state.siteId=2;h.pending[2].reject(Error('오래된 오류'));await late;
  assert.match(h.panel.innerHTML,/가상 B/);assert.deepEqual(h.errors,[]);
});
test('사진 올리기와 삭제는 중복 요청 및 이탈 후 갱신을 막는다',async()=>{
  const h=harness(),load=h.context.showRiggingPhotos(1);h.pending[0].resolve([]);await load;
  const upload=h.add.onclick({currentTarget:h.add});await h.add.onclick({currentTarget:h.add});assert.equal(h.pending.filter(x=>x.upload).length,1);
  h.state.page='dashboard';h.pending[1].resolve({ok:true,json:async()=>({})});await upload;assert.equal(h.pending.length,2);assert.equal(h.add.disabled,false);
  h.state.page='rigging';h.context.detailEpoch=2;await h.remove.onclick();assert.equal(h.pending.length,2);
});
test('사진 삭제는 한 번만 전송하고 이탈한 화면을 다시 열지 않는다',async()=>{
  const h=harness(),load=h.context.showRiggingPhotos(1);h.pending[0].resolve([{id:7,name:'가상.png',size:10}]);await load;
  const deleting=h.remove.onclick();await h.remove.onclick();assert.equal(h.pending.length,2);assert.equal(h.pending[1].options.method,'DELETE');
  h.panel.isConnected=false;h.pending[1].resolve({});await deleting;assert.equal(h.pending.length,2);assert.equal(h.remove.disabled,false);assert.deepEqual(h.errors,[]);
});
test('장구 목록 조회 중 현장이나 화면을 바꾸면 이전 목록을 표시하지 않는다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf("  if(state.page==='rigging'){"),end=source.indexOf("  if(state.page==='work-places'){",start);assert.ok(start>=0&&end>start);
  for(const change of ['site','page','generation']){
    const waiting=deferred(),state={page:'rigging',siteId:1,admin:{}},content={innerHTML:'before'},context={state,detailEpoch:1,content,api:()=>waiting.promise};
    const result=runInNewContext(`(async()=>{${source.slice(start,end)}})()`,context);
    if(change==='site')state.siteId=2;else if(change==='page')state.page='dashboard';else context.detailEpoch=2;
    waiting.resolve([]);await result;assert.equal(content.innerHTML,'before');
  }
});
