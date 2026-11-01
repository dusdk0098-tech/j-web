import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRichText,richTextToHTML,richTextFromEditor,richTextToPlain,richFonts,richSizes} from '../public/rich-text.js';
import {mountRichEditor,richEditorMarkup,richBody} from '../public/rich-editor.js';

const text=value=>({nodeType:3,nodeValue:value,get length(){return this.nodeValue.length;}});
function element(tag,children=[],style={}){
  const node={nodeType:1,tagName:tag.toUpperCase(),style,childNodes:[],isConnected:true,contentEditable:'true',
    contains(other){return this===other||this.childNodes.some(child=>child===other||child.contains?.(other));},
    append(child){if(child.parentElement){const old=child.parentElement.childNodes;old.splice(old.indexOf(child),1);}this.childNodes.push(child);child.parentElement=this;},
    insertBefore(child,before){this.childNodes.splice(this.childNodes.indexOf(before),0,child);child.parentElement=this;},
    cloneNode(){return element(this.tagName,[],{...this.style});},remove(){const parent=this.parentElement;parent.childNodes.splice(parent.childNodes.indexOf(this),1);this.parentElement=null;},
    querySelectorAll(selector){const all=this.childNodes.flatMap(child=>child.nodeType===1?[child,...child.querySelectorAll('*')]:[]);return selector==='*'?all:all.filter(child=>selector.split(',').includes(child.tagName.toLowerCase()));},
    closest(selector){return selector==='[inert]'?(this.inert?this:this.parentElement?.closest(selector)):null;},focus(){},getAttribute(){return null;},
    dispatchEvent(event){this.events??=[];this.events.push(event);},get firstChild(){return this.childNodes[0];}
  };children.forEach(child=>node.append(child));return node;
}
// shortcut: Range 조작과 생성 HTML만 모의하며, 브라우저 고유 선택·인쇄 배치는 별도 실기 검증이 필요하다.
function range(start,end=start,a=0,b=end?.length||0){
  return {startContainer:start,endContainer:end,startOffset:a,endOffset:b,get collapsed(){return this.startContainer===this.endContainer&&this.startOffset===this.endOffset;},
    cloneRange(){return range(this.startContainer,this.endContainer,this.startOffset,this.endOffset);},
    setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;},
    setStartBefore(node){this.startContainer=node.parentElement;this.startOffset=node.parentElement.childNodes.indexOf(node);},setEndAfter(node){this.endContainer=node.parentElement;this.endOffset=node.parentElement.childNodes.indexOf(node)+1;},
    selectNodeContents(node){this.startContainer=this.endContainer=node;this.startOffset=0;this.endOffset=node.childNodes.length;},
    intersectsNode(node){return node===this.startContainer||node===this.endContainer||node.contains?.(this.startContainer)||node.contains?.(this.endContainer)||this.startContainer.contains?.(node);},
    surroundContents(span){const node=this.startContainer,parent=node.parentElement,index=parent.childNodes.indexOf(node),before=node.nodeValue.slice(0,this.startOffset),selected=node.nodeValue.slice(this.startOffset,this.endOffset),after=node.nodeValue.slice(this.endOffset);span.append(text(selected));const items=[...(before?[text(before)]:[]),span,...(after?[text(after)]:[])];items.forEach(item=>item.parentElement=parent);parent.childNodes.splice(index,1,...items);}
  };
}
function fixture(){
  const value=text('가상 본문'),paragraph=element('p',[value]),editor=element('div',[paragraph]),toolbar=element('div'),other=element('div',[text('외부')]);
  const selection={active:range(value),rangeCount:1,getRangeAt(){return this.active;},removeAllRanges(){this.rangeCount=0;},addRange(value){this.active=value;this.rangeCount=1;}},commands=[],errors=[];
  editor.ownerDocument={getSelection:()=>selection,createRange:()=>range(null,null),createTextNode:text,createElement:tag=>element(tag),createTreeWalker(root){const texts=[];const visit=node=>{if(node.nodeType===3)texts.push(node);else node.childNodes.forEach(visit);};visit(root);return {nextNode:()=>texts.shift()};},execCommand(...args){commands.push(args);return true;}};
  const api=mountRichEditor({querySelector:s=>s==='[data-rich-editor]'?editor:toolbar},{onError:error=>errors.push(error.message)});
  const style=(key,value)=>toolbar.onchange({target:{closest:()=>({dataset:{richStyle:key},value})}}),command=value=>toolbar.onclick({target:{closest:()=>({dataset:{format:value}})}});
  return {api,editor,paragraph,value,toolbar,selection,other,commands,errors,style,command};
}

