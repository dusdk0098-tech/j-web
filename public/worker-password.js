export function mountWorkerPassword(panel,reportContext,onChanged,fetcher=globalThis.fetch){
  const section=panel.ownerDocument.createElement('section');
  section.innerHTML='<h2>시험 암호 변경</h2><p>변경하면 이 계정의 모든 시험 로그인이 종료됩니다. 가입 때 암호를 직접 설정하지 않았다면 관리자에게 초기화를 요청하세요.</p><form><label>현재 시험 암호 <input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required></label><label>새 시험 암호 <input name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>새 시험 암호 확인 <input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><button type="submit">시험 암호 변경</button><p role="status" aria-live="polite"></p></form>';
  panel.append(section);const form=section.querySelector('form'),status=section.querySelector('[role=status]'),button=form.querySelector('button'),fields=['currentPassword','newPassword','confirmPassword'].map(name=>form.elements[name]);
  form.onsubmit=async event=>{
    event.preventDefault();if(button.disabled||!panel.isConnected)return;
    const [currentPassword,newPassword,confirmPassword]=fields.map(field=>field.value);
    if(newPassword.length<12||newPassword.length>256||newPassword!==confirmPassword){status.textContent='새 암호와 확인을 같게 12자 이상 입력해 주세요.';return;}
    button.disabled=true;fields.forEach(field=>{field.disabled=true;});status.textContent='암호를 변경하고 있습니다.';
    const uncertain='변경 여부를 확인하지 못했습니다. 새 암호로 다시 로그인해 확인해 주세요.';
    try{
      let response,data;try{response=await fetcher('/api/worker/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword,newPassword,confirmPassword,reportContext})});data=await response.json();}catch{throw Error(uncertain);}
      if(!response.ok)throw Error(response.status>=500?uncertain:data.error||'암호를 변경하지 못했습니다.');
      if(panel.isConnected)onChanged();
    }catch(error){if(panel.isConnected)status.textContent=error.message;}
    finally{if(panel.isConnected){button.disabled=false;fields.forEach(field=>{field.disabled=false;});}}
  };
}
