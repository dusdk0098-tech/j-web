import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {boardImageLimits,mountBoardImagePicker} from '../public/board-inline-image.js';

test('본문 이미지 선택은 현재 글의 이미지와 버전만 사용하고 늦은 응답을 무시한다',async()=>{
  const previous=globalThis.document;class Element{constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;this.value='';}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(){}}
  globalThis.document={createElement:tag=>new Element(tag)};try{let row={id:7,version:'post-one'},active=true,resolve,inserted;const root=new Element('div'),editor={insertBoardImage:image=>{inserted=image;}},api=()=>new Promise(done=>{resolve=done;}),limits=boardImageLimits(()=>row,'/api/board-posts');
    const image={type:'image',attachmentId:3,fileVersion:'a'.repeat(32),alt:'가상.png'},first=limits.imageUrl(image);assert.match(first,/\/7\/attachments\/3\?/);assert.match(first,/version=post-one/);row={...row,version:'post-two'};assert.match(limits.imageUrl(image),/version=post-two/);
    let busy=true;mountBoardImagePicker(root,{row,base:'/api/board-posts',api,editor,active:()=>active,canInsert:()=>!busy});const select=root.children[0].children[0],button=root.children[1];resolve([{id:3,name:'가상.png',version:'a'.repeat(32),imageType:'image/png'},{id:4,name:'가상.txt',version:'b'.repeat(32),imageType:null}]);await new Promise(done=>setImmediate(done));assert.equal(select.children.length,1);select.value='0';button.onclick();assert.equal(inserted,undefined);busy=false;button.onclick();assert.deepEqual(inserted,image);
    mountBoardImagePicker(root,{row,base:'/api/board-posts',api,editor,active:()=>active});const pendingButton=root.children[1];active=false;resolve([{id:3,name:'가상.png',version:'a'.repeat(32),imageType:'image/png'}]);await new Promise(done=>setImmediate(done));assert.equal(pendingButton.disabled,true);
  }finally{globalThis.document=previous;}
});

test('관리자 게시글 저장 대기 중 본문과 이미지 삽입을 잠그고 실패 후 복원한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('    const edit=row=>{let editor,busy=false;'),end=source.indexOf("\n    $('#board-add')",start);assert.ok(start>=0&&end>start);
  const picker={isConnected:true},editable={contentEditable:'true'},controls=[{disabled:false},{disabled:true}],root={querySelector:selector=>selector==='[data-board-image-picker]'?picker:editable,querySelectorAll:()=>controls},dialog={open:true},state={page:'board',boardKind:'notice'};let submit,pickerOptions,reject;
  const context={state,dialog,kind:'notice',row:{id:3,version:'version'},$:selector=>selector==='#dialog-body'?root:{textContent:''},field:()=>'',richEditorMarkup:()=>'',showDialog:(_title,_html,callback)=>{submit=callback;},mountRichEditor:()=>({set(){},value:()=>[{type:'text',value:'내용'}]}),boardImageLimits:()=>({}),mountBoardImagePicker:(_node,options)=>{pickerOptions=options;},api:()=>new Promise((_resolve,fail)=>{reject=fail;}),JSON};
  runInNewContext(source.slice(start,end)+';edit(row);',context);assert.equal(pickerOptions.canInsert(),true);const pending=submit({shared:'on'});assert.equal(editable.contentEditable,'false');assert.deepEqual(controls.map(c=>c.disabled),[true,true]);assert.equal(pickerOptions.active(),true);assert.equal(pickerOptions.canInsert(),false);reject(Error('시험 실패'));await assert.rejects(pending,/시험 실패/);assert.equal(editable.contentEditable,'true');assert.deepEqual(controls.map(c=>c.disabled),[false,true]);assert.equal(pickerOptions.canInsert(),true);
});
