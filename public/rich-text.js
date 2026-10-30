const tags=new Set(['p','div','strong','em','u','s','ul','ol','li','a','table','thead','tbody','tr','th','td']);
const tableChildren={table:['thead','tbody','tr'],thead:['tr'],tbody:['tr'],tr:['th','td']},tableParents={thead:['table'],tbody:['table'],tr:['table','thead','tbody'],th:['tr'],td:['tr']};
export const documentRichLimits=Object.freeze({maxText:20000,maxBytes:100000});
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function normalizeRichLink(value){
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f]/.test(value))throw Error('링크 주소를 확인해 주세요.');
  let url;try{url=new URL(value);}catch{throw Error('링크 주소를 확인해 주세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('HTTP 또는 HTTPS 링크를 입력해 주세요.');
  return url.href;
}

export function normalizeRichText(value,{maxText=10000,maxBytes=50000}={}){
  if(!Array.isArray(value))throw Error('본문 서식을 확인해 주세요.');
  let count=0,length=0;
  const visit=(node,depth,parent='')=>{
    if(++count>1024||depth>16||!node||typeof node!=='object'||Array.isArray(node))throw Error('본문 서식을 확인해 주세요.');
    const keys=Object.keys(node),type=node.type;
    if(type==='text'){
      if(keys.some(key=>!['type','value'].includes(key))||typeof node.value!=='string'||(length+=node.value.length)>maxText)throw Error('본문 내용을 확인해 주세요.');
      return {type,value:node.value};
    }
    if(type==='br'){if(keys.some(key=>key!=='type'))throw Error('본문 서식을 확인해 주세요.');return {type};}
    if(!tags.has(type)||tableParents[type]&&!tableParents[type].includes(parent)||keys.some(key=>!['type','children',...(type==='a'?['href']:[])].includes(key))||!Array.isArray(node.children)||tableChildren[type]&&node.children.some(child=>!tableChildren[type].includes(child?.type)))throw Error('본문 서식을 확인해 주세요.');
    const result={type,...(type==='a'?{href:normalizeRichLink(node.href)}:{}),children:node.children.map(child=>visit(child,depth+1,type))};return result;
  };
  const result=value.map(node=>visit(node,1));if(new TextEncoder().encode(JSON.stringify(result)).length>maxBytes)throw Error('본문 서식이 너무 깁니다.');return result;
}

export function richTextToPlain(value,limits){
  const nodes=normalizeRichText(value,limits),blocks=new Set(['p','div','li']);let result='',blockEnd=false,cellStart=-1;
  const append=value=>{result+=value;blockEnd=false;},breakBlock=()=>{if(result&&result.length!==cellStart&&!result.endsWith('\n')){result+='\n';blockEnd=true;}};
  const walk=node=>{if(node.type==='text')append(node.value);else if(node.type==='br')append('\n');else if(node.type==='tr'){breakBlock();node.children.forEach((cell,index)=>{if(index)append('\t');blockEnd=false;const previous=cellStart;cellStart=result.length;walk(cell);if(blockEnd){result=result.slice(0,-1);blockEnd=false;}cellStart=previous;});breakBlock();}else{if(blocks.has(node.type))breakBlock();node.children.forEach(walk);if(blocks.has(node.type))breakBlock();}};
  nodes.forEach(walk);return blockEnd?result.slice(0,-1):result;
}

export function richTextToHTML(value,limits){
  const render=node=>node.type==='text'?escape(node.value):node.type==='br'?'<br>':`<${node.type}${node.type==='a'?` href="${escape(node.href)}" target="_blank" rel="noopener noreferrer"`:''}>${node.children.map(render).join('')}</${node.type}>`;
  return normalizeRichText(value,limits).map(render).join('');
}

export function richTextFromEditor(root,limits){
  const names={P:'p',DIV:'div',STRONG:'strong',B:'strong',EM:'em',I:'em',U:'u',S:'s',STRIKE:'s',UL:'ul',OL:'ol',LI:'li',A:'a',BR:'br',TABLE:'table',THEAD:'thead',TBODY:'tbody',TR:'tr',TH:'th',TD:'td'};
  const convert=node=>{
    if(node.nodeType===3)return [{type:'text',value:node.nodeValue||''}];
    if(node.nodeType!==1||['SCRIPT','STYLE','IFRAME','OBJECT','IMG','SVG'].includes(node.tagName))return [];
    const type=names[node.tagName],emptyCell=['td','th'].includes(type)&&node.childNodes.length===1&&node.firstChild?.tagName==='BR',children=emptyCell?[]:[...node.childNodes].flatMap(convert);if(type==='br')return [{type:'br'}];
    if(type==='a'){try{return [{type,href:normalizeRichLink(node.getAttribute('href')),children}];}catch{return children;}}
    if(type)return [{type,children}];
    let result=children;if(node.tagName==='SPAN'){
      const style=node.style,decoration=(style.textDecorationLine||style.textDecoration||'').toLowerCase();
      for(const [enabled,mark] of [[style.fontWeight==='bold'||Number(style.fontWeight)>=600,'strong'],[style.fontStyle==='italic','em'],[decoration.includes('underline'),'u'],[decoration.includes('line-through'),'s']])if(enabled)result=[{type:mark,children:result}];
    }return result;
  };
  return normalizeRichText([...root.childNodes].flatMap(convert),limits);
}
