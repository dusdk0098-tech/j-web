import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('근로자 서명은 시작한 포인터만 추적하고 취소·지우기 뒤 이전 움직임을 무시한다',()=>{
  const source=readFileSync(new URL('../public/join.js',import.meta.url),'utf8');
  const start=source.indexOf('function signaturePad(canvas){'),end=source.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start);
  const lines=[],context={beginPath(){},moveTo(x,y){lines.push(['move',x,y]);},lineTo(x,y){lines.push(['line',x,y]);},stroke(){},clearRect(){lines.push(['clear']);}};
  const canvas={width:320,height:120,getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:160,height:60}),setPointerCapture(){},toDataURL:()=> 'data:image/png;base64,virtual'};
  const pad=runInNewContext(`${source.slice(start,end)};signaturePad(canvas)`,{canvas});
  const event=(pointerId,x=10,y=10)=>({pointerId,clientX:x,clientY:y,pointerType:'touch',button:0,preventDefault(){}});
  assert.throws(()=>pad.value(),/서명/);
  canvas.onpointerdown(event(1));canvas.onpointerdown(event(2));canvas.onpointermove(event(2,30,30));canvas.onpointerup(event(2));canvas.onpointermove(event(1,20,20));
  assert.deepEqual(lines,[['move',20,20],['line',20.1,20.1],['line',40,40]]);
  canvas.onlostpointercapture(event(1));canvas.onpointermove(event(1,25,25));assert.equal(lines.length,3);
  canvas.onpointerdown(event(3));pad.clear();canvas.onpointermove(event(3,40,40));assert.equal(lines.at(-1)[0],'clear');assert.equal(pad.hasValue(),false);assert.throws(()=>pad.value(),/서명/);
  canvas.onpointerdown({...event(4),pointerType:'mouse',button:2});assert.equal(pad.hasValue(),false);
  canvas.onpointerdown(event(5));canvas.onpointercancel(event(5));assert.equal(pad.value(),'data:image/png;base64,virtual');
  canvas.onpointerdown(event(6));pad.setDisabled(true);const before=lines.length;canvas.onpointermove(event(6,30,30));canvas.onpointerdown(event(7));assert.equal(lines.length,before);assert.equal(pad.hasValue(),true);pad.setDisabled(false);canvas.onpointerdown(event(8));assert.ok(lines.length>before);
});
