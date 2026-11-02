const kinds=new Set(['community_all','community_notice','community_event','community_info','community_resources','community_question','community_general','community_market']);

export function communityHash({kind,query='',page=1,id=null}){
  const params=new URLSearchParams({kind,q:query,page:String(page)});
  if(id!==null)params.set('id',String(id));
  return '#community?'+params;
}

export function readCommunityHash(hash){
  if(typeof hash!=='string'||!hash.startsWith('#community?'))return null;
  const params=new URLSearchParams(hash.slice('#community?'.length));
  if(['kind','q','page','id'].some(key=>params.getAll(key).length>1))return null;
  const kind=params.get('kind'),query=params.get('q')||'',pageText=params.get('page')||'1',idText=params.get('id');
  if(!kinds.has(kind)||query.length>200||!/^[1-9]\d*$/.test(pageText)||!Number.isSafeInteger(Number(pageText)))return null;
  if(idText!==null&&(!/^[1-9]\d*$/.test(idText)||!Number.isSafeInteger(Number(idText))))return null;
  return {kind,query,page:Number(pageText),id:idText===null?null:Number(idText)};
}

export function followCommunityLink(event){
  if(event&&(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return false;
  event?.preventDefault();return true;
}

export function confirmCommunityLeave(container,ask=message=>globalThis.confirm(message)){
  const text=[...container.querySelectorAll('article textarea')].some(input=>input.value.length>0),files=[...container.querySelectorAll('article input[type=file]')].some(input=>input.files?.length);
  return !(text||files)||ask('작성 중인 댓글이나 선택한 첨부를 버리고 이동할까요?');
}
