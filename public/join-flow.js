export function createJoinFlow(choices,login,form,message){
  const loginChoice=choices.querySelector('[data-choose-login]'),joinChoice=choices.querySelector('[data-choose-join]'),registrationStatus=choices.querySelector('#join-request-status'),consent=form.querySelector('#join-consent'),details=form.querySelector('#join-details'),status=form.querySelector('#join-consent-status');let canJoin=false,screen=0,context=0;
  const choose=mode=>{screen++;login.hidden=mode!=='login';form.hidden=mode!=='join';if(mode==='join'){consent.hidden=false;details.hidden=true;status.textContent='';}message.textContent='';};
  loginChoice.onclick=()=>choose('login');joinChoice.onclick=()=>{if(canJoin)choose('join');};
  form.querySelector('#join-next').onclick=()=>{if(!form.elements.acknowledged.checked){status.textContent='세 가지 시험 안내를 모두 확인해 주세요.';return;}screen++;status.textContent='';consent.hidden=true;details.hidden=false;};
  form.querySelector('#join-back').onclick=()=>{screen++;details.hidden=true;consent.hidden=false;};
  const sameContext=ticket=>!choices.hidden&&context===ticket.context;
  return {open(allowed){context++;screen++;if(registrationStatus)registrationStatus.textContent='';canJoin=allowed;choices.hidden=false;joinChoice.hidden=!allowed;login.hidden=true;form.hidden=true;},hide(){context++;screen++;if(registrationStatus)registrationStatus.textContent='';choices.hidden=true;login.hidden=true;form.hidden=true;},ticket(){return {context,screen};},active(ticket){return sameContext(ticket)&&screen===ticket.screen&&!form.hidden;},note(ticket,text){if(sameContext(ticket)&&registrationStatus)registrationStatus.textContent=text;},registered(){if(choices.hidden)return false;choose('login');return true;}};
}
