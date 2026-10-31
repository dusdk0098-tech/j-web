const $=selector=>document.querySelector(selector);
const auth=$('#auth'),profile=$('#profile'),login=$('#login-form'),register=$('#register-form'),message=$('#message');
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'요청에 실패했습니다.'),{status:response.status});return data;
}
function showAuth(registering=false){auth.hidden=false;profile.hidden=true;login.hidden=registering;register.hidden=!registering;}
function showProfile(client){
  const list=$('#profile-values');list.replaceChildren();
  for(const [label,value] of [['계정 구분',client.kind==='company'?'기업':'개인'],['아이디',client.loginId],['상호',client.businessName],['이름',client.name],['직위',client.position],['이메일',client.email],['휴대전화',client.phone],['사업자번호',client.businessNumber]]){
    const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value||'없음';list.append(term,description);
  }
  auth.hidden=true;profile.hidden=false;message.textContent='';
}
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
