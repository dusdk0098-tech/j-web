export function materializeInstructionPrintPhotos(root,doc){
  for(const marker of root.querySelectorAll('[data-instruction-print-photo]')){
    const source=marker.getAttribute('data-instruction-print-photo');
    if(!/^\/api\/documents\/[1-9]\d*\/instruction-photos\/[1-9]\d*\?preview=1$/.test(source||''))throw Error('출력 사진 주소를 확인해 주세요.');
    const image=doc.createElement('img');image.className='site-photo';image.alt='시험 조치 사진';image.dataset.batchSource=source;marker.replaceWith(image);
  }
}

export async function freezeBatchImages(images,active,{fetchImage=fetch,urls=URL,digest=bytes=>crypto.subtle.digest('SHA-256',bytes)}={}) {
  const entries=[],created=[];let disposed=false,totalBytes=0;
  const dispose=()=>{disposed=true;for(const url of created)urls.revokeObjectURL(url);created.length=0;};
  const load=async (source,remaining=100*1024*1024)=>{
    const instruction=/^\/api\/documents\/[1-9]\d*\/instruction-photos\/[1-9]\d*\?preview=1$/.test(source),limit=(instruction?50:source.startsWith('/api/safety-cost-reports/')||/^\/api\/sites\/\d+\/daily-reports\/\d+\/print-photos\/site\/\d+\?/.test(source)?10:5)*1024*1024;
    let blob;
    if(source.startsWith('data:')){
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
      if(!match||match[2].length>7*1024*1024)throw Error('출력 이미지 형식 또는 크기를 확인해 주세요.');
      blob=new Blob([Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0))],{type:match[1]});
    }else{
      const response=await fetchImage(source,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(instruction?60000:15000)});
      const length=Number(response.headers?.get('content-length'));
      if(!response.ok||length>limit||length>remaining){
        try{await response.body?.cancel();}catch{}
        if(!response.ok)throw Error('출력 이미지를 다시 확인하지 못했습니다.');
        if(length>limit)throw Error('출력 이미지 형식 또는 크기를 확인해 주세요.');
        throw Error('선택 출력의 이미지 합계는 100MB를 초과할 수 없습니다.');
      }
      blob=await response.blob();
    }
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type)||!blob.size||blob.size>limit)throw Error('출력 이미지 형식 또는 크기를 확인해 주세요.');if(blob.size>remaining)throw Error('선택 출력의 이미지 합계는 100MB를 초과할 수 없습니다.');
    const hash=Array.from(new Uint8Array(await digest(await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
    return {blob,hash};
  };
  try{
    for(const image of images){
      const deferred=image.dataset?.batchSource,source=deferred||image.getAttribute('src');
      if((deferred&&!/^\/api\/documents\/[1-9]\d*\/instruction-photos\/[1-9]\d*\?preview=1$/.test(source))||(!source?.startsWith('/api/')&&!source?.startsWith('data:image/')))throw Error('출력 이미지 주소를 확인해 주세요.');
      const {blob,hash}=await load(source,100*1024*1024-totalBytes);totalBytes+=blob.size;if(!active()){dispose();return {dispose,check:async()=>{}};}
      const url=urls.createObjectURL(blob);created.push(url);image.src=url;
      let timer;try{await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('출력 이미지 준비 시간이 초과되었습니다.')),15000);})]);}finally{clearTimeout(timer);}
      if(!active()){dispose();return {dispose,check:async()=>{}};}
      entries.push({source,hash,type:blob.type});
    }
    return {dispose,check:async()=>{for(const entry of entries){if(disposed||!active())return;const latest=await load(entry.source);if(disposed||!active())return;if(latest.hash!==entry.hash||latest.blob.type!==entry.type)throw Error('출력 이미지가 변경되었습니다. 다시 조회해 주세요.');}}};
  }catch(error){dispose();throw error;}
}
