import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {restaurantPrice} from '../public/restaurant-price.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf("  if(state.page==='restaurants'){");
const end=source.indexOf('    const edit=r=>{',start);
assert.ok(start>=0&&end>start);
// shortcut: 설정 폼과 비동기 요청만 모사하며 실제 브라우저 배치는 별도 확인이 필요하다.
function screen(){
 const requests=[],messages=[],actor={},state={page:'restaurants',siteId:1,admin:actor},content={innerHTML:'원래 화면',querySelector:()=>({textContent:''}),insertAdjacentHTML(){}},forms={};
 const makeForm=()=>{const controls=[{disabled:false},{disabled:false},{disabled:true}],form={controls,values:{breakfast:'7'},querySelector:()=>controls[1],querySelectorAll:()=>controls};return form;};
 forms['#meal-defaults']=makeForm();forms['#manager-meal-defaults']=makeForm();
 const context={state,content,detailEpoch:3,renderEpoch:3,esc:String,$:selector=>forms[selector],FormData:class{constructor(form){this.form=form;}get(name){return this.form.values[name];}},api:(url,options,scope)=>new Promise((resolve,reject)=>requests.push({url,options,scope,resolve,reject})),flash:value=>messages.push(value),showError:error=>messages.push(error.message),render:async()=>messages.push('render')};
 runInNewContext('globalThis.run=async()=>{'+source.slice(start,end)+'}};',context);
 const open=()=>context.run(),load=async()=>{const work=open();requests[0].resolve([{id:7,name:'가상',meal_price:1,snack_price:1,tax:0}]);requests[1].resolve([]);requests[2].resolve([]);await work;};
 return {context,state,content,forms,requests,messages,open,load};
}
test('이전 현장의 늦은 식당 설정 조회는 다른 화면을 바꾸지 않는다',async()=>{
 for(const change of ['site','page','actor','epoch']){const ui=screen(),pending=ui.open();if(change==='site')ui.state.siteId=2;if(change==='page')ui.state.page='workers';if(change==='actor')ui.state.admin={};if(change==='epoch')ui.context.detailEpoch++;for(const r of ui.requests)r.resolve([]);await pending;assert.equal(ui.content.innerHTML,'원래 화면');assert.equal(ui.forms['#meal-defaults'].onsubmit,undefined);}
});
test('이전 현장의 조회 오류는 무시하고 현재 현장의 오류는 전달한다',async()=>{
 const old=screen(),pending=old.open();old.state.siteId=2;old.requests[0].reject(Error('이전 오류'));await pending;assert.equal(old.content.innerHTML,'원래 화면');
 const current=screen(),failed=current.open();current.requests[0].reject(Error('현재 오류'));await assert.rejects(failed,/현재 오류/);
});
for(const group of ['','manager'])test(`${group||'worker'} 식대 설정은 저장 중 선택을 잠그고 실패 시 복원한다`,async()=>{
 const ui=screen();await ui.load();const form=ui.forms[group?'#manager-meal-defaults':'#meal-defaults'],pending=form.onsubmit({preventDefault(){},currentTarget:form});const request=ui.requests.at(-1),body=JSON.parse(request.options.body);assert.equal(body.siteId,1);assert.equal(body.group,group||undefined);assert.equal(body.items[0].kind,'breakfast');assert.equal(body.items[0].restaurantId,'7');assert.deepEqual(form.controls.map(c=>c.disabled),[true,true,true]);await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(ui.requests.length,4);request.reject(Error('저장 실패'));await pending;assert.deepEqual(form.controls.map(c=>c.disabled),[false,false,true]);assert.deepEqual(ui.messages,['저장 실패']);
});
test('저장 중 현장 전환 뒤 결과는 새 화면을 다시 그리지 않는다',async()=>{
 const ui=screen();await ui.load();const form=ui.forms['#meal-defaults'],pending=form.onsubmit({preventDefault(){},currentTarget:form}),request=ui.requests.at(-1);ui.state.siteId=2;assert.equal(request.scope(),false);request.resolve({});await pending;assert.deepEqual(ui.messages,[]);assert.deepEqual(form.controls.map(c=>c.disabled),[false,false,true]);await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(ui.requests.length,4);
});

test('식당 작성에서 간식 부가세를 별도로 수정하고 단가 변경 시 자동 계산한다',()=>{
 const begin=source.indexOf('    const edit=r=>{',start),end=source.indexOf("    $('#restaurant-add').onclick=",begin);assert.ok(begin>start&&end>begin);
 const nodes=Object.fromEntries(['mealPrice','tax','snackPrice','snackTax'].map(name=>[`#dialog-form [name=${name}]`,{value:name==='snackPrice'?'0':'',addEventListener(_event,fn){this.change=fn;}}]));nodes['#restaurant-total']={textContent:''};nodes['#restaurant-snack-total']={textContent:''};let markup,submit;
 const context={current:()=>true,siteId:1,field:(name,label,value)=>`<label>${label}<input name="${name}" value="${value}"></label>`,showDialog:(_title,html,onSubmit)=>{markup=html;submit=onSubmit;},$:key=>nodes[key],restaurantPrice,api:(_path,options)=>JSON.parse(options.body)};
 runInNewContext(source.slice(begin,end)+';globalThis.edit=edit;',context);context.edit({id:3,name:'가상',meal_price:5000,snack_price:1000,tax:500,snack_tax:90});assert.match(markup,/간식 부가세/);assert.match(markup,/name="snackTax" value="90"/);assert.equal(nodes['#restaurant-snack-total'].textContent,'간식 부가세 미기록');nodes['#dialog-form [name=snackPrice]'].value='1234';nodes['#dialog-form [name=snackPrice]'].change();assert.equal(nodes['#dialog-form [name=snackTax]'].value,'123');assert.match(nodes['#restaurant-snack-total'].textContent,/1,357원/);nodes['#dialog-form [name=snackTax]'].value='200';nodes['#dialog-form [name=snackTax]'].change();assert.match(nodes['#restaurant-snack-total'].textContent,/1,434원/);nodes['#dialog-form [name=snackPrice]'].value='-1';nodes['#dialog-form [name=snackPrice]'].change();assert.match(nodes['#restaurant-snack-total'].textContent,/정수/);assert.equal(submit({snackTax:'123'}).snackTax,'123');
});
