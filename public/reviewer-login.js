const storageKey='jweb.reviewer.loginId';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_]{3,40}$/.test(value);

export function reviewerLogin({form,message,api,refresh,storage=()=>globalThis.localStorage}){
  const {loginId,password,rememberId,keepLogin}=form.elements,status=form.querySelector('[data-login-status]'),button=form.querySelector('button');
  let storageAvailable=true;
  const unavailable=(notice='이 브라우저에서는 아이디를 저장할 수 없습니다.')=>{storageAvailable=false;rememberId.checked=false;rememberId.disabled=true;status.textContent=notice;};
  try{const saved=storage().getItem(storageKey);if(validId(saved)){loginId.value=saved;rememberId.checked=true;}}catch{unavailable();}
  rememberId.onchange=()=>{if(!rememberId.checked&&storageAvailable)try{storage().removeItem(storageKey);}catch{unavailable('저장된 아이디를 삭제할 수 없습니다. 브라우저 저장소를 확인해 주세요.');}};
  return async event=>{
    event.preventDefault();const id=loginId.value,secret=password.value,remember=rememberId.checked,keep=keepLogin.checked,controls=[loginId,password,rememberId,keepLogin,button],disabled=controls.map(control=>control.disabled);
    controls.forEach(control=>{control.disabled=true;});
    try{
      await api('/api/reviewer/login',{method:'POST',body:JSON.stringify({loginId:id,password:secret,keepLogin:keep})});
      let saved='';
      if(storageAvailable)try{if(remember&&validId(id)){storage().setItem(storageKey,id);saved=id;}else storage().removeItem(storageKey);}catch{unavailable();}
      form.reset();if(saved){loginId.value=saved;rememberId.checked=true;}await refresh();
    }catch(error){message.textContent=error.message;}finally{controls.forEach((control,index)=>{control.disabled=disabled[index];});if(!storageAvailable)rememberId.disabled=true;}
  };
}
