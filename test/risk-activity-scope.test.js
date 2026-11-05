import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(part,delayed){
 const state={admin:{id:1},siteId:7,detail:3,page:'documents'},doc={id:3,site_id:7},epoch={value:1},ctx={state,doc,currentDetail:()=>epoch.value===1&&state.siteId===7&&state.detail===3&&state.page==='documents',calls:[],marked:false};
 ctx.api=async(path,options,scope)=>{ctx.calls.push({path,scope});if(path.includes(part==='activities'?'risk-activities':'/photos'))return delayed.promise;return [];};
 let code;if(part==='activities'){const start=source.indexOf('    const riskAdmin=state.admin,riskCurrent='),end=source.indexOf("    content.insertAdjacentHTML('beforeend'",start);assert.ok(start>=0&&end>start);code=source.slice(start,end);}else{const start=source.indexOf('    let photoLists;try{'),end=source.indexOf('    for(const [i,a] of activities.entries())',start);assert.ok(start>=0&&end>start);ctx.activities=[{id:1}];ctx.riskCurrent=()=>ctx.currentDetail()&&state.admin===ctx.initialAdmin;ctx.initialAdmin=state.admin;code=source.slice(start,end);}
 return {state,epoch,ctx,run:()=>runInNewContext(`(async()=>{${code} marked=true;})()`,ctx)};
}
for(const part of ['activities','photos'])test(`${part} 지연 응답·오류는 현장·계정·문서·세대 변경 후 무시된다`,async()=>{
 for(const change of ['site','account','document','page','epoch'])for(const outcome of ['success','error']){const d=defer(),ui=setup(part,d),pending=ui.run();if(change==='site')ui.state.siteId=9;if(change==='account')ui.state.admin={id:2};if(change==='document')ui.state.detail=4;if(change==='page')ui.state.page='workers';if(change==='epoch')ui.epoch.value++;assert.equal(ui.ctx.calls[0].scope(),false);if(outcome==='success')d.resolve([]);else d.reject(Error('지연 오류'));await pending;assert.equal(ui.ctx.marked,false,`${part} ${change} ${outcome}`);}
 const d=defer(),ui=setup(part,d),pending=ui.run();d.resolve([]);await pending;assert.equal(ui.ctx.marked,true);const error=defer(),live=setup(part,error),rejected=live.run();error.reject(Error('현재 오류'));await assert.rejects(rejected,/현재 오류/);
});

test('첨부 전송 중 화면이 바뀌면 늦은 성공과 오류가 다른 화면을 바꾸지 않는다',async()=>{
 const line=source.split('\n').find(value=>value.includes("article.querySelector('[data-add-risk-photo]').onclick="));assert.ok(line);
 for(const outcome of ['success','error']){const d=defer(),button={},file={size:4,name:'가상.png'},inputs={"[data-add-risk-photo]":button,'input[type=file]':{files:[file]},'[data-risk-purpose]':{value:'photo'}},article={querySelector:key=>inputs[key]},state={active:true},seen={fetch:0,render:0,error:0},ctx={article,base:'/virtual',a:{revision:'v1'},riskCurrent:()=>state.active,fetch:()=>{seen.fetch++;return d.promise;},render:()=>{seen.render++;},showError:()=>{seen.error++;},encodeURIComponent};runInNewContext(line,ctx);const pending=button.onclick();state.active=false;if(outcome==='success')d.resolve({ok:true,json:async()=>({id:1})});else d.reject(Error('늦은 오류'));await pending;assert.equal(seen.fetch,1);assert.equal(seen.render,0);assert.equal(seen.error,0);await button.onclick();assert.equal(seen.fetch,1);}
});

test('첨부 삭제 확인 중 화면이 바뀌면 삭제 요청을 보내지 않는다',async()=>{
 const line=source.split('\n').find(value=>value.includes("article.querySelectorAll('[data-delete-risk-photo]')"));assert.ok(line);const button={dataset:{deleteRiskPhoto:'5'}},article={querySelectorAll:()=>[button]},state={active:true},seen={api:0};runInNewContext(line,{article,state,a:{revision:'v1'},base:'/virtual',riskCurrent:()=>state.active,confirm:()=>{state.active=false;return true;},api:()=>{seen.api++;},render(){},showError(){}});await button.onclick();assert.equal(seen.api,0);
});

test('활동 저장 요청 후 화면이 바뀌면 이전 대화상자가 새 화면을 갱신하지 않는다',async()=>{
 const dialogCode=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick")),handler=source.split('\n').find(line=>line.includes('const editActivity='));assert.ok(dialogCode&&handler);
 const d=defer(),form={},submit={},nodes={'#dialog-title':{},'#dialog-body':{},'#dialog-error':{},'#dialog-form':form,'#dialog-form button[type=submit]':submit},dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},state={active:true,detail:3,siteId:7},seen={render:0,flash:0},ctx={state,dialog,doc:{id:3,site_id:7},riskCurrent:()=>state.active,riskWorkers:[],riskReviewers:[],kinds:{meeting:'회의'},esc:String,field:()=>'',today:()=>'',document:{querySelectorAll:()=>[]},$:key=>nodes[key],FormData:class{constructor(){return [['kind','meeting'],['date','2026-11-03']];}},api:()=>d.promise,render:()=>seen.render++,flash:()=>seen.flash++};
 runInNewContext(dialogCode+'\n'+handler+'\neditActivity({id:1,revision:"v1",kind:"meeting",date:"2026-11-03"})',ctx);const pending=form.onsubmit({preventDefault(){},currentTarget:form});state.active=false;d.resolve({ok:true});await pending;assert.equal(seen.render,0);assert.equal(seen.flash,0);assert.equal(dialog.open,true);
});
