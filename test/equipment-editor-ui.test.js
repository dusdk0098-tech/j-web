import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),section=source.indexOf("  if(state.page==='equipment'){"),begin=source.indexOf('    const edit=item=>{',section),end=source.indexOf("    $('#new-equipment').onclick=",begin);
assert.ok(begin>section&&end>begin);
// shortcut: 입력 폼의 주요 DOM만 모사하며 실제 브라우저 배치는 별도 확인이 필요하다.
function screen(item=null){
 let markup,submit,scope;const requests=[],state={active:true},controls=[{disabled:false},{disabled:false},{disabled:true}],kind={value:item?.kind||'',addEventListener(_name,fn){this.input=fn;}},alias={value:item?JSON.parse(item.details).alias||'':''},rows={children:[],insertAdjacentHTML(){const fields={'[data-extra-label]':{value:''},'[data-extra-value]':{value:''},'[data-remove]':{}};const row={querySelector:key=>fields[key]};this.children.push(row);this.lastElementChild=row;}},add={click(){this.onclick();}},error={textContent:''},form={querySelectorAll:()=>rows.children},body={querySelectorAll:()=>controls},nodes={'#dialog-form [name=kind]':kind,'#dialog-form [name=alias]':alias,'#equipment-extra-rows':rows,'#equipment-extra-add':add,'#dialog-error':error,'#dialog-form':form,'#dialog-body':body};
 const field=(name,label,value)=>'<label>'+label+'<input name="'+name+'" value="'+String(value??'')+'"></label>',context={current:()=>state.active,siteId:1,field,$:key=>nodes[key],showDialog:(_title,html,handler,active)=>{markup=html;submit=handler;scope=active;},api:(url,options,active)=>new Promise((resolve,reject)=>requests.push({url,options,active,resolve,reject}))};
 runInNewContext(source.slice(begin,end)+';globalThis.edit=edit;',context);context.edit(item);return {kind,alias,rows,add,error,form,controls,requests,state,markup,submit,scope};
}
test('장비 종류는 빈 별칭을 채우고 직접 바꾼 별칭은 유지한다',()=>{
 const ui=screen();assert.match(ui.markup,/name="alias"/);ui.kind.value='굴착기';ui.kind.input();assert.equal(ui.alias.value,'굴착기');ui.kind.value='덤프트럭';ui.kind.input();assert.equal(ui.alias.value,'덤프트럭');ui.alias.value='현장 별칭';ui.kind.value='크레인';ui.kind.input();assert.equal(ui.alias.value,'현장 별칭');
});
test('장비 추가정보를 불러오고 저장 중 입력을 보호하며 실패 시 보존한다',async()=>{
 const item={id:7,kind:'굴착기',model:'가상',capacity:'',manufacturer:'',registration:'',details:JSON.stringify({alias:'별칭',additional:[{label:'항목',value:'내용'}]})},ui=screen(item);assert.equal(ui.rows.children.length,1);assert.equal(ui.rows.children[0].querySelector('[data-extra-label]').value,'항목');
 const saving=ui.submit({kind:'굴착기',alias:'별칭',model:'가상'}),request=ui.requests[0],body=JSON.parse(request.options.body);assert.equal(body.additional[0].value,'내용');assert.equal(body.expected.details,item.details);assert.deepEqual(ui.controls.map(x=>x.disabled),[true,true,true]);request.reject(Error('가상 충돌'));await assert.rejects(saving,/가상 충돌/);assert.deepEqual(ui.controls.map(x=>x.disabled),[false,false,true]);assert.equal(ui.rows.children[0].querySelector('[data-extra-value]').value,'내용');ui.state.active=false;assert.equal(ui.scope(),false);
 for(let i=1;i<20;i++)ui.add.click();ui.add.click();assert.equal(ui.rows.children.length,20);assert.match(ui.error.textContent,/20개/);
});
