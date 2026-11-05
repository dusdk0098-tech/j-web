import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/review.js',import.meta.url),'utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const wrapper=part('function openReviewerDetail(', '\nasync function renderEquipmentQueue(');
const equipment=part('async function openEquipmentCheck(', '\nasync function openReference(');
const reference=part('async function openReference(', '\nfunction reviewEvents(');
const documentView=part('async function openDocument(', '\nlogin.onsubmit=');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function screen(){
 const requests=[],detail={hidden:true,dataset:{},innerHTML:''},main={hidden:false},message={textContent:''};
 const context={detail,main,message,reviewDetailEpoch:0,refreshEpoch:1,api:path=>{const pending=deferred();requests.push({path,...pending});return pending.promise;},esc:String,displayDocumentDetails:()=>'',planLinks:()=>''};
 runInNewContext(`${wrapper}\n${equipment}\n${reference}\n${documentView}`,context);
 return {context,detail,main,message,requests,open:(name,id)=>context.openReviewerDetail(context[name],id)};
}
const response=title=>({document:{title,date:'2026-01-01',type:'notice',body:''},attachments:[],linked:null,frozen:true});
test('늦은 상세 조회와 오류는 마지막으로 선택한 참조 문서를 덮지 않는다',async()=>{
 for(const previous of ['openReference','openDocument','openEquipmentCheck'])for(const failure of [false,true]){
  const ui=screen(),old=ui.open(previous,1),latest=ui.open('openReference',2);
  ui.requests[1].resolve(response('최근 문서'));await latest;
  if(failure)ui.requests[0].reject(Error('이전 오류'));else ui.requests[0].resolve({});
  await old;assert.equal(ui.detail.dataset.doc,'reference:2');assert.match(ui.detail.innerHTML,/최근 문서/);assert.equal(ui.message.textContent,'');
 }
});
test('현재 상세 오류는 표시하고 갱신이나 로그아웃 후 늦은 응답은 무시한다',async()=>{
 const ui=screen(),failed=ui.open('openReference',1);ui.requests[0].reject(Error('조회 오류'));await failed;assert.equal(ui.message.textContent,'조회 오류');
 for(const change of [x=>x.context.refreshEpoch++,x=>x.context.reviewDetailEpoch++,x=>x.main.hidden=true]){
  const next=screen(),pending=next.open('openReference',1);change(next);next.requests[0].resolve(response('오래된 문서'));await pending;assert.equal(next.detail.hidden,true);
 }
});
test('목록 갱신 중 새 상세를 열면 갱신이 상세를 숨기지 않는다',async()=>{
 const start=source.indexOf('async function refresh(){'),end=source.indexOf('list.innerHTML=',start);assert.ok(start>=0&&end>start);
 for(const navigate of [false,true]){
  const pending=deferred(),detail={hidden:false},context={detail,main:{hidden:false},login:{hidden:false},message:{textContent:'기존'},refreshEpoch:0,reviewDetailEpoch:0,bindReviewerSession(){},api:path=>path.endsWith('/references')?pending.promise:Promise.resolve(path.endsWith('/session')?{context:{}}:[])};
  runInNewContext(source.slice(start,end)+'}',context);const refresh=context.refresh();await new Promise(resolve=>setImmediate(resolve));
  if(navigate)context.reviewDetailEpoch++;pending.resolve([]);await refresh;assert.equal(detail.hidden,!navigate);assert.equal(context.message.textContent,navigate?'기존':'');
 }
});
