import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRichText,richTextToPlain,richTextToHTML,richTextFromEditor} from '../public/rich-text.js';
import {mountRichEditor} from '../public/rich-editor.js';

const image={type:'image',attachmentId:7,fileVersion:'abcdef0123456789abcdef0123456789',alt:'사진 <설명> "안전"'};
const limits={allowBoardImages:true,imageUrl:item=>`/api/board-posts/1/attachments/${item.attachmentId}?v=${item.fileVersion}`};
const element=(tag,attributes={})=>({nodeType:1,tagName:tag,childNodes:[],style:{},getAttribute:key=>attributes[key]??null,hasAttribute:key=>Object.hasOwn(attributes,key),setAttribute:(key,value)=>attributes[key]=value});

test('board images are opt-in, bounded, and never store URLs',()=>{
  assert.throws(()=>normalizeRichText([image]));
  assert.deepEqual(normalizeRichText([image],limits),[image]);
  for(const patch of [{attachmentId:0},{attachmentId:1.5},{attachmentId:Number.MAX_SAFE_INTEGER+1},{fileVersion:'A'.repeat(32)},{fileVersion:'a'.repeat(31)},{alt:'x'.repeat(201)},{alt:null},{src:'https://external.test/image'}])assert.throws(()=>normalizeRichText([{...image,...patch}],limits));
  assert.throws(()=>normalizeRichText([image],{...limits,maxText:2}));
  assert.throws(()=>normalizeRichText([image],{...limits,maxBytes:2}));
  assert.equal(richTextToPlain([{type:'text',value:'앞'},image,{type:'text',value:'뒤'}],limits),`앞${image.alt}뒤`);
});

test('HTML uses escaped resolver URLs and safe image metadata',()=>{
  const html=richTextToHTML([image],limits);
  assert.match(html,/data-board-image-id="7"/);assert.match(html,/data-board-image-version="abcdef0123456789abcdef0123456789"/);
  assert.match(html,/alt="사진 &lt;설명&gt; &quot;안전&quot;"/);assert.match(html,/max-width:100%;height:auto/);
  assert.match(richTextToHTML([image],{...limits,imageUrl:()=>'/image?x="&y=1'}),/src="\/image\?x=&quot;&amp;y=1"/);
  assert.throws(()=>richTextToHTML([image],{allowBoardImages:true}));
  for(const url of ['https://external.test/a','//external.test/a','javascript:alert(1)','/\\external.test','/image\n',null])assert.throws(()=>richTextToHTML([image],{...limits,imageUrl:()=>url}));
});

test('editor accepts only opted-in tagged images and discards external sources',()=>{
  const img=element('IMG',{'data-board-image-id':'7','data-board-image-version':image.fileVersion,alt:image.alt,src:'https://untrusted.test/image'}),root={childNodes:[img,element('IMG',{src:'/image'}),element('SCRIPT')]};
  assert.deepEqual(richTextFromEditor(root),[]);assert.deepEqual(richTextFromEditor(root,limits),[image]);
  img.setAttribute('data-board-image-version','bad');assert.throws(()=>richTextFromEditor(root,limits));
});

function fixture(outside=false,options=limits){
  const editor=element('DIV'),other=element('DIV'),toolbar={};editor.childNodes=[{nodeType:3,nodeValue:'앞'},{nodeType:3,nodeValue:'뒤'}];other.childNodes=[{nodeType:3,nodeValue:'외부'}];
  const range=(container,start,end=start)=>({commonAncestorContainer:container,get startContainer(){return this.commonAncestorContainer;},get endContainer(){return this.commonAncestorContainer;},start,end,cloneRange(){return range(this.commonAncestorContainer,this.start,this.end);},selectNodeContents(node){this.commonAncestorContainer=node;this.start=0;this.end=node.childNodes.length;},collapse(front){this.start=front?this.start:this.end;this.end=this.start;},deleteContents(){this.commonAncestorContainer.childNodes.splice(this.start,this.end-this.start);this.end=this.start;},insertNode(node){this.commonAncestorContainer.childNodes.splice(this.start,0,node);},setStartAfter(node){this.start=this.commonAncestorContainer.childNodes.indexOf(node)+1;this.end=this.start;}});
  const original=range(outside?other:editor,1),selection={rangeCount:1,getRangeAt(){return this.active||original;},removeAllRanges(){this.rangeCount=0;},addRange(value){this.active=value;this.rangeCount=1;}};
  editor.contains=node=>node===editor||editor.childNodes.includes(node);editor.focus=()=>{};
  editor.ownerDocument={getSelection:()=>selection,createRange:()=>range(null,0),createElement:tag=>element(tag.toUpperCase()),createTextNode:value=>({nodeType:3,nodeValue:value})};
  editor.append=node=>editor.childNodes.push(node);
  const api=mountRichEditor({querySelector:selector=>selector==='[data-rich-editor]'?editor:toolbar},{limits:options});return {api,editor,other,selection,original};
}

