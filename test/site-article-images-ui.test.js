import test from 'node:test';
import assert from 'node:assert/strict';
import {siteArticleImageLimits,mountSiteArticleImagePicker} from '../public/site-article-images.js';
import {richBody} from '../public/rich-editor.js';

test('같은 글의 첨부 이미지만 본문에 넣고 화면 이탈 후에는 넣지 않는다',()=>{
  const original=globalThis.document,make=()=>({children:[],value:'0',isConnected:true,append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){}});globalThis.document={createElement:make};
  try{
    const file={id:4,name:'가상 <사진>.png',version:'a'.repeat(32),imageType:'image/png'},row={id:2,files:[file,{id:5,name:'문서.pdf',imageType:null}]},container=make(),inserted=[];let live=true;
    mountSiteArticleImagePicker(container,{row,editor:{insertBoardImage:image=>inserted.push(image)},active:()=>live});const [label,button,status]=container.children,select=label.children[0];assert.equal(select.children.length,1);assert.equal(select.children[0].textContent,file.name);button.onclick();assert.equal(inserted.length,1);assert.equal(inserted[0].fileVersion,file.version);assert.match(status.textContent,/저장/);
    const html=richBody([{type:'p',children:[inserted[0]]}],'',siteArticleImageLimits(()=>row,7));assert.match(html,/\/api\/site-articles\/2\/files\/4\?/);assert.match(html,/siteId=7/);assert.match(html,/가상 &lt;사진&gt;/);assert.match(richBody([{type:'p',children:[inserted[0]]}],'',siteArticleImageLimits(()=>row,null,true)),/\/api\/worker\/articles\/2\/files\/4/);
    live=false;button.onclick();assert.equal(inserted.length,1);
  }finally{globalThis.document=original;}
});
