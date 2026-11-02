const send=globalThis.fetch.bind(globalThis);
let context=null;

export function bindReviewerSession(value){
  if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw Error('직원 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.');
  if(context&&context!==value)throw Error('직원 로그인 세션이 변경되었습니다. 입력 내용을 복사한 뒤 새로고침해 주세요.');
  context=value;
}

export function clearReviewerSession(){context=null;}

if(typeof location!=='undefined')globalThis.fetch=async(input,options={})=>{
  const url=new URL(input instanceof Request?input.url:input,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/reviewer/')||url.pathname==='/api/reviewer/login')return send(input,options);
  if(!context){if(url.pathname==='/api/reviewer/session')return send(input,options);throw Error('직원 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.');}
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Reviewer-Context',context);
  return send(input,{...options,headers});
};
