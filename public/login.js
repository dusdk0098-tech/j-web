const form=document.querySelector('#login-form');
form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try {const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:form.elements.password.value})});const result=await response.json();if(!response.ok)throw new Error(result.error);location.assign('/');}
  catch(error){document.querySelector('#message').textContent=error.message;button.disabled=false;}
};
