// 화면이 열린 뒤 다른 탭에서 계정을 바꿔도 최초 세션 문맥을 유지한다.
const send=globalThis.fetch.bind(globalThis);
const initial=typeof location==='undefined'?Promise.resolve(null):send('/api/session').then(async response=>{if(!response.ok)throw Error('관리자 세션을 확인해 주세요.');return response.json();});
export const adminSession=initial;
if(typeof location!=='undefined')globalThis.fetch=async (input,options={})=>{
  const url=new URL(input instanceof Request?input.url:input,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return send(input,options);
  const session=await initial;if(!session?.authenticated||!session.context)throw Error('초기 관리자 로그인을 확인할 수 없습니다. 다시 로그인하고 새로고침해 주세요.');
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
  headers.set('X-Admin-Context',session.context);
  return send(input,{...options,headers});
};
