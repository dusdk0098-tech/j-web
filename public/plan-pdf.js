const pdfWarningListeners=new Set();
let originalWarn;
function pdfWarningHandler(...values) {
  if(values.some(value=>typeof value==='string'&&value.startsWith('Warning:')))for(const listener of [...pdfWarningListeners])listener();
  originalWarn.apply(console,values);
}
export function capturePdfWarnings(onWarning) {
  if(!pdfWarningListeners.size){originalWarn=console.warn;console.warn=pdfWarningHandler;}
  pdfWarningListeners.add(onWarning);
  return ()=>{pdfWarningListeners.delete(onWarning);if(!pdfWarningListeners.size&&console.warn===pdfWarningHandler)console.warn=originalWarn;};
}

export async function planPdfSnapshot(api,document,attachments,active) {
  try {
    const snapshot=await api(`/api/documents/${document.id}/print-pdfs`);
    if(!active())return null;
    const files=attachments.filter(file=>/\.pdf$/i.test(file.name)).sort((a,b)=>a.id-b.id).map(({id,name})=>({id,name}));
    if(JSON.stringify(snapshot.document)!==JSON.stringify(document)||JSON.stringify(snapshot.files)!==JSON.stringify(files))throw Error('계획서 또는 PDF 첨부가 변경되었습니다. 다시 조회해 주세요.');
    return snapshot;
  }catch(error){if(active())throw error;return null;}
}

export const pdfPrintLimits=Object.freeze({fileBytes:2*1024*1024,totalBytes:10*1024*1024,pages:30,pagePixels:2_000_000,totalPixels:30_000_000,timeout:60_000});

export function pdfPageSize(page) {
  const base=page.getViewport({scale:1});
  if(!Number.isFinite(base.width)||!Number.isFinite(base.height)||base.width<=0||base.height<=0||base.width>14400||base.height>14400)throw Error('지원 범위를 벗어난 PDF 페이지 크기입니다.');
  const scale=Math.min(1.5,Math.sqrt(pdfPrintLimits.pagePixels/(base.width*base.height)),2000/base.width,2000/base.height);
  const viewport=page.getViewport({scale});
  if(viewport.width<1||viewport.height<1)throw Error('지원 범위를 벗어난 PDF 페이지 크기입니다.');
  return {viewport,width:Math.floor(viewport.width),height:Math.floor(viewport.height)};
}

