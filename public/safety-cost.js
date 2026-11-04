export function safetyCostAmount(price,quantity){
  if(typeof price!=='string'||!/^\d{1,12}$/.test(price)||typeof quantity!=='string'||!/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity))throw new Error('단가와 수량을 확인해 주세요.');
  const [whole,fraction='']=quantity.split('.'),scale=10n**BigInt(fraction.length),numerator=BigInt(price)*(BigInt(whole)*scale+BigInt(fraction||'0'));
  if(numerator%scale!==0n)throw new Error('금액은 원 단위로 계산되어야 합니다.');
  return (numerator/scale).toString();
}
export function bindSafetyCostAmount(price,quantity,output){
  const update=()=>{if(!price.value||!quantity.value){output.textContent='단가와 수량을 입력해 주세요.';return;}try{output.textContent=BigInt(safetyCostAmount(price.value,quantity.value)).toLocaleString('ko-KR')+'원';}catch(error){output.textContent=error.message;}};
  price.oninput=quantity.oninput=update;update();
}
