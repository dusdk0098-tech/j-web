const denied=()=>({status:403,error:'이 관리자에게 허용되지 않은 현장 또는 기능입니다.'});
const positive=value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));

// 검증된 메서드와 정확한 경로만 열고, 추가 기능은 소유 관계 검증 후 등록한다.
export function adminSitePolicy(db,req,url,session){
  const actor=session();if(!actor)return {status:401,error:'관리자 로그인이 필요합니다.'};
  if(actor.scope==='global')return null;
  const allowed=value=>positive(value)&&actor.siteIds.includes(Number(value));
  const site=value=>allowed(value)?null:denied();
  const doc=id=>db.prepare('SELECT id,site_id,type FROM documents WHERE id=?').get(Number(id));
  const owned=row=>row&&allowed(row.site_id)?null:denied();
  const method=req.method,path=url.pathname,input=req.adminInput;
  if(url.searchParams.has('siteId')&&!allowed(url.searchParams.get('siteId')))return denied();
  if(input?.siteId!==undefined&&!allowed(input.siteId))return denied();
  if(method==='GET'&&['/api/sites','/api/types'].includes(path))return null;
  if(path==='/api/documents'){
    if(method==='GET')return site(url.searchParams.get('siteId'));
    if(method==='POST')return input===undefined?null:input.officeSetup===undefined?site(input.siteId):denied();
  }
  const document=path.match(/^\/api\/documents\/(\d+)(?:\/(events|attachments))?$/);
  if(document){
    const row=doc(document[1]),failure=owned(row);if(failure)return failure;
    if(input?.siteId!==undefined&&Number(input.siteId)!==row.site_id)return denied();
    if(method==='GET')return null;
    if(method==='PUT'&&!document[2])return input===undefined?null:input.type===row.type&&input.officeSetup===undefined&&Number(input.siteId)===row.site_id?null:denied();
  }
  const attachment=path.match(/^\/api\/attachments\/(\d+)$/);
  if(method==='GET'&&attachment)return owned(db.prepare('SELECT d.site_id FROM attachments a JOIN documents d ON d.id=a.document_id WHERE a.id=?').get(Number(attachment[1])));
  return denied();
}
