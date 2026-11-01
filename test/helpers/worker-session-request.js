import { fetchWithApprovalCycle } from './approval-request.js';
// 기존 권한·서명 시험의 로그인 응답만 기억한다. 저장 직전 조회나 세션 갱신은 하지 않는다.
const contexts=new Map();
export async function fetchWithWorkerSession(url,options={}){
  const parsed=new URL(url),headers=new Headers(options.headers),cookie=headers.get('cookie');let input;
  try{input=JSON.parse(options.body);}catch{}
  const mutation=['POST','PUT','DELETE'].includes(options.method)&&/^\/api\/worker\/(documents(?:\/.*)?|meetings|training|daily-training|self-check|notices\/\d+\/confirm|managed-attendance|ppe-issues\/\d+\/receipt|instructions(?:\/\d+\/photos)?|access|departure)$/.test(parsed.pathname);
  if(mutation&&contexts.has(cookie)){
    const binary=options.method==='POST'&&/\/(attachments|photos)$/.test(parsed.pathname);
    if(binary){if(!headers.has('x-worker-report-context'))headers.set('x-worker-report-context',JSON.stringify(contexts.get(cookie)));options={...options,headers};}
    else if(!input||!Object.hasOwn(input,'reportContext'))options={...options,body:JSON.stringify({...input,reportContext:contexts.get(cookie)})};
  }
  const response=await fetchWithApprovalCycle(url,options);
  if(parsed.pathname==='/api/worker/login'&&response.ok){const value=await response.clone().json(),key=response.headers.get('set-cookie')?.split(';')[0];if(key&&value.reportContext)contexts.set(key,value.reportContext);}
  return response;
}
