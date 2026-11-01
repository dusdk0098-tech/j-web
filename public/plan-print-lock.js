// 한 브라우저의 인쇄 화면은 PDF 준비와 수기 미리보기가 함께 소유할 수 없다.
const owners=new WeakMap();
export function reservePlanPrint(view){
  if(owners.has(view))return null;
  const owner={};owners.set(view,owner);
  return ()=>{if(owners.get(view)===owner)owners.delete(view);};
}
