import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {renderPlanPdfs,renderPdfFiles,prepareWorkerPdfs,pdfPageSize,pdfPrintLimits} from '../public/plan-pdf.js';

function syntheticPdf(annotation=false){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << >> >>'];
  if(annotation){objects[2]=objects[2].replace('/Resources', '/Annots [5 0 R] /Resources');objects.push('<< /Type /Annot /Subtype /Stamp /Rect [0 0 100 100] /F 4 /AP << /N 6 0 R >> /A << /S /JavaScript /JS (globalThis.__pdfActionExecuted=true) >> >>',`<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length ${'0 0 1 rg 0 0 100 100 re f\n'.length} >>\nstream\n0 0 1 rg 0 0 100 100 re f\nendstream`);}
  let text='%PDF-1.7\n';const offsets=[0];objects.forEach((value,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj\n${value}\nendobj\n`;});const start=text.length;text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(text);
}
const version='a'.repeat(64),snapshot={version,files:[{id:1,name:'<시험>.pdf'}]},base='/api/documents/1/print-pdfs';
function harness({pages=2,fail=false}={}){
  const order=[],nodes=[];let destroyed=0;
  const area={ownerDocument:{createElement:tag=>({tag,children:[],setAttribute(){},append(...children){this.children.push(...children);},getContext(){return {};}})},append(node){nodes.push(node);}};
  const pdfjs={AnnotationMode:{ENABLE:1},getDocument(options){assert.equal(options.enableXfa,false);assert.equal(options.stopAtErrors,true);return {promise:Promise.resolve({getMetadata:async()=>({info:{}}),numPages:pages,async getPage(number){order.push(`page${number}`);return {getAnnotations:async()=>[],getViewport:({scale})=>({width:300*scale,height:400*scale}),render(options){assert.equal(options.annotationMode,1);return {promise:Promise.resolve().then(()=>{if(fail)throw Error('손상 PDF');order.push(`render${number}`);}),cancel(){}};},cleanup(){}};}}),async destroy(){destroyed++;}};}};
  return {area,pdfjs,order,nodes,get destroyed(){return destroyed;}};
}
test('모의 화면: 모든 페이지 순서·렌더 완료·안전 옵션·정리',async()=>{const h=harness(),count=await renderPlanPdfs({...h,snapshot,base,signal:new AbortController().signal,fetchFile:async(url,options)=>{assert.match(url,/\/1\?version=a{64}$/);assert.equal(options.credentials,'same-origin');return new Response(syntheticPdf());}});assert.equal(count,2);assert.deepEqual(h.order,['page1','render1','page2','render2']);assert.equal(h.nodes[0].children[0].textContent,'<시험>.pdf · 1 / 2쪽');assert.equal(h.destroyed,1);});
test('계획서와 연결 장비 PDF는 같은 한도와 버전으로 함께 출력한다',async()=>{const h=harness({pages:1}),paths=[],combined={...snapshot,equipmentFiles:[{equipmentId:7,id:8,name:'장비.pdf'}]};const count=await renderPlanPdfs({...h,snapshot:combined,base,signal:new AbortController().signal,fetchFile:async url=>{paths.push(url);return new Response(syntheticPdf());}});assert.equal(count,2);assert.deepEqual(paths,[`${base}/1?version=${version}`,`${base}/equipment/7/8?version=${version}`]);assert.equal(h.nodes[1].children[0].textContent,'장비.pdf · 1 / 1쪽');await assert.rejects(renderPlanPdfs({...h,snapshot:{...combined,equipmentFiles:Array(20).fill(combined.equipmentFiles[0])},base,signal:new AbortController().signal}),/20개/);});
test('출입자 PDF는 같은 출처의 버전 주소만 사용하고 전체 페이지 한도를 공유한다',async()=>{
  const h=harness({pages:16}),url='/api/workers/1/files/2?siteId=3&version='+('a'.repeat(32)),file={id:2,name:'가상.pdf',url,area:h.area},signal=new AbortController().signal,fetchFile=async(path)=>{assert.equal(path,url);return new Response(syntheticPdf());};
  await assert.rejects(renderPdfFiles({files:[file,{...file}],pdfjs:h.pdfjs,signal,fetchFile}),/30쪽/);
  await assert.rejects(renderPdfFiles({files:[{...file,url:'https://example.test/x'}],pdfjs:h.pdfjs,signal,fetchFile}),/첨부 정보/);
  await assert.rejects(renderPdfFiles({files:[file],pdfjs:h.pdfjs,signal,fetchFile:async()=>new Response('',{status:409})}),/권한/);
});
test('출입자 PDF 준비는 완료한 뒤에만 표시하고 실패 시 캔버스를 정리한다',async()=>{
  const original=globalThis.fetch,h=harness({pages:1});let ready=false,terminated=0;h.area.querySelectorAll=()=>h.nodes.flatMap(node=>node.children.filter(child=>child.tag==='canvas'));h.area.setAttribute=()=>{ready=true;};h.pdfjs.PDFWorker=class{destroy(){}};const view={Worker:class{addEventListener(){}terminate(){terminated++;}}},entry={id:2,name:'가상.pdf',url:'/api/workers/1/files/2?siteId=3&version='+('a'.repeat(32)),area:h.area};
  try{globalThis.fetch=async()=>new Response(syntheticPdf());const dispose=await prepareWorkerPdfs([entry],view,()=>true,{loadPdfjs:async()=>h.pdfjs});assert.equal(ready,true);assert.equal(h.nodes.length,1);assert.ok(terminated);dispose();assert.equal(h.nodes[0].children[1].width,0);ready=false;globalThis.fetch=async()=>new Response('',{status:409});await assert.rejects(prepareWorkerPdfs([entry],view,()=>true,{loadPdfjs:async()=>h.pdfjs}),/권한/);assert.equal(ready,false);}finally{globalThis.fetch=original;}
});
test('모의 화면: 페이지·파일·누적 용량·캔버스 상한과 실패 차단',async()=>{
  const run=(h,fetchFile=async()=>new Response(syntheticPdf()),extra={})=>renderPlanPdfs({...h,snapshot,base,signal:new AbortController().signal,fetchFile,...extra});
  await assert.rejects(run(harness({pages:31})),/30쪽/);
  await assert.rejects(run(harness(),async()=>new Response(new Uint8Array(pdfPrintLimits.fileBytes+1))),/2MB/);
  await assert.rejects(run(harness(),async()=>new Response('not pdf')),/올바른 PDF/);
  await assert.rejects(run(harness(),async()=>new Response('',{status:401})),/권한/);
  await assert.rejects(run(harness({fail:true})),/손상 PDF/);
  await assert.rejects(run(harness(),undefined,{check:()=>{throw Error('화면 변경');}}),/화면 변경/);
  const large=new Uint8Array(pdfPrintLimits.fileBytes);large.set(new TextEncoder().encode('%PDF-'));
  await assert.rejects(run(harness({pages:1}),async()=>new Response(large),{snapshot:{version,files:Array.from({length:6},(_,i)=>({id:i+1,name:'large.pdf'}))}}),/10MB/);
  const h=harness({pages:30});h.pdfjs.getDocument=()=>({promise:Promise.resolve({getMetadata:async()=>({info:{}}),numPages:30,getPage:async()=>({getAnnotations:async()=>[],getViewport:({scale})=>({width:2000*scale,height:2000*scale}),render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){}})}),destroy:async()=>{}});
  await assert.rejects(run(h),/캔버스 한도/);
  const xfa=harness();xfa.pdfjs.getDocument=()=>({promise:Promise.resolve({getMetadata:async()=>({info:{IsXFAPresent:true}})}),destroy:async()=>{}});await assert.rejects(run(xfa),/XFA/);
  assert.throws(()=>pdfPageSize({getViewport:()=>({width:Infinity,height:100})}),/크기/);
  const size=pdfPageSize({getAnnotations:async()=>[],getViewport:({scale})=>({width:10000*scale,height:10000*scale})});assert.ok(size.width*size.height<=pdfPrintLimits.pagePixels);
});
test('실제 PDF.js 파서: 가상 2쪽 PDF 순서와 페이지 크기',async()=>{
  // Node 파서 시험에만 DOMMatrix 형식이 필요하며 브라우저 캔버스 렌더링을 대체하지 않는다.
  globalThis.DOMMatrix??=class DOMMatrix{};
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=pdfjs.getDocument({data:new Uint8Array(syntheticPdf()),isEvalSupported:false,disableFontFace:true});
  try{const pdf=await task.promise;assert.equal(pdf.numPages,2);assert.equal((await pdf.getPage(1)).getViewport({scale:1}).width,300);assert.equal((await pdf.getPage(2)).getViewport({scale:1}).width,400);}finally{await task.destroy();}
});
test('모의 서버: 인증·동일 문서·변경·삭제·정적 자산·CSP',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-pdf-')),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 종료');})]);
    const origin=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const cookie=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0];
    const site=await(await call('/api/sites','POST',{name:'가상 PDF 현장'},cookie)).json(),eq=await(await call('/api/equipment','POST',{siteId:site.id,kind:'가상 장비',model:'모형',capacity:'',manufacturer:'',registration:''},cookie)).json(),input={siteId:site.id,type:'work_plan',title:'가상 계획서',date:'2026-11-01',details:{equipmentIds:[eq.id]}},doc=await(await call('/api/documents','POST',input,cookie)).json(),other=await(await call('/api/documents','POST',{...input,title:'다른 계획서',details:{}},cookie)).json();
    const upload=async(id,name,body)=>{const res=await fetch(`${origin}/api/documents/${id}/attachments`,{method:'POST',headers:{cookie,'x-file-name':encodeURIComponent(name)},body});assert.equal(res.status,201);return (await res.json()).id;};
    const id=await upload(doc.id,'가상.pdf',syntheticPdf()),foreign=await upload(other.id,'다른.pdf',syntheticPdf()),path=`/api/documents/${doc.id}/print-pdfs`;
    const eqUpload=await fetch(`${origin}/api/equipment/${eq.id}/attachments?siteId=${site.id}&category=inspection`,{method:'POST',headers:{cookie,'x-file-name':encodeURIComponent('장비.pdf')},body:syntheticPdf()});assert.equal(eqUpload.status,201);const eqFile=(await eqUpload.json()).id;
    assert.equal((await call(path)).status,401);const manifest=await(await call(path,'GET',null,cookie)).json();assert.equal(manifest.files[0].id,id);assert.deepEqual(manifest.equipmentFiles,[{equipmentId:eq.id,id:eqFile,name:'장비.pdf'}]);
    const equipmentPath=`${path}/equipment/${eq.id}/${eqFile}?version=${manifest.version}`;assert.equal((await call(equipmentPath)).status,401);const eqResponse=await call(equipmentPath,'GET',null,cookie);assert.equal(eqResponse.status,200);assert.deepEqual(Buffer.from(await eqResponse.arrayBuffer()),syntheticPdf());const otherManifest=await(await call(`/api/documents/${other.id}/print-pdfs`,'GET',null,cookie)).json();assert.equal((await call(`/api/documents/${other.id}/print-pdfs/equipment/${eq.id}/${eqFile}?version=${otherManifest.version}`,'GET',null,cookie)).status,404);
    const limited=await call('/api/admin-accounts','POST',{loginId:'pdf_limited',name:'가상 제한',password:'virtual-password-123',scope:'restricted',siteIds:[site.id]},cookie);assert.equal(limited.status,201);const limitedLogin=await call('/api/login','POST',{loginId:'pdf_limited',password:'virtual-password-123'}),limitedCookie=limitedLogin.headers.get('set-cookie').split(';')[0];assert.equal((await call(path,'GET',null,limitedCookie)).status,403);assert.equal((await call(equipmentPath,'GET',null,limitedCookie)).status,403);
    const file=`${path}/${id}?version=${manifest.version}`;assert.equal((await call(file)).status,401);assert.equal((await call(`${path}/${foreign}?version=${manifest.version}`,'GET',null,cookie)).status,404);assert.equal((await call(`${path}/${id}`,'GET',null,cookie)).status,409);
    const response=await call(file,'GET',null,cookie);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await response.arrayBuffer()),syntheticPdf());
    assert.equal((await call(`/api/equipment/${eq.id}/attachments/${eqFile}?siteId=${site.id}`,'DELETE',null,cookie)).status,200);assert.equal((await call(equipmentPath,'GET',null,cookie)).status,409);assert.equal((await call(file,'GET',null,cookie)).status,409);
    await upload(doc.id,'추가.txt',Buffer.from('virtual'));assert.equal((await call(file,'GET',null,cookie)).status,409);assert.equal((await call(equipmentPath,'GET',null,cookie)).status,409);
    const fresh=await(await call(path,'GET',null,cookie)).json();assert.equal((await call(`/api/attachments/${id}`,'DELETE',null,cookie)).status,200);assert.equal((await call(`${path}/${id}?version=${fresh.version}`,'GET',null,cookie)).status,409);
    const bad=await upload(doc.id,'손상.pdf',Buffer.from('invalid')),last=await(await call(path,'GET',null,cookie)).json();assert.equal((await call(`${path}/${bad}?version=${last.version}`,'GET',null,cookie)).status,415);
    for(const asset of ['/plan-pdf.js','/pdfjs/pdf.mjs','/pdfjs/pdf.worker.mjs','/pdfjs/wasm/openjpeg.wasm'])assert.equal((await call(asset)).status,200);
    assert.equal((await call('/pdfjs/package.json')).status,404);const csp=(await call('/')).headers.get('content-security-policy');assert.match(csp,/worker-src 'self'/);assert.doesNotMatch(csp,/'unsafe-eval'/);
    const js=readFileSync('public/app.js','utf8');assert.match(js,/mountPlanPdfPrint\(\{content,button,snapshot:pdfSnapshot/);assert.match(js,/\$\('#print'\)\.onclick=/);
  }finally{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}rmSync(dir,{recursive:true,force:true});}
});


function printHarness({apiFailure=0,renderFailure=false,warning=false,mainWarning=false}={}){
  const events=new Map(),errors=[],trace=[];let prints=0,calls=0,live=true,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const doc={createElement(tag){return {tag,ownerDocument:doc,children:[],isConnected:true,setAttribute(){},getContext(){return {};},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);},querySelectorAll(tag){return this.children.flatMap(node=>[...(node.tag===tag?[node]:[]),...node.querySelectorAll(tag)]);}}}};
  const view={Worker:class{addEventListener(name,callback){this.callback=callback;if(warning)queueMicrotask(()=>callback({data:{jwebPdfWarning:true}}));}terminate(){trace.push('terminate');}},MutationObserver:class{observe(){}disconnect(){}},addEventListener(name,callback){events.set(name,callback);},removeEventListener(name){events.delete(name);},print(){prints++;trace.push('print');events.get('afterprint')?.();}};doc.defaultView=view;
  const content=doc.createElement('content'),button={disabled:false,isConnected:true};
  const pdfjs={AnnotationMode:{ENABLE:1},PDFWorker:class{destroy(){trace.push('destroy-worker');}},getDocument(){return {promise:Promise.resolve({getMetadata:async()=>({info:{}}),numPages:1,getPage:async()=>({getAnnotations:async()=>[],getViewport:({scale})=>({width:100*scale,height:100*scale}),render:()=>({promise:gate.then(()=>{if(renderFailure)throw Error('렌더 실패');if(mainWarning)console.warn('Warning: Missing glyph');trace.push('rendered');}),cancel(){release();}}),cleanup(){}})}),destroy:async()=>{trace.push('destroy-document');}};}};
  return {content,button,snapshot:{...snapshot,document:{id:1}},api:async()=>{calls++;trace.push(`api${calls}`);if(calls===apiFailure)throw Error('권한/버전 변경');},active:()=>live,onError:error=>errors.push(error),loadPdfjs:async()=>pdfjs,release,leave:()=>{live=false;},errors,trace,get prints(){return prints;}};
}
test('모의 인쇄: 완료 전 인쇄 없음·최종 버전 재검증 후 1회·캔버스 정리',async()=>{
  const {mountPlanPdfPrint}=await import('../public/plan-pdf.js'),previous=globalThis.fetch;globalThis.fetch=async()=>new Response(syntheticPdf());
  try{const h=printHarness();mountPlanPdfPrint(h);const pending=h.button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.prints,0);assert.equal(h.button.disabled,true);h.release();await pending;assert.equal(h.prints,1);assert.ok(h.trace.indexOf('rendered')<h.trace.indexOf('api2'));assert.ok(h.trace.indexOf('api2')<h.trace.indexOf('print'));assert.equal(h.content.children.length,0);assert.equal(h.button.disabled,false);assert.equal(h.errors.length,0);}finally{globalThis.fetch=previous;}
});
test('모의 인쇄: 권한 변경·화면 전환·렌더 실패·이미지 생략 경고 모두 인쇄 0회',async()=>{
  const {mountPlanPdfPrint}=await import('../public/plan-pdf.js'),previous=globalThis.fetch;globalThis.fetch=async()=>new Response(syntheticPdf());
  try{for(const options of [{apiFailure:2},{renderFailure:true},{warning:true},{mainWarning:true},{leave:true}]){const h=printHarness(options);mountPlanPdfPrint(h);const pending=h.button.onclick();await new Promise(resolve=>setImmediate(resolve));if(options.leave)h.leave();h.release();await pending;assert.equal(h.prints,0,JSON.stringify(options));assert.equal(h.content.children.length,0);assert.equal(h.button.disabled,false);if(!options.leave)assert.equal(h.errors.length,1);if(options.warning)assert.match(h.errors[0].message,/이미지 또는 글꼴/);}}finally{globalThis.fetch=previous;}
});

test('모의 인쇄: 60초 시간 제한은 렌더 대기 중에도 종료하고 인쇄하지 않는다',async t=>{
  const {mountPlanPdfPrint}=await import('../public/plan-pdf.js'),previous=globalThis.fetch;globalThis.fetch=async()=>new Response(syntheticPdf());
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  try{const h=printHarness();mountPlanPdfPrint(h);const pending=h.button.onclick();await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(60001);await pending;assert.equal(h.prints,0);assert.equal(h.content.children.length,0);assert.match(h.errors[0].message,/60초/);assert.ok(h.trace.includes('terminate'));}finally{t.mock.timers.reset();globalThis.fetch=previous;}
});

test('스냅샷 경합: 화면 전환 후 늦은 성공·실패 무시, 첨부 추가·삭제·이름 변경 거절',async()=>{
  const {planPdfSnapshot}=await import('../public/plan-pdf.js'),document={id:1,title:'가상 계획서'},files=[{id:1,name:'가상.pdf'}],manifest={document,files,version};
  assert.deepEqual(await planPdfSnapshot(async()=>manifest,document,files,()=>true),manifest);
  assert.equal(await planPdfSnapshot(async()=>manifest,document,files,()=>false),null);
  assert.equal(await planPdfSnapshot(async()=>{throw Error('늦은 권한 오류');},document,files,()=>false),null);
  await assert.rejects(planPdfSnapshot(async()=>{throw Error('권한 오류');},document,files,()=>true),/권한 오류/);
  for(const changed of [[],[...files,{id:2,name:'추가.pdf'}],[{id:1,name:'변경.pdf'}]])await assert.rejects(planPdfSnapshot(async()=>({...manifest,files:changed}),document,files,()=>true),/첨부가 변경/);
  await assert.rejects(planPdfSnapshot(async()=>({...manifest,document:{...document,title:'수정됨'}}),document,files,()=>true),/계획서/);
  const js=readFileSync('public/app.js','utf8');assert.match(js,/await planPdfSnapshot\(api,doc,attachments,currentDetail\):null;\s*if\(!currentDetail\(\)\)return;/);
});

test('설치된 PDF.js 실제 warn 함수: Worker와 주 스레드의 console.warn 감지',async()=>{
  const {runInNewContext}=await import('node:vm'),{capturePdfWarnings}=await import('../public/plan-pdf.js');
  const workerWrapper=readFileSync('public/plan-pdf-worker.js','utf8').replace("await import('/pdfjs/pdf.worker.mjs');",'');
  for(const file of ['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','node_modules/pdfjs-dist/legacy/build/pdf.mjs','node_modules/pdfjs-dist/build/pdf.worker.mjs']){
    const code=readFileSync(file,'utf8').match(/function warn\(msg\) \{[\s\S]*?\n\}/)[0];
    let workerWarnings=0,mainWarnings=0;const context={console:{warn(){}},self:{postMessage(data){assert.equal(data.jwebPdfWarning,true);workerWarnings++;}},verbosity:1,VerbosityLevel:{WARNINGS:1}};
    runInNewContext(workerWrapper+'\n'+code+'\nwarn("Image exceeded maximum allowed size and was removed.");',context);assert.equal(workerWarnings,1,file);
    const original=console.warn,restore=capturePdfWarnings(()=>mainWarnings++);try{runInNewContext(code+'\nwarn("Type3 character skipped");',{console,verbosity:1,VerbosityLevel:{WARNINGS:1}});assert.equal(mainWarnings,1,file);}finally{restore();}assert.equal(console.warn,original);
  }
});
test('실제 가상 PDF: xref 복구 경고 감지 및 인쇄 주석 누락 방지',async()=>{
  const {capturePdfWarnings}=await import('../public/plan-pdf.js'),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let warnings=0;const restore=capturePdfWarnings(()=>warnings++),broken=Buffer.from(syntheticPdf().toString().replace(/startxref\n\d+/,'startxref\n0')),task=pdfjs.getDocument({data:new Uint8Array(broken),disableFontFace:true});
  try{const pdf=await task.promise;assert.equal(pdf.numPages,2);assert.ok(warnings>0);}finally{await task.destroy();restore();}
  globalThis.__pdfActionExecuted=false;
  const annotatedTask=pdfjs.getDocument({data:new Uint8Array(syntheticPdf(true)),disableFontFace:true});
  try{const pdf=await annotatedTask.promise,page=await pdf.getPage(1),annotations=await page.getAnnotations({intent:'print'});assert.equal(annotations.length,1);assert.equal(annotations[0].hasAppearance,true);const enabled=await page.getOperatorList({intent:'print',annotationMode:pdfjs.AnnotationMode.ENABLE}),disabled=await page.getOperatorList({intent:'print',annotationMode:pdfjs.AnnotationMode.DISABLE});assert.ok(enabled.fnArray.includes(pdfjs.OPS.beginAnnotation));assert.ok(enabled.fnArray.length>disabled.fnArray.length);assert.equal(globalThis.__pdfActionExecuted,false);}finally{await annotatedTask.destroy();delete globalThis.__pdfActionExecuted;}
  const h=harness();h.pdfjs.getDocument=()=>({promise:Promise.resolve({getMetadata:async()=>({info:{}}),numPages:1,getPage:async()=>({getAnnotations:async()=>[{hasAppearance:false}]})}),destroy:async()=>{}});await assert.rejects(renderPlanPdfs({...h,snapshot,base,signal:new AbortController().signal,fetchFile:async()=>new Response(syntheticPdf())}),/인쇄 모양이 없는/);assert.equal(h.nodes.length,0);
});

test('경고 구독은 중첩된 작업의 정리 순서와 중복 정리에 안전하다',async()=>{
  const {capturePdfWarnings}=await import('../public/plan-pdf.js');
  for(const reverse of [false,true]){const original=console.warn;let a=0,b=0;const first=capturePdfWarnings(()=>a++),second=capturePdfWarnings(()=>b++);console.warn('Warning: nested test');assert.equal(a,1);assert.equal(b,1);(reverse?second:first)();console.warn('Warning: remaining test');assert.equal(a,reverse?2:1);assert.equal(b,reverse?1:2);(reverse?first:second)();first();second();assert.equal(console.warn,original);}
});

test('PDF/수기 양방향 경합: 실제 두 mount가 인쇄 화면 소유권 공유',async()=>{
 const {mountPlanPdfPrint}=await import('../public/plan-pdf.js'),{mountManualPlanPrint}=await import('../public/plan-manual-print.js'),{reservePlanPrint}=await import('../public/plan-print-lock.js');
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response(syntheticPdf());
 try{
  const h=printHarness();mountPlanPdfPrint(h);const pending=h.button.onclick();await new Promise(resolve=>setImmediate(resolve));let manualCalls=0;const manualErrors=[],manual={disabled:false,isConnected:true};mountManualPlanPrint({content:h.content,button:manual,planId:1,api:async()=>{manualCalls++;},active:()=>true,fields:{},onError:error=>manualErrors.push(error)});await manual.onclick();assert.equal(manualCalls,0);assert.equal(manualErrors.length,1);assert.equal(h.prints,0);h.release();await pending;assert.equal(h.prints,1);const free=reservePlanPrint(h.content.ownerDocument.defaultView);assert.equal(typeof free,'function');free();
  const nodes=new Map(['[data-close]','[data-status]','[data-output]','[data-print]'].map(key=>[key,{}])),doc=h.content.ownerDocument,create=doc.createElement;let dialog;
  doc.body={append(node){node.isConnected=true;}};doc.createElement=tag=>tag==='dialog'?(dialog={open:false,isConnected:false,setAttribute(){},querySelector:key=>nodes.get(key),addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;}}):create(tag);
  let answer;const manualPendingApi=new Promise(resolve=>answer=resolve);mountManualPlanPrint({content:h.content,button:manual,planId:1,api:()=>manualPendingApi,active:()=>true,fields:{},onError:error=>manualErrors.push(error)});const preparing=manual.onclick();await h.button.onclick();assert.equal(h.prints,1);assert.match(h.errors.at(-1).message,/다른 작업계획서/);nodes.get('[data-close]').onclick();answer({type:'work_plan'});await preparing;assert.equal(dialog.isConnected,false);await h.button.onclick();assert.equal(h.prints,2);
  const failed=printHarness({apiFailure:1});mountPlanPdfPrint(failed);await failed.button.onclick();const retry=reservePlanPrint(failed.content.ownerDocument.defaultView);assert.equal(typeof retry,'function');retry();
 }finally{globalThis.fetch=previous;}
});
