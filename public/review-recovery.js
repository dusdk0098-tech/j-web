const $=selector=>document.querySelector(selector),request=$('#recovery-request'),verify=$('#recovery-verify'),reset=$('#recovery-reset'),status=$('#recovery-status');
const client=location.pathname==='/client-recovery',base=client?'/api/client/recovery':'/api/reviewer/recovery',account=client?'발주처':'직원';
if(client){const mode=request.elements.mode,label=$('#recovery-identity-label');mode.onchange=()=>{label.textContent=mode.value==='id'?'이름':'아이디';};mode.onchange();}
const fragment=new URLSearchParams(location.hash.slice(1));let kind=fragment.has('verify')&&!fragment.has('reset')?'verify':fragment.has('reset')&&!fragment.has('verify')?'reset':'',token=kind?fragment.get(kind):'';
history.replaceState(null,'',location.pathname);
if(token&&!/^[\w-]{43}$/.test(token)){kind='';token='';status.textContent='확인 링크를 다시 확인해 주세요.';}
request.hidden=!!kind;verify.hidden=kind!=='verify';reset.hidden=kind!=='reset';

async function send(path,input){
  let response,data;try{response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});data=await response.json();}
  catch{throw Object.assign(Error('요청 결과를 확인하지 못했습니다.'),{uncertain:true});}
  if(!response.ok)throw Object.assign(Error(data.error||'요청을 처리하지 못했습니다.'),{uncertain:response.status>=500});return data;
}
request.onsubmit=async event=>{
  event.preventDefault();const button=request.querySelector('button'),input=client?{mode:request.elements.mode.value,identity:request.elements.identity.value,phone:request.elements.phone.value,email:request.elements.email.value}:{name:request.elements.name.value,email:request.elements.email.value};button.disabled=true;status.textContent='';
  try{const result=await send(`${base}/request`,input);status.textContent=result.message;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
verify.querySelector('button').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;status.textContent='';
  try{await send(`${base}/verify`,{token});token='';verify.hidden=true;status.textContent=`이메일을 확인했습니다. ${account} 로그인으로 돌아가세요.`;}catch(error){status.textContent=error.uncertain?`확인 결과를 알 수 없습니다. ${account} 내 정보에서 이메일 확인 상태를 확인해 주세요.`:error.message;}finally{button.disabled=false;}
};
reset.onsubmit=async event=>{
  event.preventDefault();const button=reset.querySelector('button'),controls=[button,reset.elements.password,reset.elements.confirmPassword],disabled=controls.map(item=>item.disabled),input={token,password:reset.elements.password.value,confirmPassword:reset.elements.confirmPassword.value};controls.forEach(item=>{item.disabled=true;});status.textContent='';
  try{await send(`${base}/reset`,input);token='';reset.reset();reset.hidden=true;status.textContent='시험 암호를 변경했습니다. 새 암호로 로그인해 주세요.';}catch(error){status.textContent=error.uncertain?'변경 결과를 확인하지 못했습니다. 입력한 새 암호로 로그인을 먼저 확인해 주세요.':error.message;}finally{controls.forEach((item,index)=>{item.disabled=disabled[index];});}
};
