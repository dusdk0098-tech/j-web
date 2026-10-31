import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
  const start=source.indexOf('let managedGeneration=0;'),end=source.indexOf("section.querySelector('button').onclick=loadManaged",start);
  assert.ok(start>=0&&end>start);
  const date={value:'2026-11-01'},list={textContent:'',children:[],replaceChildren(){this.children=[];this.textContent='';},append(item){this.children.push(item);}},panel={isConnected:true},pending=[];
  const document={createElement(){return {children:[],append(...items){this.children.push(...items);}};}};
  const fetch=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
  const load=runInNewContext(`${source.slice(start,end)};loadManaged`,{date,list,panel,document,fetch,encodeURIComponent,Error,JSON});
  const reply=(request,rows,ok=true)=>request.resolve({ok,json:async()=>rows});
  return {date,list,panel,pending,load,reply};
}

test('출역 조회는 최신 요청만 표시하고 날짜 변경 시 목록을 지운다',async()=>{
  const {date,list,pending,load,reply}=setup(),first=load(),second=load();
  reply(pending[1],[{id:2,name:'최신',company:'가상',present:false}]);await second;
  reply(pending[0],[{id:1,name:'이전',company:'가상',present:false}]);await first;
  assert.match(list.children[0].children[0].textContent,/최신/);
  const third=load();date.value='2026-11-02';date.onchange();date.value='2026-11-01';date.onchange();
  reply(pending[2],{error:'이전 오류'},false);await third;
  assert.equal(list.children.length,0);assert.match(list.textContent,/조회/);
});

test('출역 변경이 실패하면 다시 시도할 수 있다',async()=>{
  const {list,pending,load,reply}=setup(),query=load();
  reply(pending[0],[{id:2,name:'가상',company:'가상',present:false}]);await query;
  const button=list.children[0].children[1],action=button.onclick();assert.equal(button.disabled,true);
  reply(pending[1],{error:'시험 오류'},false);await action;
  assert.equal(button.disabled,false);assert.match(list.children[0].children[0].textContent,/시험 오류/);
});
