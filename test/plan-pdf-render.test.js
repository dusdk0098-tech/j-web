import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {renderPlanPdfs,renderPdfFiles} from '../public/plan-pdf.js';
import {Store} from '../store.js';

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
test('출입자 첨부 PDF는 실제 서버에서 확인한 파일을 실제 캔버스에 출력한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-worker-pdf-')),store=new Store(join(dir,'jweb.sqlite'));let site,worker,row;
  try{site=store.createSite({name:'가상 현장'});worker=store.createWorker({siteId:site.id,name:'가상 출입자',category:'직영',company:'가상 회사',occupation:'가상 직종'});store.addWorkerFile(site.id,worker.id,'other','가상.pdf',fixture());row=store.workers(site.id)[0];}finally{store.close();}
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const origin='http://127.0.0.1:'+port,request=(path,options={})=>fetch(origin+path,options),login=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-admin-password'})}),cookie=login.headers.get('set-cookie').split(';')[0],response=await request('/api/workers/preview',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({siteId:site.id,items:[{id:worker.id,version:row.version}]})});assert.equal(response.status,200);const file=(await response.json()).workers[0].files[0];assert.equal(file.isPdf,true);
    const nodes=[],area={ownerDocument:{createElement(tag){if(tag==='canvas'){const canvas=createCanvas(1,1);canvas.setAttribute=()=>{};return canvas;}return {children:[],append(...children){this.children.push(...children);}};}},append(node){nodes.push(node);}},url=`/api/workers/${worker.id}/files/${file.id}?siteId=${site.id}&version=${file.version}`,fetchFile=(path,options)=>request(path,{...options,headers:{cookie}}),pdfjsWithAssets={...pdfjs,getDocument(options){return pdfjs.getDocument({...options,cMapUrl:assets+'cmaps/',standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'});}};
    assert.equal(await renderPdfFiles({files:[{...file,url,area}],pdfjs:pdfjsWithAssets,signal:new AbortController().signal,fetchFile}),2);assert.deepEqual(pixel(nodes[0].children[1],30,270),[255,0,0,255]);assert.deepEqual(pixel(nodes[1].children[1],200,70),[0,255,0,255]);assert.equal((await request(url)).status,401);assert.equal((await request(url,{method:'DELETE',headers:{cookie}})).status,200);await assert.rejects(renderPdfFiles({files:[{...file,url,area}],pdfjs:pdfjsWithAssets,signal:new AbortController().signal,fetchFile}),/권한/);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
test('실제 PDF.js 캔버스: 내장 한글 글꼴과 한글 인쇄 도장',{timeout:10000},async()=>{
  const bytes=readFileSync(new URL('./fixtures/korean-pdf/synthetic-korean.pdf',import.meta.url));
  artifact('korean-fixture.pdf',bytes);
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false});
  try{
    const document=await task.promise,page=await document.getPage(1);
    const text=await page.getTextContent();
    assert.equal(text.items.map(item=>item.str).join(''),'작업계획서가상시험');
    const annotations=await page.getAnnotations({intent:'print'});
    assert.equal(annotations.length,1);assert.equal(annotations[0].subtype,'Stamp');
    assert.equal(annotations[0].hasAppearance,true);
  }finally{await task.destroy();}
  const {nodes,promise}=run(bytes);assert.equal(await promise,1);
  const canvas=nodes[0].children[1];assert.deepEqual([canvas.width,canvas.height],[450,300]);
  const expected=PNG.sync.read(readFileSync(new URL('./fixtures/korean-pdf/expected.png',import.meta.url)));
  assert.deepEqual([expected.width,expected.height],[450,300]);
  const regions=[...Array.from('작업계획서',(char,i)=>({char,x:30+i*34,y:45})),...Array.from('가상시험',(char,i)=>({char,x:30+i*34,y:105}))];
  const observations=regions.map(({char,x,y})=>{
    const pixels=canvas.getContext('2d').getImageData(x,y,33,40).data;
    const mask=Buffer.from(Array.from({length:pixels.length/4},(_,i)=>pixels[i*4]<100&&pixels[i*4+1]<100&&pixels[i*4+2]<100?1:0));
    const ink=mask.reduce((sum,value)=>sum+value,0);
    assert.ok(ink>50&&ink<650,`${char}: 한글 글자별 실제 픽셀 ${ink}`);
    let mismatch=0;
    for(let i=0;i<mask.length;i++){
      const offset=((y+Math.floor(i/33))*expected.width+x+i%33)*4;
      const wanted=expected.data[offset]<100&&expected.data[offset+1]<100&&expected.data[offset+2]<100?1:0;
      if(mask[i]!==wanted)mismatch++;
    }
    assert.ok(mismatch<=30,`${char}: 확인한 글자 모양과 다른 픽셀 ${mismatch}`);
    return {char,ink,mismatch,hash:createHash('sha256').update(mask).digest('hex')};
  });
  assert.equal(new Set(observations.map(item=>item.hash)).size,9,'각 글자가 같은 누락 글리프 상자가 아니어야 한다');
  const stamp=canvas.getContext('2d').getImageData(310,210,70,40).data;
  let red=0;for(let i=0;i<stamp.length;i+=4)if(stamp[i]>180&&stamp[i+1]<100&&stamp[i+2]<100)red++;
  assert.ok(red>100,`테두리를 제외한 한글 도장 내부의 빨간 글자: ${red}`);
  assert.deepEqual(pixel(canvas,288,240),[255,0,0,255]);
  artifact('korean-page.png',canvas.toBuffer('image/png'));
  artifact('korean-pixels.json',JSON.stringify({observations,stampTextRedPixels:red},null,2));
});
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
