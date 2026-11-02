import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
const start=source.indexOf('    const loadPpe=async()=>'),end=source.indexOf("    ppe.querySelector('button').onclick=loadPpe",start);
assert.ok(start>=0&&end>start);

test('보호구 기록이 바뀌거나 삭제돼도 미제출 서명을 보존하고 이전 제출을 막는다',async()=>{
  class Node{constructor(){this.children=[];this.fields=new Map();this.isConnected=true;this.disabled=false;this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){for(const old of this.children)if(!nodes.includes(old))old.isConnected=false;this.children=nodes;for(const node of nodes)node.parent=this;}remove(){this.parent.children=this.parent.children.filter(node=>node!==this);this.isConnected=false;}querySelector(selector){if(!this.fields.has(selector))this.fields.set(selector,new Node());return this.fields.get(selector);}}
  let rows=[],posts=0;const ppeList=new Node(),ppeRows=new Map(),ppeDrafts=new Set(),ppeStatus=new Node(),document={createElement:()=>new Node()},context={ppeList,ppeRows,ppeDrafts,ppeStatus,ppeGeneration:0,document,reportContext:{workerId:1},workerPanelActive:()=>true,signaturePad:canvas=>({clear(){canvas.signature='';},hasValue(){return !!canvas.signature;},value(){return canvas.signature;}}),fetch:async(url,options)=>{if(options?.method==='POST'){posts++;return {ok:true,json:async()=>({})};}return {ok:true,status:200,json:async()=>structuredClone(rows)};}};
  runInNewContext(source.slice(start,end)+'\nglobalThis.loadPpe=loadPpe;',context);
  const first={id:1,date:'2026-11-01',item:'가상 안전모',quantity:1,receipt_at:null,version:'one'};rows=[first];await context.loadPpe();const original=ppeList.children[0],form=original.children[1],canvas=form.querySelector('canvas');canvas.signature='작성 중인 서명';
  rows=[first,{id:2,date:'2026-11-01',item:'가상 장갑',quantity:1,receipt_at:null,version:'two'}];await context.loadPpe();assert.equal(ppeList.children[0],original);assert.equal(canvas.signature,'작성 중인 서명');
  rows=[{...first,quantity:2,version:'changed'}];await context.loadPpe();assert.notEqual(ppeList.children[0],original);assert.ok(ppeList.children.includes(original));assert.equal(canvas.signature,'작성 중인 서명');await form.onsubmit({preventDefault(){}});assert.equal(posts,0);
  rows=[];await context.loadPpe();assert.deepEqual(ppeList.children,[original]);assert.equal(ppeDrafts.size,1);original.children.at(-1).onclick();assert.equal(ppeList.children.length,0);assert.equal(ppeDrafts.size,0);
  rows=[first];await context.loadPpe();const next=ppeList.children[0],nextForm=next.children[1],nextCanvas=nextForm.querySelector('canvas');nextCanvas.signature='전송한 서명';let finish;
  context.fetch=async(url,options)=>options?.method==='POST'?new Promise(resolve=>finish=resolve):({ok:true,status:200,json:async()=>structuredClone(rows)});
  const saving=nextForm.onsubmit({preventDefault(){}});nextCanvas.signature='전송 후 수정한 서명';rows=[{...first,receipt_at:'2026-11-01',version:'saved'}];finish({ok:true,json:async()=>({})});await saving;
  assert.ok(ppeList.children.includes(next));assert.equal(nextCanvas.signature,'전송 후 수정한 서명');assert.equal(ppeDrafts.size,1);
});
