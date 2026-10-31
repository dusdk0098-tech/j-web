export function createJoinFlow(choices,login,form,message){
  const loginChoice=choices.querySelector('[data-choose-login]'),joinChoice=choices.querySelector('[data-choose-join]'),consent=form.querySelector('#join-consent'),details=form.querySelector('#join-details'),status=form.querySelector('#join-consent-status');let canJoin=false;
  const choose=mode=>{login.hidden=mode!=='login';form.hidden=mode!=='join';if(mode==='join'){consent.hidden=false;details.hidden=true;status.textContent='';}message.textContent='';};
  loginChoice.onclick=()=>choose('login');joinChoice.onclick=()=>{if(canJoin)choose('join');};
  form.querySelector('#join-next').onclick=()=>{if(!form.elements.acknowledged.checked){status.textContent='세 가지 시험 안내를 모두 확인해 주세요.';return;}status.textContent='';consent.hidden=true;details.hidden=false;};
  form.querySelector('#join-back').onclick=()=>{details.hidden=true;consent.hidden=false;};
  return {open(allowed){canJoin=allowed;choices.hidden=false;joinChoice.hidden=!allowed;login.hidden=true;form.hidden=true;},hide(){choices.hidden=true;login.hidden=true;form.hidden=true;}};
}
