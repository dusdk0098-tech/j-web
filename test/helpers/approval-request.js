// 기존 권한·서명 시나리오는 최신 조회 회차를 사용한다. 오래된 회차 시험은 기본 fetch를 사용한다.
export async function fetchWithApprovalCycle(url,options={}){
  const parsed=new URL(url),match=parsed.pathname.match(/^\/api\/(reviewer\/)?documents\/(\d+)\/(decision|comments|transition)$/);
  let input;try{input=JSON.parse(options.body);}catch{}
  if(options.method==='POST'&&input&&match&&(match[3]==='comments'||['approve','reject','final_approve'].includes(input.action))&&!Object.hasOwn(input,'expectedCycleId')){
    const response=await fetch(new URL(parsed.pathname.replace(/\/(decision|comments|transition)$/,''),url),{headers:options.headers}),view=await response.json();input.expectedCycleId=(view.document||view).approval_cycle_id??null;
    options={...options,body:JSON.stringify(input)};
  }
  const edit=parsed.pathname.match(/^\/api\/(?:worker\/)?documents\/(\d+)\/(transition|(?:checklist|tbm|joint|meeting|author)-signature)$/);
  if(options.method==='POST'&&input&&edit&&(edit[2]!=='transition'||['submit','withdraw','revise'].includes(input.action))&&!Object.hasOwn(input,'expectedEditVersion')){
    const response=await fetch(new URL(parsed.pathname.replace(/\/[^/]+$/,''),url),{headers:options.headers}),view=await response.json();input.expectedEditVersion=view.edit_version??null;options={...options,body:JSON.stringify(input)};
  }
  if(options.method==='POST'&&input&&parsed.pathname==='/api/documents/batch-approve'&&!Object.hasOwn(input,'expectedCycleIds')){
    input.expectedCycleIds=await Promise.all(input.ids.map(async id=>{const response=await fetch(new URL(`/api/documents/${id}`,url),{headers:options.headers});return (await response.json()).approval_cycle_id??null;}));options={...options,body:JSON.stringify(input)};
  }
  return fetch(url,options);
}