test('format allowlist rejects arbitrary CSS/HTML, boundaries and malformed data',()=>{
  const child={type:'text',value:'<script>가상</script>'};
  for(const fontFamily of richFonts)assert.equal(normalizeRichText([{type:'span',style:{fontFamily},children:[child]}])[0].style.fontFamily,fontFamily);
  for(const fontSize of richSizes)assert.equal(normalizeRichText([{type:'span',style:{fontSize},children:[child]}])[0].style.fontSize,fontSize);
  for(const style of [{position:'fixed'},{color:'red'},{color:'#fff'},{color:'url(x)'},{fontFamily:'Arial;display:none'},{fontSize:13},{fontSize:'12'},{indent:9},{indent:-1},{indent:0.5},{textAlign:'start'},null,[]])assert.throws(()=>normalizeRichText([{type:'p',style,children:[child]}]));
  assert.throws(()=>normalizeRichText([{type:'span',style:{indent:1},children:[]} ]));
  assert.throws(()=>normalizeRichText([{type:'p',onclick:'evil',children:[]} ]));
  const html=richTextToHTML([{type:'p',style:{color:'#AABBCC',indent:8},children:[child]}]);assert.match(html,/color:#aabbcc;margin-left:192px/);assert.doesNotMatch(html,/<script>/);
  assert.equal(richBody(null,'<기존>'),'&lt;기존&gt;');
});

test('DOM formatting survives JSON and safe HTML with RGB normalization and unchanged text',()=>{
  const root=element('div',[element('p',[element('span',[element('strong',[text('가상')])],{fontFamily:'"맑은 고딕"',fontSize:'24px',color:'rgb(170, 187, 204)',backgroundColor:'#FFFF00',position:'fixed'})],{textAlign:'center',marginLeft:'48px'})]);
  const json=richTextFromEditor(root);assert.deepEqual(json,[{type:'p',style:{textAlign:'center',indent:2},children:[{type:'span',style:{fontFamily:'맑은 고딕',fontSize:24,color:'#aabbcc',backgroundColor:'#ffff00'},children:[{type:'strong',children:[{type:'text',value:'가상'}]}]}]}]);
  assert.deepEqual(normalizeRichText(JSON.parse(JSON.stringify(json))),json);assert.equal(richTextToPlain(json),'가상');
  const html=richTextToHTML(json);assert.match(html,/font-family:맑은 고딕;font-size:24px;color:#aabbcc;background-color:#ffff00/);assert.match(html,/text-align:center;margin-left:48px/);assert.doesNotMatch(html,/position/);
  const reopened=element('div'),stack=[reopened];
  for(const token of html.match(/<[^>]+>|[^<]+/g)){
    if(token.startsWith('</'))stack.pop();
    else if(token.startsWith('<')){const style={};for(const pair of (token.match(/style="([^"]*)"/)?.[1]||'').split(';').filter(Boolean)){const [key,value]=pair.split(':');style[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;}const node=element(token.match(/^<(\w+)/)[1],[],style);stack.at(-1).append(node);stack.push(node);}
    else stack.at(-1).append(text(token));
  }
  assert.deepEqual(richTextFromEditor(reopened),json);
});

test('each inline control changes selected text, preserves surrounding text and emits bubbling input',()=>{
  for(const [key,value,expected] of [['fontFamily','Arial','Arial'],['fontSize','24',24],['color','#AABBCC','#aabbcc'],['backgroundColor','#FFFF00','#ffff00']]){
    const ui=fixture();ui.selection.active=range(ui.value,ui.value,0,2);ui.editor.onblur();ui.selection.removeAllRanges();ui.style(key,value);
    assert.deepEqual(ui.errors,[]);assert.equal(ui.api.value()[0].children[0].style[key],expected);assert.equal(ui.api.plain(),'가상 본문');assert.equal(ui.editor.events.at(-1).type,'input');assert.equal(ui.editor.events.at(-1).bubbles,true);
  }
});

test('alignment and bounded indentation persist, including caret-only paragraph formatting',()=>{
  const ui=fixture();ui.selection.active=range(ui.value,ui.value,1,1);
  for(const [command,expected] of [['alignLeft','left'],['alignCenter','center'],['alignRight','right'],['alignJustify','justify']]){ui.command(command);assert.equal(ui.api.value()[0].style.textAlign,expected);}
  for(let i=0;i<12;i++)ui.command('indent');assert.equal(ui.api.value()[0].style.indent,8);
  for(let i=0;i<12;i++)ui.command('outdent');assert.equal(ui.api.value()[0].style.indent,0);assert.deepEqual(ui.errors,[]);
});

test('repeated formatting of the same text reuses its span and stays below document depth limits',()=>{
  const ui=fixture();
  for(let i=0;i<40;i++){ui.style('fontSize',i%2?'24':'18');ui.style('color',i%2?'#ff0000':'#000000');assert.equal(ui.api.plain(),'가상 본문');}
  assert.deepEqual(ui.errors,[]);assert.equal(ui.editor.querySelectorAll('span').length,1);assert.equal(ui.api.value()[0].children[0].style.fontSize,24);
});

test('narrowing a partial selection repeatedly splits spans while preserving font and emphasis',()=>{
  const ui=fixture();ui.value.nodeValue='가'.repeat(80);const strong=element('strong');ui.paragraph.childNodes=[];ui.value.parentElement=null;strong.append(ui.value);ui.paragraph.append(strong);ui.selection.active=range(ui.value);ui.style('fontFamily','Arial');
  let selected=strong.firstChild.firstChild;
  for(let i=0;i<20;i++){
    ui.selection.active=range(selected,selected,1,selected.length-1);ui.style('color',i%2?'#ff0000':'#000000');
    const spans=strong.childNodes;selected=spans[Math.floor(spans.length/2)].firstChild;
    assert.equal(ui.api.plain(),'가'.repeat(80));assert.equal(ui.api.value()[0].children[0].type,'strong');assert.ok(spans.every(span=>span.childNodes.length===1&&span.firstChild.nodeType===3&&span.style.fontFamily==='Arial'));
  }
  assert.deepEqual(ui.errors,[]);assert.equal(strong.childNodes.length,41);
});

test('nested list selection formats both parent direct text and nested items',()=>{
  const ui=fixture(),nested=element('li',[text('하위')]),parent=element('li',[text('상위'),element('ul',[nested])]),list=element('ul',[parent]);ui.editor.childNodes=[];ui.editor.append(list);ui.selection.active=range(list,list,0,1);
  ui.command('alignRight');ui.command('indent');assert.deepEqual(ui.errors,[]);
  for(const item of [parent,nested]){assert.equal(item.style.textAlign,'right');assert.equal(item.style.marginLeft,'24px');}
  assert.equal(ui.api.plain(),'상위\n하위');
});

test('font selectors reset and the same color can be applied explicitly to a new selection',()=>{
  const ui=fixture(),control={dataset:{richStyle:'fontFamily'},value:'Arial'};ui.toolbar.onchange({target:{closest:()=>control}});assert.equal(control.value,'');
  const next=text('다음');ui.editor.append(element('p',[next]));ui.toolbar.querySelector=()=>({value:'#000000'});for(const selected of [ui.paragraph.firstChild.firstChild,next]){ui.selection.active=range(selected);ui.toolbar.onclick({target:{closest:selector=>selector==='[data-rich-apply]'?{dataset:{richApply:'color'}}:null}});}
  assert.deepEqual(ui.errors,[]);assert.equal(ui.api.value()[0].children[0].style.color,'#000000');assert.equal(ui.api.value()[1].children[0].style.color,'#000000');assert.equal(ui.editor.events.length,3);assert.match(richEditorMarkup('본문'),/data-rich-apply="color"/);
});

test('selection restoration, outside editor exclusion, locked actions and unsupported commands',()=>{
  const ui=fixture();ui.editor.onblur();ui.selection.removeAllRanges();ui.command('bold');assert.equal(ui.commands.length,1);
  ui.selection.active=range(ui.other.firstChild);ui.selection.rangeCount=1;ui.command('bold');ui.style('color','#ff0000');assert.equal(ui.commands.length,1);assert.equal(ui.errors.length,2);assert.equal(ui.other.firstChild.nodeValue,'외부');
  ui.selection.active=range(ui.value);ui.editor.contentEditable='false';for(const cmd of ['bold','insertTable','indent','alignLeft'])ui.command(cmd);ui.style('color','#ffffff');assert.equal(ui.commands.length,1);assert.equal(ui.api.plain(),'가상 본문');
  ui.editor.contentEditable='true';ui.editor.inert=true;ui.command('bold');assert.equal(ui.commands.length,1);ui.editor.inert=false;ui.command('insertHTML');assert.equal(ui.commands.length,1);
  assert.match(richEditorMarkup('본문'),/data-rich-style="fontFamily"/);assert.match(richEditorMarkup('본문'),/data-format="indent"/);
});
