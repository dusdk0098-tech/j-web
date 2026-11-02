import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('허가 점검·연장 UI는 조회 버전을 전달하고 충돌 시 입력과 새 서명을 보존한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const section=source.slice(source.indexOf('    const [checks,extensions]=await Promise.all'),source.indexOf("  if(doc.type==='instruction'",source.indexOf('    const [checks,extensions]=await Promise.all'))).replace(/\n  }\n$/,'');
  const dialogs=source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close').onclick"));
  const calls=[],nodes=new Map(),buttons=new Map(),checks=[{id:1,date:'2026-11-02',version:'a'.repeat(64),items:[{name:'가상 점검',result:'fail',action:'보완'}]}],extensions=[{id:2,date_from:'2026-11-02',date_to:'2026-11-03',time_from:'',time_to:'',version:'b'.repeat(64)}];let markup='',drawing=0;
  const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',disabled:false,hidden:false,textContent:'',innerHTML:'',querySelector:node,querySelectorAll:()=>[],insertAdjacentHTML(){},getContext:()=>({beginPath(){},moveTo(){},lineTo(){},stroke(){drawing++;},clearRect(){drawing=0;}}),getBoundingClientRect:()=>({left:0,top:0,width:320,height:120}),setPointerCapture(){},width:320,height:120,toDataURL:()=>`data:image/png;base64,drawn${drawing}`});return nodes.get(key);};
  const document={querySelectorAll:key=>{const data=key.includes('extension')?'PermitExtension':'PermitCheck',id=data==='PermitExtension'?2:1,property=(key.includes('delete')?'delete':'edit')+data;if(!buttons.has(key))buttons.set(key,[{dataset:{[property]:String(id)}}]);return buttons.get(key);}};
  const form=node('#dialog-form'),submit=node('#dialog-form button[type=submit]'),dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const context={document,$:node,dialog,content:{insertAdjacentHTML:(_,html)=>{markup+=html;}},doc:{id:4},currentDetail:()=>true,today:()=>'',esc:String,field:()=>'',encodeURIComponent,confirm:()=>true,flash(){},render:async()=>{},showError(){},FormData:class{constructor(){return [['date','2026-11-04'],['dateFrom','2026-11-04'],['dateTo','2026-11-05']];}},api:async(path,options)=>{if(!options)return path.endsWith('permit-checks')?checks:extensions;calls.push({path,options});throw Error('버전 충돌');}};
  runInNewContext(dialogs+'\nasync function mount(){'+section+'}\nglobalThis.mount=mount;',context);await context.mount();
  assert.match(markup,new RegExp('signature\\?expectedVersion='+extensions[0].version));
  buttons.get('[data-edit-permit-check]')[0].onclick();
  const row={querySelector:key=>({value:key==='[data-check-result]'?'fail':key==='[data-check-name]'?'입력 유지':'조치 유지'})};node('#permit-check-rows').querySelectorAll=()=>[row];
  await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(JSON.parse(calls.at(-1).options.body).expectedVersion,checks[0].version);assert.equal(JSON.parse(calls.at(-1).options.body).items[0].name,'입력 유지');assert.equal(dialog.open,true);assert.equal(node('#dialog-error').textContent,'버전 충돌');assert.equal(submit.disabled,false);
  buttons.get('[data-edit-permit-extension]')[0].onclick();const canvas=node('#permit-extension-signature');canvas.onpointerdown({preventDefault(){},clientX:10,clientY:10,pointerId:1});const before=canvas.toDataURL();
  await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(JSON.parse(calls.at(-1).options.body).expectedVersion,extensions[0].version);assert.equal(JSON.parse(calls.at(-1).options.body).signature,before);assert.equal(canvas.toDataURL(),before);assert.equal(dialog.open,true);assert.equal(node('#dialog-error').textContent,'버전 충돌');
  for(const [selector,version] of [['[data-delete-permit-check]',checks[0].version],['[data-delete-permit-extension]',extensions[0].version]]){await buttons.get(selector)[0].onclick();assert.equal(calls.at(-1).options.method,'DELETE');assert.equal(JSON.parse(calls.at(-1).options.body).expectedVersion,version);}
});