test('insertion respects internal selection, keeps caret after image, and preserves outside content',()=>{
  for(const outside of [false,true]){
    const {api,editor,other,selection,original}=fixture(outside);api.insertBoardImage(image);
    const index=outside?2:1,img=editor.childNodes[index];assert.equal(img.tagName,'IMG');assert.equal(img.getAttribute('src'),limits.imageUrl(image));assert.equal(img.style.maxWidth,'100%');assert.equal(img.style.height,'auto');
    assert.deepEqual(api.value()[index],image);assert.equal(selection.active.start,index+1);assert.notEqual(selection.active,original);assert.equal(original.start,1);assert.equal(other.childNodes[0].nodeValue,'외부');
  }
});

test('image insertion restores the last editor range after focus moves to image controls',()=>{
  for(const event of ['onblur','onkeyup','onmouseup']){
    const {api,editor,selection,other,original}=fixture();editor[event]();original.commonAncestorContainer=other;selection.removeAllRanges();api.insertBoardImage(image);
    assert.equal(editor.childNodes[1].tagName,'IMG');assert.equal(selection.active.start,2);assert.equal(other.childNodes[0].nodeValue,'외부');
  }
});

test('detached and removed-node saved selections safely fall back to the end',()=>{
  for(const state of ['detached','stale']){
    const {api,editor,selection,original}=fixture();
    if(state==='stale')original.commonAncestorContainer=editor.childNodes[0];
    editor.onblur();selection.removeAllRanges();
    if(state==='detached')editor.isConnected=false;
    if(state==='stale')editor.childNodes.shift();
    const end=editor.childNodes.length;api.insertBoardImage(image);assert.equal(editor.childNodes[end].tagName,'IMG');assert.equal(selection.active.start,end+1);
  }
});

test('non-editable editors reject insertion without touching content, selection, or resolver',()=>{
  let calls=0;
  const {api,editor,selection,original}=fixture(false,{...limits,imageUrl:()=>{calls++;return '/image';}});
  editor.onblur();editor.contentEditable='false';const before=[...editor.childNodes];
  assert.throws(()=>api.insertBoardImage(image),/편집할 수 없는 상태/);
  assert.deepEqual(editor.childNodes,before);assert.equal(selection.getRangeAt(0),original);assert.equal(original.start,1);assert.equal(selection.rangeCount,1);assert.equal(selection.active,undefined);assert.equal(calls,0);
  editor.contentEditable='true';selection.removeAllRanges();api.insertBoardImage(image);assert.equal(editor.childNodes[1].tagName,'IMG');
});

test('invalid or disabled image insertion leaves content and selection unchanged; paste stays plain',()=>{
  for(const options of [undefined,{allowBoardImages:true},limits]){
    const {api,editor,selection}=fixture(false,options===undefined?{}:options),before=[...editor.childNodes];
    assert.throws(()=>api.insertBoardImage(options===limits?{...image,attachmentId:-1}:image));assert.deepEqual(editor.childNodes,before);assert.equal(selection.active,undefined);
  }
  const {editor}=fixture();let prevented=false;editor.onpaste({preventDefault(){prevented=true;},clipboardData:{getData:type=>{assert.equal(type,'text/plain');return '<img src=x onerror=alert(1)>';}}});
  assert.equal(prevented,true);assert.equal(editor.childNodes[1].nodeType,3);assert.equal(editor.childNodes[1].nodeValue,'<img src=x onerror=alert(1)>');
});
