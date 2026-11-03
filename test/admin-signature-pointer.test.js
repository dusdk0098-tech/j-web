import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

for(const [file,name,next] of [['app.js','signaturePad','function showDialog'],['review.js','pad','let notesEpoch']])test(`${file}: 서명은 시작한 포인터만 추적한다`,()=>{
  const source=readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8'),start=source.indexOf(`function ${name}(`),end=source.indexOf(next,start);
  assert.ok(start>=0&&end>start);
  const lines=[],ctx={beginPath(){},moveTo(x,y){lines.push(['move',x,y]);},lineTo(x,y){lines.push(['line',x,y]);},stroke(){},clearRect(){lines.push(['clear']);}},clear={};
  const canvas={width:320,height:120,getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:160,height:60}),setPointerCapture(){},toDataURL:()=> 'data:image/png;base64,virtual'};
  const read=runInNewContext(`${source.slice(start,end)};${name}(canvas,clear)`,{canvas,clear});
  const e=(pointerId,x=10,y=10)=>({pointerId,clientX:x,clientY:y,pointerType:'touch',button:0,preventDefault(){}});
  assert.throws(()=>read(),/서명/);canvas.onpointerdown(e(1));canvas.onpointerdown(e(2));canvas.onpointermove(e(2,30,30));canvas.onpointerup(e(2));canvas.onpointermove(e(1,20,20));
  assert.deepEqual(lines,[['move',20,20],['line',20.1,20.1],['line',40,40]]);
  canvas.onlostpointercapture(e(1));canvas.onpointermove(e(1,25,25));assert.equal(lines.length,3);
  canvas.onpointerdown(e(6));canvas.onpointercancel();const count=lines.length;canvas.onpointermove(e(6,30,30));assert.equal(lines.length,count);
  canvas.onpointerdown(e(3));clear.onclick();canvas.onpointermove(e(3,40,40));assert.equal(lines.at(-1)[0],'clear');assert.throws(()=>read(),/서명/);
  canvas.onpointerdown({...e(4),pointerType:'mouse',button:2});assert.throws(()=>read(),/서명/);canvas.onpointerdown(e(5));canvas.onpointercancel(e(5));assert.equal(read(),'data:image/png;base64,virtual');
});

test('관리자 자가점검은 공통 서명의 빈 값과 저장 데이터를 확인한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),helper=source.slice(source.indexOf('function signaturePad('),source.indexOf('function showDialog('));
  const start=source.indexOf("    const form=$('#manager-check-form'),getSignature="),end=source.indexOf('\n    return;',start);assert.ok(start>=0&&end>start);
  const ctx={beginPath(){},moveTo(){},lineTo(){},stroke(){},clearRect(){}},canvas={width:320,height:120,getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:320,height:120}),setPointerCapture(){},toDataURL:()=> 'data:image/png;base64,virtual'};
  const form={elements:{answer0:{value:'O'},note0:{value:'가상'}}},status={},nodes={'#manager-check-form':form,'#manager-signature':canvas,'#manager-signature-clear':{},'#previous-manager-check':{},'#manager-day-off':{},'#manager-check-status':status},calls=[];
  const context={$:key=>nodes[key],questions:['가상 항목'],siteId:7,previous:[],api:async(...args)=>{calls.push(args);},flash(){},render:async()=>{}};
  runInNewContext(helper+'\n'+source.slice(start,end),context);
  await form.onsubmit({preventDefault(){}});assert.match(status.textContent,/서명/);assert.equal(calls.length,0);
  canvas.onpointerdown({pointerId:1,pointerType:'touch',button:0,clientX:10,clientY:10,preventDefault(){}});await form.onsubmit({preventDefault(){}});
  assert.equal(calls[0][0],'/api/sites/7/manager-checks');const body=JSON.parse(calls[0][1].body);assert.equal(body.signature,'data:image/png;base64,virtual');assert.deepEqual(body.answers,[{answer:'O',note:'가상'}]);
});
