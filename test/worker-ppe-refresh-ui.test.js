import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const start=source.indexOf('    const loadPpe=async()=>'),end=source.indexOf("    ppe.querySelector('button').onclick=loadPpe",start);
assert.ok(start>=0&&end>start);

test('동일한 보호구 기록의 새로고침은 미제출 서명을 보존하고 변경된 기록은 이전 제출을 막는다',async()=>{
  class Node{constructor(){this.children=[];this.fields=new Map();this.isConnected=true;this.disabled=false;this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){for(const old of this.children)if(!nodes.includes(old))old.isConnected=false;this.children=nodes;}querySelector(selector){if(!this.fields.has(selector))this.fields.set(selector,new Node());return this.fields.get(selector);}}
  let rows=[],posts=0;const ppeList=new Node(),ppeRows=new Map(),ppeStatus=new Node(),document={createElement:()=>new Node()},context={ppeList,ppeRows,ppeStatus,ppeGeneration:0,document,reportContext:{workerId:1},workerPanelActive:()=>true,signaturePad:canvas=>({clear(){canvas.signature='';},value(){return canvas.signature;}}),fetch:async(url,options)=>{if(options?.method==='POST'){posts++;return {ok:true,json:async()=>({})};}return {ok:true,status:200,json:async()=>structuredClone(rows)};}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.loadPpe=loadPpe;',context);
  const first={id:1,date:'2026-11-01',item:'가상 안전모',quantity:1,receipt_at:null,version:'one'};rows=[first];await context.loadPpe();const original=ppeList.children[0],form=original.children[1],canvas=form.querySelector('canvas');canvas.signature='작성 중인 서명';
  rows=[first,{id:2,date:'2026-11-01',item:'가상 장갑',quantity:1,receipt_at:null,version:'two'}];await context.loadPpe();assert.equal(ppeList.children[0],original);assert.equal(canvas.signature,'작성 중인 서명');
  rows=[{...first,quantity:2,version:'changed'}];await context.loadPpe();assert.notEqual(ppeList.children[0],original);await form.onsubmit({preventDefault(){}});assert.equal(posts,0);
});
