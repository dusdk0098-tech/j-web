const tags=new Set(['p','div','span','strong','em','u','s','ul','ol','li','a','table','thead','tbody','tr','th','td']);
export const richFonts=Object.freeze(['맑은 고딕','굴림','돋움','바탕','궁서','Arial','Verdana','Times New Roman','sans-serif','serif','monospace']);
export const richSizes=Object.freeze([8,9,10,11,12,14,16,18,20,24,28,32,36]);
const blockTags=new Set(['p','div','li','td','th']);
export function normalizeRichStyle(style,type='span'){
  if(!style||typeof style!=='object'||Array.isArray(style))throw Error('본문 서식을 확인해 주세요.');
  const result={};
  for(const [key,value] of Object.entries(style)){
    if(key==='fontFamily'&&richFonts.includes(value))result[key]=value;
    else if(key==='fontSize'&&richSizes.includes(value))result[key]=value;
    else if(['color','backgroundColor'].includes(key)&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))result[key]=value.toLowerCase();
    else if(key==='textAlign'&&blockTags.has(type)&&['left','center','right','justify'].includes(value))result[key]=value;
    else if(key==='indent'&&blockTags.has(type)&&Number.isInteger(value)&&value>=0&&value<=8)result[key]=value;
    else throw Error('허용되지 않은 본문 서식입니다.');
  }
  return result;
}
const styleCSS=style=>Object.entries(style).map(([key,value])=>`${({fontFamily:'font-family',fontSize:'font-size',color:'color',backgroundColor:'background-color',textAlign:'text-align',indent:'margin-left'})[key]}:${key==='fontSize'?value+'px':key==='indent'?value*24+'px':value}`).join(';');
function editorStyle(node,type){
  const result={},style=node.style||{};
  const color=value=>{if(/^#[a-f0-9]{6}$/i.test(value))return value;const rgb=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);return rgb&&rgb.slice(1).every(v=>Number(v)<=255)?'#'+rgb.slice(1).map(v=>Number(v).toString(16).padStart(2,'0')).join(''):null;};
  const font=(style.fontFamily||'').replace(/^["']|["']$/g,'');if(richFonts.includes(font))result.fontFamily=font;
  if(/^\d+px$/.test(style.fontSize)&&richSizes.includes(parseInt(style.fontSize)))result.fontSize=parseInt(style.fontSize);
  for(const key of ['color','backgroundColor']){const value=color(style[key]||'');if(value)result[key]=value;}
  if(blockTags.has(type)){
    if(['left','center','right','justify'].includes(style.textAlign))result.textAlign=style.textAlign;
    if(/^\d+px$/.test(style.marginLeft)&&parseInt(style.marginLeft)%24===0&&parseInt(style.marginLeft)<=192)result.indent=parseInt(style.marginLeft)/24;
  }
  return result;
}
const tableChildren={table:['thead','tbody','tr'],thead:['tr'],tbody:['tr'],tr:['th','td']},tableParents={thead:['table'],tbody:['table'],tr:['table','thead','tbody'],th:['tr'],td:['tr']};
export const documentRichLimits=Object.freeze({maxText:20000,maxBytes:100000});
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function normalizeRichLink(value){
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f]/.test(value))throw Error('링크 주소를 확인해 주세요.');
  let url;try{url=new URL(value);}catch{throw Error('링크 주소를 확인해 주세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('HTTP 또는 HTTPS 링크를 입력해 주세요.');
  return url.href;
}

export function normalizeRichText(value,{maxText=10000,maxBytes=50000,allowBoardImages=false}={}){
  if(!Array.isArray(value))throw Error('본문 서식을 확인해 주세요.');
  let count=0,length=0;
  const visit=(node,depth,parent='')=>{
    if(++count>1024||depth>16||!node||typeof node!=='object'||Array.isArray(node))throw Error('본문 서식을 확인해 주세요.');
    const keys=Object.keys(node),type=node.type;
    if(type==='image'){
      if(!allowBoardImages||keys.some(key=>!['type','attachmentId','fileVersion','alt'].includes(key))||!Number.isSafeInteger(node.attachmentId)||node.attachmentId<=0||typeof node.fileVersion!=='string'||!/^[a-f0-9]{32}$/.test(node.fileVersion)||typeof node.alt!=='string'||node.alt.length>200||(length+=node.alt.length)>maxText)throw Error('본문 이미지를 확인해 주세요.');
      return {type,attachmentId:node.attachmentId,fileVersion:node.fileVersion,alt:node.alt};
    }
    if(type==='text'){
      if(keys.some(key=>!['type','value'].includes(key))||typeof node.value!=='string'||(length+=node.value.length)>maxText)throw Error('본문 내용을 확인해 주세요.');
      return {type,value:node.value};
    }
    if(type==='br'){if(keys.some(key=>key!=='type'))throw Error('본문 서식을 확인해 주세요.');return {type};}
    if(!tags.has(type)||tableParents[type]&&!tableParents[type].includes(parent)||keys.some(key=>!['type','children','style',...(type==='a'?['href']:[])].includes(key))||!Array.isArray(node.children)||tableChildren[type]&&node.children.some(child=>!tableChildren[type].includes(child?.type)))throw Error('본문 서식을 확인해 주세요.');
    const result={type,...(type==='a'?{href:normalizeRichLink(node.href)}:{}),...(node.style===undefined?{}:{style:normalizeRichStyle(node.style,type)}),children:node.children.map(child=>visit(child,depth+1,type))};return result;
  };
  const result=value.map(node=>visit(node,1));if(new TextEncoder().encode(JSON.stringify(result)).length>maxBytes)throw Error('본문 서식이 너무 깁니다.');return result;
}

export function richTextToPlain(value,limits){
  const nodes=normalizeRichText(value,limits),blocks=new Set(['p','div','li']);let result='',blockEnd=false,cellStart=-1;
  const append=value=>{result+=value;blockEnd=false;},breakBlock=()=>{if(result&&result.length!==cellStart&&!result.endsWith('\n')){result+='\n';blockEnd=true;}};
  const walk=node=>{if(node.type==='text')append(node.value);else if(node.type==='image')append(node.alt);else if(node.type==='br')append('\n');else if(node.type==='tr'){breakBlock();node.children.forEach((cell,index)=>{if(index)append('\t');blockEnd=false;const previous=cellStart;cellStart=result.length;walk(cell);if(blockEnd){result=result.slice(0,-1);blockEnd=false;}cellStart=previous;});breakBlock();}else{if(blocks.has(node.type))breakBlock();node.children.forEach(walk);if(blocks.has(node.type))breakBlock();}};
  nodes.forEach(walk);return blockEnd?result.slice(0,-1):result;
}

export function richTextToHTML(value,limits){
  const render=node=>node.type==='text'?escape(node.value):node.type==='br'?'<br>':node.type==='image'?`<img src="${escape(boardImageUrl(node,limits))}" data-board-image-id="${node.attachmentId}" data-board-image-version="${node.fileVersion}" alt="${escape(node.alt)}" style="max-width:100%;height:auto">`:`<${node.type}${node.style?` style="${escape(styleCSS(node.style))}"`:''}${node.type==='a'?` href="${escape(node.href)}" target="_blank" rel="noopener noreferrer"`:''}>${node.children.map(render).join('')}</${node.type}>`;
  return normalizeRichText(value,limits).map(render).join('');
}

export function boardImageUrl(image,limits){
  if(typeof limits?.imageUrl!=='function')throw Error('본문 이미지 주소를 확인해 주세요.');
  const url=limits.imageUrl(image);
  if(typeof url!=='string'||!/^\/(?!\/)/.test(url)||/[\\\x00-\x20\x7f]/.test(url))throw Error('본문 이미지 주소를 확인해 주세요.');
  return url;
}

export function richTextFromEditor(root,limits){
  const names={P:'p',DIV:'div',STRONG:'strong',B:'strong',EM:'em',I:'em',U:'u',S:'s',STRIKE:'s',UL:'ul',OL:'ol',LI:'li',A:'a',BR:'br',TABLE:'table',THEAD:'thead',TBODY:'tbody',TR:'tr',TH:'th',TD:'td'};
  const convert=node=>{
    if(node.nodeType===3)return [{type:'text',value:node.nodeValue||''}];
    if(node.nodeType===1&&node.tagName==='IMG'&&limits?.allowBoardImages&&node.hasAttribute('data-board-image-id')&&node.hasAttribute('data-board-image-version'))return [{type:'image',attachmentId:Number(node.getAttribute('data-board-image-id')),fileVersion:node.getAttribute('data-board-image-version'),alt:node.getAttribute('alt')||''}];
    if(node.nodeType!==1||['SCRIPT','STYLE','IFRAME','OBJECT','IMG','SVG'].includes(node.tagName))return [];
    const type=names[node.tagName],style=editorStyle(node,type||'span'),formatted=Object.keys(style).length?{style}:{},emptyCell=['td','th'].includes(type)&&node.childNodes.length===1&&node.firstChild?.tagName==='BR',children=emptyCell?[]:[...node.childNodes].flatMap(convert);if(type==='br')return [{type:'br'}];
    if(type==='a'){try{return [{type,href:normalizeRichLink(node.getAttribute('href')),...formatted,children}];}catch{return children;}}
    if(type)return [{type,...formatted,children}];
    let result=children;if(node.tagName==='SPAN'){
      const style=node.style||{},decoration=(style.textDecorationLine||style.textDecoration||'').toLowerCase();
      for(const [enabled,mark] of [[style.fontWeight==='bold'||Number(style.fontWeight)>=600,'strong'],[style.fontStyle==='italic','em'],[decoration.includes('underline'),'u'],[decoration.includes('line-through'),'s']])if(enabled)result=[{type:mark,children:result}];
    }return Object.keys(formatted).length?[{type:'span',...formatted,children:result}]:result;
  };
  return normalizeRichText([...root.childNodes].flatMap(convert),limits);
}
