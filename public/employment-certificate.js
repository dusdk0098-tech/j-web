const output=document.querySelector('#employment-status'),documentView=document.querySelector('#employment-document'),fields=document.querySelector('#employment-fields'),print=document.querySelector('#employment-print');
const raw=new URLSearchParams(location.search).get('id')||'',id=Number(raw);
async function load(){
  if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(id))throw Error('발급 기록을 확인해 주세요.');
  const response=await fetch(`/api/reviewer/employment/${id}`),data=await response.json();if(!response.ok)throw Error(data.error||'발급 기록을 확인해 주세요.');
  const rows=[['문서 번호',String(data.id)],['이름',data.employee],['사업자명',data.employer],['현장',data.site],['직책',data.position],['재직 기간',`${data.startDate} ~ ${data.endDate||'현재'}`],['발급 용도',data.purpose],['제출처',data.recipient||'미입력'],['발급일',data.issueDate]];
  for(const [label,value] of rows){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;fields.append(term,detail);}documentView.hidden=false;print.hidden=false;output.textContent='';
}
print.onclick=()=>window.print();load().catch(error=>{output.textContent=error.message;});
