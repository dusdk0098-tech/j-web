import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {renderPlanPdfs} from '../public/plan-pdf.js';

Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const assets=resolve('node_modules/pdfjs-dist').replaceAll('\\','/')+'/';
const evidence=process.env.PDF_RENDER_EVIDENCE_DIR;
function artifact(name,data){if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,name),data);}}
function pdf(objects,trailer=''){
  let data='%PDF-1.7\n';const offsets=[];
  for(const object of objects){offsets.push(Buffer.byteLength(data));data+=`${offsets.length} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(data);
  return Buffer.from(data+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R ${trailer} >>\nstartxref\n${start}\n%%EOF\n`);
}
const stream=(data,extra='')=>`<< /Length ${Buffer.byteLength(data)} ${extra} >>\nstream\n${data}\nendstream`;
function fixture(tiny=false){return pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${tiny?'0.1 0.1':'200 200'}] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 6 0 R /Annots [9 0 R] >>`,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  stream('1 0 0 rg 10 10 40 40 re f\n0 0 0 rg BT /F1 20 Tf 10 160 Td (PDF TEST) Tj ET\nq 40 0 0 40 70 10 cm /Im1 Do Q\n'),
  stream('0 1 0 rg 0 0 300 100 re f\n'),
  stream('0000ff>', '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode'),
  '<< /Type /Annot /Subtype /Stamp /Rect [120 10 160 50] /F 4 /AP << /N 10 0 R >> >>',
  stream('1 0 1 rg 0 0 40 40 re f\n','/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Resources << >>'),
]);}
function run(bytes){
  const nodes=[];
  const area={ownerDocument:{createElement(tag){if(tag==='canvas'){const canvas=createCanvas(1,1);canvas.setAttribute=()=>{};return canvas;}return {children:[],append(...children){this.children.push(...children);}};}},append(node){nodes.push(node);}};
  const promise=renderPlanPdfs({area,pdfjs:{...pdfjs,getDocument(options){return pdfjs.getDocument({...options,cMapUrl:assets+'cmaps/',standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'});}},snapshot:{version:'a'.repeat(64),files:[{id:1,name:'가상 렌더.pdf'}]},base:'/api/documents/1/print-pdfs',signal:new AbortController().signal,fetchFile:async()=>new Response(bytes)});
  return {nodes,promise};
}
const pixel=(canvas,x,y)=>Array.from(canvas.getContext('2d').getImageData(x,y,1,1).data);
test('실제 PDF.js 캔버스: 글자·색상·이미지·인쇄 도장·2쪽 순서',async()=>{
  const bytes=fixture();artifact('render-fixture.pdf',bytes);
  const {nodes,promise}=run(bytes);assert.equal(await promise,2);
  const [first,second]=nodes.map(node=>node.children[1]);
  assert.deepEqual([first.width,first.height,second.width,second.height],[300,300,450,150]);
  assert.match(nodes[0].children[0].textContent,/1 \/ 2쪽/);assert.match(nodes[1].children[0].textContent,/2 \/ 2쪽/);
  assert.deepEqual(pixel(first,30,270),[255,0,0,255]);
  assert.deepEqual(pixel(first,120,270),[0,0,255,255]);
  assert.deepEqual(pixel(first,195,270),[255,0,255,255]);
  assert.deepEqual(pixel(second,200,70),[0,255,0,255]);
  const textPixels=first.getContext('2d').getImageData(15,25,160,40).data;
  let black=0;for(let i=0;i<textPixels.length;i+=4)if(textPixels[i]<80&&textPixels[i+1]<80&&textPixels[i+2]<80)black++;
  assert.ok(black>100,`글자 영역의 실제 검은 픽셀: ${black}`);
  artifact('page-1.png',first.toBuffer('image/png'));artifact('page-2.png',second.toBuffer('image/png'));
  artifact('pixels.json',JSON.stringify({black,red:pixel(first,30,270),image:pixel(first,120,270),stamp:pixel(first,195,270),second:pixel(second,200,70)},null,2));
});
test('실제 PDF.js: 손상 PDF는 렌더 전에 거절',async()=>{
  const bytes=Buffer.from('%PDF-1.7\nnot a document');artifact('corrupt.pdf',bytes);
  const {nodes,promise}=run(bytes);await assert.rejects(promise,/Invalid PDF structure/);assert.equal(nodes.length,0);
});
test('실제 PDF.js: 극소 페이지는 0픽셀 캔버스를 만들지 않는다',async()=>{
  const {nodes,promise}=run(fixture(true));await assert.rejects(promise,/크기/);assert.equal(nodes.length,0);
});

function encryptedFixture(){
  const padding=Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a','hex');
  const pad=value=>Buffer.concat([Buffer.from(value),padding]).subarray(0,32);
  const md5=value=>createHash('md5').update(value).digest();
  const rc4=(key,input)=>{
    const state=Array.from({length:256},(_,i)=>i);let j=0;
    for(let i=0;i<256;i++){j=(j+state[i]+key[i%key.length])&255;[state[i],state[j]]=[state[j],state[i]];}
    let i=0;j=0;return Buffer.from(input.map(byte=>{i=(i+1)&255;j=(j+state[i])&255;[state[i],state[j]]=[state[j],state[i]];return byte^state[(state[i]+state[j])&255];}));
  };
  const owner=rc4(md5(pad('owner-test')).subarray(0,5),pad('render-test'));
  const id=Buffer.from('00112233445566778899aabbccddeeff','hex'),permissions=Buffer.alloc(4);permissions.writeInt32LE(-4);
  const key=md5(Buffer.concat([pad('render-test'),owner,permissions,id])).subarray(0,5),user=rc4(key,padding);
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`],`/Encrypt 4 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]`);
}
test('실제 PDF.js: 유효한 암호 PDF는 암호 없으면 캔버스 생성 전 거절',{timeout:10000},async()=>{
  const bytes=encryptedFixture();artifact('password.pdf',bytes);
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),password:'render-test'});
  try{const document=await task.promise;assert.equal(document.numPages,1);const page=await document.getPage(1),canvas=createCanvas(100,100);await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:1})}).promise;assert.deepEqual(pixel(canvas,50,50),[255,255,255,255]);}finally{await task.destroy();}
  const {nodes,promise}=run(bytes);await assert.rejects(promise,error=>error.name==='PasswordException'||/destroyed/.test(error.message));assert.equal(nodes.length,0);
});
