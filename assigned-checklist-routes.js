export async function handleAssignedChecklists(req,res,url,{actor,authorize,store,body,json}){
  const prefix='/api/'+actor.kind+'/custom-checklists';if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  authorize();const parts=url.pathname.slice(prefix.length).split('/').filter(Boolean),service=store.assignedChecklists,reply=(status,result)=>{authorize();json(res,status,result);return true;};
  if(!parts.length){if(req.method==='GET')return reply(200,service.list(actor));if(req.method==='POST'){const input=await body(req,220000);return reply(201,service.create(actor,input,authorize));}return reply(405,{error:'지원하지 않는 요청입니다.'});}
  const [rawId,part,rawFileId]=parts;if(!/^[1-9][0-9]*$/.test(rawId)||!Number.isSafeInteger(Number(rawId))||parts.length>3||rawFileId&&(!/^[1-9][0-9]*$/.test(rawFileId)||!Number.isSafeInteger(Number(rawFileId))))return reply(404,{error:'점검표를 찾을 수 없습니다.'});
  const id=Number(rawId),fileId=rawFileId?Number(rawFileId):null;
  if(!part){if(req.method==='GET')return reply(200,service.detail(actor,id));if(req.method==='PUT'){const input=await body(req,220000);return reply(200,service.update(actor,id,input,authorize));}}
  if(part==='signature'&&!fileId){if(req.method==='GET'){service.owned(actor,id);const saved=store.checklistSignature(id);authorize();if(!saved)return reply(404,{error:'저장된 서명이 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(saved.signature);return true;}if(req.method==='POST'){const input=await body(req,3000000);return reply(200,service.signature(actor,id,input,authorize));}}
  if(part==='transition'&&!fileId&&req.method==='POST'){const input=await body(req);return reply(200,service.transition(actor,id,input,authorize));}
  if(part==='attachments'){
    if(fileId&&req.method==='GET'){const file=service.file(actor,id,fileId);authorize();const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file.data);return true;}
    if(fileId&&req.method==='DELETE'){const input=await body(req);return reply(200,service.removeFile(actor,id,fileId,input.expectedEditVersion,authorize));}
    if(!fileId&&req.method==='GET'){service.owned(actor,id);return reply(200,store.attachments(id));}
    if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}authorize();let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw Error('파일 이름을 확인해 주세요.');}const raw=req.headers['x-document-edit-version'],version=typeof raw==='string'&&/^[0-9]+$/.test(raw)?Number(raw):undefined;return reply(201,service.addFile(actor,id,name,Buffer.concat(chunks),version,authorize));}
  }
  return reply(405,{error:'지원하지 않는 요청입니다.'});
}
