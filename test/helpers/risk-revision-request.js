import { fetchWithWorkerSession } from './worker-session-request.js';

// 기존 순차 시험만 저장 직전에 조회한다. 충돌·누락 시험은 이 함수를 쓰지 않는다.
export async function fetchWithRiskRevision(url, options={}) {
  const parsed=new URL(url), match=parsed.pathname.match(/^(\/api\/documents\/\d+\/risk-activities)\/(\d+)(?:\/(signature|photos)(?:\/\d+)?)?$/);
  const headers=new Headers(options.headers),method=(options.method||'GET').toUpperCase();
  if(match&&headers.has('cookie')&&['POST','PUT','DELETE'].includes(method)&&!headers.has('x-risk-revision')){
    const response=await fetchWithWorkerSession(parsed.origin+match[1],{headers:{cookie:headers.get('cookie')}});
    if(response.ok){const row=(await response.json()).find(row=>row.id===Number(match[2]));if(row){
      headers.set('x-risk-revision',row.revision);
      if(match[3]==='signature')options={...options,body:JSON.stringify({...JSON.parse(options.body),expectedRevision:row.revision})};
    }}
  }
  return fetchWithWorkerSession(url,{...options,headers:Object.fromEntries(headers)});
}
