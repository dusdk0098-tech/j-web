import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInContext,createContext} from 'node:vm';
import {officeDraftSignature} from '../public/office-template.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function screen(){
  const control=(value='')=>{const listeners={};return {value,checked:false,isConnected:true,addEventListener(name,fn){(listeners[name]??=[]).push(fn);},emit(name){this['on'+name]?.();for(const fn of listeners[name]||[])fn();},click(){this.emit('click');}};};
  const controls=Object.fromEntries(['#office-edit-sign-enabled','#office-edit-pad','#office-edit-clear','#office-apply-example','[data-rich-toolbar]'].map(key=>[key,control()])),form=control(),referenceSelect=control(''),kind=control('품의서'),referencePreview={isConnected:true};form.elements=Object.fromEntries(['title','date','officeOther'].map(key=>[key,control(key)]));form.querySelector=key=>controls[key];const fields={insertAdjacentHTML(){},querySelector:key=>controls[key]},canvas=controls['#office-edit-pad'];let sequence=0,rich=[];
  const context=createContext({doc:{id:7},fields,officeEditInfo:{line:[{name:'가상 결재자'}],references:[],editSignatureVersion:'가상 버전'},esc:String,$:()=>form,signaturePad:(canvas,clear)=>{canvas.ink=[];canvas.onpointerdown=()=>canvas.ink.push(++sequence);canvas.onpointercancel=()=>{};clear.onclick=()=>canvas.ink=[];return ()=>{if(!canvas.ink.length)throw Error('새 서명 필요');return canvas.ink.join(',');};},officeDraftSignature,officeEditor:{value:()=>rich},referenceSelect,kind,officeReferenceVersion:null,officeReferenceId:0,referenceEpoch:0,referencePreview,dialog:{open:true},state:{siteId:1},siteId:1,documentRichLimits:{},URLSearchParams,richBody:()=>'',api:async()=>({version:'참조 버전',reference:{id:9,title:'가상 참조',date:'',body:'',files:[]}})});
  const start=source.indexOf('      if(doc){\n        fields.insertAdjacentHTML'),end=source.indexOf('      if(!doc){',start);assert.ok(start>0&&end>start);runInContext(source.slice(start,end),context);
  const load=source.split(/\r?\n/).find(line=>line.includes('const loadReference=async()=>{const id=Number(referenceSelect'));assert.ok(load);runInContext(load.replace('const loadReference=','globalThis.loadReference='),context);
  return {context,form,canvas,controls,referenceSelect,setRich:value=>rich=value};
}
test('관리자 수정 서명은 선택 시에만 전송하며 예시·서식·참조 조회 뒤 옛 획을 재사용하지 않는다',async()=>{
  for(const change of ['example','rich','reference']){
    const ui=screen(),{context,canvas,controls}=ui;assert.equal(context.getOfficeEditSignature(),null);controls['#office-edit-sign-enabled'].checked=true;canvas.emit('pointerdown');assert.equal(context.getOfficeEditSignature().signature,'1');
    if(change==='example'){ui.form.elements.title.value='프로그램으로 적용한 제목';ui.setRich([{type:'text',value:'가상 예시'}]);controls['#office-apply-example'].click();}
    if(change==='rich'){ui.setRich([{type:'text',value:'가상 서식'}]);controls['[data-rich-toolbar]'].click();}
    if(change==='reference'){ui.referenceSelect.value='9';const pending=context.loadReference();canvas.emit('pointerdown');await pending;}
    assert.equal(canvas.ink.length,0);assert.throws(()=>context.getOfficeEditSignature(),/서명/);canvas.emit('pointerdown');assert.equal(context.getOfficeEditSignature().signature,change==='reference'?'3':'2');
  }
});
