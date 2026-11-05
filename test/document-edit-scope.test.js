import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function editDocument('),end=source.indexOf('  const permitCompanies=',start);
const loadCode=source.slice(start,end)+"  return 'opened';\n}\neditDocument";
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('문서 편집 초기 조회는 계정·화면 전환 뒤 결과와 오류를 적용하지 않는다',async()=>{
 for(const mode of ['initial','office','plan','signature'])for(const change of ['account','page','epoch']){
  const state={siteId:1,page:'documents',admin:{id:1},types:{office:'업무',work_plan:'계획',notice:'공지'}},wait=deferred(),errors=[],calls=[];
  const type=mode==='office'||mode==='signature'?'office':mode==='plan'?'work_plan':'notice',doc=mode==='plan'||mode==='signature'?{id:2,type,details:'{}'}:null;
  const matches=path=>mode==='initial'?path.startsWith('/api/companies?'):mode==='office'?path.startsWith('/api/reviewers?'):mode==='plan'?path.endsWith('/attachments'):path.endsWith('/meeting-signature');
  const context={state,detailEpoch:4,URLSearchParams,esc:x=>x,showError:e=>errors.push(e.message),api:async(path,_options,current)=>{calls.push(path);const result=matches(path)?await wait.promise:[];return current()?result:undefined;}};
  const open=runInNewContext(loadCode,context),opening=open(doc,{},type);for(let i=0;i<10&&!calls.some(matches);i++)await Promise.resolve();assert.ok(calls.some(matches),mode);
  if(change==='account')state.admin={id:2};else if(change==='page')state.page='other';else context.detailEpoch++;
  wait.resolve([]);assert.equal(await opening,undefined,`${mode}/${change}`);assert.deepEqual(errors,[]);
 }
});
