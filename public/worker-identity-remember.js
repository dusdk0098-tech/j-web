export function mountWorkerIdentityRemember({form,remembered}){
  const name=form.elements.workerName,birth=form.elements.birthDigits,choice=form.elements.rememberIdentity,forget=form.querySelector('#forget-identity'),status=form.querySelector('#identity-remember-status');
  let site=null,epoch=0,revision=0;const changes=new Map(),suppressed=new Set();
  const change=key=>{const value=++revision;changes.set(key,value);return value;};
  const unavailable=()=>{choice.disabled=true;forget.disabled=true;status.textContent='이 기기에서 정보 저장을 사용할 수 없습니다.';};
  if(!remembered)unavailable();
  const invalidate=()=>{epoch++;};name.addEventListener('input',invalidate);birth.addEventListener('input',invalidate);
  choice.onchange=()=>{invalidate();const key=site,current=change(key);if(choice.checked)suppressed.delete(key);else suppressed.add(key);if(!choice.checked&&remembered&&key)remembered.clearIdentity(key,()=>changes.get(key)===current&&(site!==key||!choice.checked)).catch(()=>{status.textContent='저장된 정보를 지우지 못했습니다.';});};
  forget.onclick=()=>{invalidate();changes.clear();try{remembered.clearIdentityAll();suppressed.clear();name.value='';birth.value='';choice.checked=false;status.textContent='이 기기에 저장된 시험 정보를 지웠습니다.';}catch{status.textContent='저장된 정보를 지우지 못했습니다.';}};
  return {
    invalidate,
    async restore(key){if(site&&site!==key){name.value='';birth.value='';choice.checked=false;}site=key;const current=++epoch;if(!remembered||!key)return;try{const value=await remembered.loadIdentity(key);if(current===epoch&&value&&!suppressed.has(key)&&!name.value&&!birth.value&&!choice.checked){name.value=value.name;birth.value=value.birthDigits;choice.checked=true;}}catch{if(current===epoch)unavailable();}},
    begin(){invalidate();const state={selected:choice.checked,choiceDisabled:choice.disabled,forgetDisabled:forget.disabled};choice.disabled=true;forget.disabled=true;return state;},
    end(state){choice.disabled=state.choiceDisabled;forget.disabled=state.forgetDisabled;},
    async save(key,identity,selected){const current=++epoch;change(key);if(selected)suppressed.delete(key);else suppressed.add(key);if(!remembered)return '';try{if(selected)await remembered.saveIdentity(key,identity,()=>current===epoch);else{if(site)await remembered.clearIdentity(site,()=>current===epoch);if(key!==site)await remembered.clearIdentity(key,()=>current===epoch);}if(current===epoch)site=key;return '';}catch{return selected?'시험 정보를 저장하지 못했습니다.':'저장된 시험 정보를 지우지 못했습니다.';}}
  };
}
