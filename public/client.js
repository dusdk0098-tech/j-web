const $=selector=>document.querySelector(selector);
const auth=$('#auth'),profile=$('#profile'),login=$('#login-form'),register=$('#register-form'),message=$('#message');
const recoveryButton=$('#client-recovery-verify'),recoveryStatus=$('#client-recovery-status');let profileEpoch=0,recoveryEpoch=0,profileId=null,recoveryVersion='';
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'요청에 실패했습니다.'),{status:response.status});return data;
}
function showAuth(registering=false){profileEpoch++;recoveryEpoch++;profileId=null;recoveryVersion='';auth.hidden=false;profile.hidden=true;login.hidden=registering;register.hidden=!registering;}
async function refreshRecovery(){
  const generation=profileEpoch,current=++recoveryEpoch,id=profileId;recoveryButton.disabled=true;recoveryVersion='';recoveryStatus.textContent='이메일 확인 상태를 조회하고 있습니다.';
  try{const result=await api('/api/client/recovery/status');if(generation!==profileEpoch||current!==recoveryEpoch||profile.hidden)return;
    if(result.clientId!==id){recoveryStatus.textContent='계정이 변경되었습니다. 다시 로그인해 주세요.';return;}
    recoveryVersion=result.version;recoveryButton.disabled=!result.enabled;recoveryStatus.textContent=result.enabled?(result.verified?'이메일 확인됨':'이메일 확인 필요'):'이메일 전달 미설정';
  }catch(error){if(generation===profileEpoch&&current===recoveryEpoch&&!profile.hidden)recoveryStatus.textContent=error.message;}
}
function showProfile(client){
  profileEpoch++;profileId=client.id;
  const list=$('#profile-values');list.replaceChildren();
  for(const [label,value] of [['계정 구분',client.kind==='company'?'기업':'개인'],['아이디',client.loginId],['상호',client.businessName],['이름',client.name],['직위',client.position],['이메일',client.email],['휴대전화',client.phone],['사업자번호',client.businessNumber]]){
    const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value||'없음';list.append(term,description);
  }
  auth.hidden=true;profile.hidden=false;message.textContent='';refreshRecovery();
}
$('#client-recovery-refresh').onclick=()=>{if(!profile.hidden)refreshRecovery();};
recoveryButton.onclick=async()=>{
  const generation=profileEpoch,current=recoveryEpoch,id=profileId,version=recoveryVersion;if(profile.hidden||!id||!version)return;recoveryButton.disabled=true;
  try{await api('/api/client/recovery/verification',{method:'POST',body:JSON.stringify({clientId:id,version})});if(generation===profileEpoch&&current===recoveryEpoch&&!profile.hidden)recoveryStatus.textContent='저장된 이메일로 확인 링크 전달을 요청했습니다. 이메일을 확인해 주세요.';}
  catch(error){if(generation===profileEpoch&&current===recoveryEpoch&&!profile.hidden)recoveryStatus.textContent=error.message;}
  finally{if(generation===profileEpoch&&current===recoveryEpoch&&!profile.hidden)recoveryButton.disabled=false;}
};
$('#show-login').onclick=()=>{showAuth();message.textContent='';};
$('#show-register').onclick=()=>{showAuth(true);message.textContent='';};
$('#kind').onchange=()=>{const company=$('#kind').value==='company';$('#business-number').required=company;$('#business-name').required=company;};
$('#check-id').onclick=async event=>{
  const button=event.currentTarget,id=register.elements.loginId.value;button.disabled=true;
  try{const result=await api('/api/client/id-check',{method:'POST',body:JSON.stringify({loginId:id})});if(id===register.elements.loginId.value)message.textContent=result.available?'사용할 수 있는 시험 아이디입니다.':'이미 사용 중인 시험 아이디입니다.';}
  catch(error){message.textContent=error.message;}finally{button.disabled=false;}
};
login.onsubmit=async event=>{
  event.preventDefault();const input=Object.fromEntries(new FormData(login)),fields=login.querySelector('fieldset');fields.disabled=true;message.textContent='';
  try{await api('/api/client/login',{method:'POST',body:JSON.stringify(input)});const result=await api('/api/client/session');login.reset();showProfile(result.client);}
  catch(error){message.textContent=error.message;}finally{fields.disabled=false;}
};
register.onsubmit=async event=>{
  event.preventDefault();const input=Object.fromEntries(new FormData(register)),fields=register.querySelector('fieldset');input.acknowledged=input.acknowledged==='on';fields.disabled=true;message.textContent='';
  try{await api('/api/client/register',{method:'POST',body:JSON.stringify(input)});register.reset();$('#kind').onchange();login.elements.loginId.value=input.loginId;showAuth();message.textContent='시험 계정을 만들었습니다. 로그인해 주세요.';}
  catch(error){message.textContent=error.message;}finally{fields.disabled=false;}
};
$('#logout').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;try{await api('/api/client/logout',{method:'POST',body:'{}'});showAuth();message.textContent='로그아웃했습니다.';}catch(error){message.textContent=error.message;}finally{button.disabled=false;}
};
try{const result=await api('/api/client/session');showProfile(result.client);}catch(error){showAuth();message.textContent=error.status===401?'':error.message;}