async function pdfBytes(response) {
  if(!response.ok)throw Error('PDF 첨부를 불러올 수 없습니다. 권한과 문서 변경 여부를 확인해 주세요.');
  if(Number(response.headers.get('content-length'))>pdfPrintLimits.fileBytes)throw Error('PDF는 파일당 2MB 이하여야 합니다.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>pdfPrintLimits.fileBytes)throw Error('PDF는 파일당 2MB 이하여야 합니다.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('올바른 PDF 첨부가 아닙니다.');
  return bytes;
}

// PDF의 스크립트·링크·양식은 실행하지 않고 페이지 캔버스만 만든다.
export async function renderPlanPdfs({snapshot,base,area,pdfjs,worker,signal,fetchFile=fetch,check=()=>{}}) {
  let totalBytes=0,totalPixels=0,pages=0;
  if(!Array.isArray(snapshot.files)||snapshot.files.length>20||!/^\/api\/documents\/\d+\/print-pdfs$/.test(base)||!/^\w{64}$/.test(snapshot.version))throw Error('계획서 첨부를 다시 조회해 주세요.');
  for(const file of snapshot.files){
    check();if(!Number.isSafeInteger(file.id)||file.id<1)throw Error('첨부 정보를 확인해 주세요.');
    const bytes=await pdfBytes(await fetchFile(`${base}/${file.id}?version=${snapshot.version}`,{credentials:'same-origin',redirect:'error',cache:'no-store',signal}));
    totalBytes+=bytes.length;if(totalBytes>pdfPrintLimits.totalBytes)throw Error('PDF 합계가 10MB를 초과합니다.');check();
    const task=pdfjs.getDocument({data:bytes,worker,enableXfa:false,stopAtErrors:true,disableFontFace:true,useSystemFonts:false,maxImageSize:pdfPrintLimits.pagePixels,canvasMaxAreaInBytes:8_000_000,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
    const abort=()=>{void task.destroy().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
    try{
      task.onPassword=()=>{void task.destroy().catch(()=>{});};
      const pdf=await task.promise;check();
      if((await pdf.getMetadata()).info.IsXFAPresent)throw Error('XFA 양식 PDF는 지원하지 않습니다. 일반 PDF로 저장한 시험 파일을 사용해 주세요.');check();
      pages+=pdf.numPages;if(!pdf.numPages||pages>pdfPrintLimits.pages)throw Error('PDF는 합계 30쪽까지 출력할 수 있습니다.');
      for(let number=1;number<=pdf.numPages;number++){
        check();const page=await pdf.getPage(number);check();
        if((await page.getAnnotations({intent:'print'})).some(annotation=>!annotation.hasAppearance))throw Error('인쇄 모양이 없는 주석·양식은 지원하지 않습니다. 주석을 포함해 평탄화한 시험 PDF를 사용해 주세요.');
        check();const size=pdfPageSize(page);
        totalPixels+=size.width*size.height;if(totalPixels>pdfPrintLimits.totalPixels)throw Error('PDF 전체 캔버스 한도를 초과했습니다.');
        const figure=area.ownerDocument.createElement('figure'),caption=area.ownerDocument.createElement('figcaption'),canvas=area.ownerDocument.createElement('canvas');
        figure.className='plan-pdf-page';caption.textContent=`${file.name} · ${number} / ${pdf.numPages}쪽`;canvas.width=size.width;canvas.height=size.height;canvas.setAttribute('aria-label',caption.textContent);
        figure.append(caption,canvas);area.append(figure);
        const render=page.render({canvasContext:canvas.getContext('2d'),viewport:size.viewport,background:'rgb(255,255,255)',intent:'print',annotationMode:pdfjs.AnnotationMode.ENABLE});
        const cancel=()=>render.cancel();signal.addEventListener('abort',cancel,{once:true});
        try{await render.promise;check();}finally{signal.removeEventListener('abort',cancel);page.cleanup();}
      }
    }finally{signal.removeEventListener('abort',abort);await task.destroy();}
  }
  return pages;
}

export function mountPlanPdfPrint({content,button,snapshot,api,active,onError,loadPdfjs=()=>import('/pdfjs/pdf.mjs')}) {
  const doc=content.ownerDocument,view=doc.defaultView,base=`/api/documents/${snapshot.document.id}/print-pdfs`;
  button.onclick=async()=>{
    if(button.disabled||!active())return;
    const controller=new AbortController(),area=doc.createElement('section'),status=doc.createElement('p');
    area.className='plan-pdf-output';status.className='plan-pdf-status';status.setAttribute('role','status');status.textContent='첨부 PDF의 모든 페이지를 준비하고 있습니다…';content.append(status,area);button.disabled=true;
    let nativeWorker,pdfWorker,printed=false,pdfWarning=false;
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>{nativeWorker?.terminate();reject(Error('PDF 준비가 취소되었거나 60초를 초과했습니다.'));},{once:true})),wait=promise=>Promise.race([promise,aborted]);
    const restoreWarnings=capturePdfWarnings(()=>{pdfWarning=true;controller.abort();});
    const observer=new view.MutationObserver(()=>{if(!area.isConnected)cleanup();});observer.observe(content,{childList:true});
    const cleanup=()=>{observer.disconnect();area.querySelectorAll('canvas').forEach(canvas=>{canvas.width=canvas.height=0;});area.remove();status.remove();button.disabled=false;view.removeEventListener('afterprint',cleanup);};
    const check=()=>{if(pdfWarning)throw Error('PDF의 이미지 또는 글꼴을 완전히 읽지 못했습니다. 파일을 확인해 주세요.');if(controller.signal.aborted||!active()||!button.isConnected)throw Error('화면이 변경되었거나 PDF 준비 시간이 초과되었습니다. 다시 시도해 주세요.');};
    const interval=setInterval(()=>{if(!active()||!button.isConnected)controller.abort();},100),timeout=setTimeout(()=>controller.abort(),pdfPrintLimits.timeout);
    try{
      await wait(api(`${base}?version=${snapshot.version}`,{signal:controller.signal}));check();
      const pdfjs=await wait(loadPdfjs());check();
      nativeWorker=new view.Worker('/plan-pdf-worker.js',{type:'module'});nativeWorker.addEventListener('message',event=>{if(event.data?.jwebPdfWarning){pdfWarning=true;controller.abort();}});pdfWorker=new pdfjs.PDFWorker({port:nativeWorker});
      const count=await wait(renderPlanPdfs({snapshot,base,area,pdfjs,worker:pdfWorker,signal:controller.signal,check}));
      await wait(Promise.all([...content.querySelectorAll('img')].map(image=>image.decode())));
      await wait(api(`${base}?version=${snapshot.version}`,{signal:controller.signal}));check();
      area.setAttribute('data-ready','true');status.textContent=`첨부 PDF ${count}쪽 준비 완료`;
      view.addEventListener('afterprint',cleanup,{once:true});view.print();printed=true;
    }catch(error){if(active())onError(new Error(`PDF 포함 인쇄를 중단했습니다. ${pdfWarning?'PDF의 이미지 또는 글꼴을 완전히 읽지 못했습니다. 파일을 확인해 주세요.':error.name==='PasswordException'?'암호로 보호된 PDF는 지원하지 않습니다.':error.message||'PDF를 확인해 주세요.'}`));}
    finally{restoreWarnings();clearInterval(interval);clearTimeout(timeout);controller.abort();pdfWorker?.destroy();nativeWorker?.terminate();if(!printed)cleanup();}
  };
}
