export function restaurantPrice(price,tax,autoTax=false){
  if(typeof price!=='string'||!/^\d{1,9}$/.test(price))return null;
  const meal=Number(price),vat=autoTax?Math.floor(meal/10):(/^\d{1,9}$/.test(tax)?Number(tax):null);
  return vat===null?null:{tax:vat,total:meal+vat};
}
