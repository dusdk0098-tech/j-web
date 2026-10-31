import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { CommonWork } from '../common-work.js';
import { mountCommonWork } from '../public/common-work-view.js';
import { showCommonWorkPreview } from '../public/common-work-print.js';

function fakeDocument(){
  const state={prints:0,frames:[],last:null};
  const doc={body:{append(dialog){state.last=dialog;}},querySelector(){return state.last?.open?state.last:null;},defaultView:{print(){state.prints++;},requestAnimationFrame(callback){state.frames.push(callback);}},createElement(){
    const buttons={'[data-preview-close]':{},'[data-preview-print]':{},'[data-preview-status]':{}};return {open:false,removed:false,buttons,setAttribute(){},querySelector(selector){return buttons[selector];},addEventListener(type,callback){if(type==='close')this.onclose=callback;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.removed=true;}};
  }};return {doc,state};
}

test('선택 업무 미리보기는 현장·작성자·변경 상태를 다시 확인한다',()=>{
  const store=new Store(':memory:');try{
    const work=new CommonWork(store.db),site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),make=(siteId,id)=>store.createReviewer({siteId,loginId:id,name:id,password:'virtual-password-123'});
    const first=make(site.id,'preview_first'),second=make(site.id,'preview_second'),foreign=make(other.id,'preview_foreign'),input={date:'2026-10-31',category:'공정회의',process:'가상 공정',content:'가상 내용',status:'published'};
    const published=work.create(site.id,{...input,title:'게시 업무'},()=>{},first),draft=work.create(site.id,{...input,title:'임시 업무',status:'draft'},()=>{},first),outside=work.create(other.id,{...input,title:'다른 현장'},()=>{},foreign),chosen=rows=>rows.map(row=>({id:row.id,version:row.version}));
    const preview=work.preview(site.id,chosen([draft,published]),first);assert.equal(preview.siteName,'가상 현장');assert.deepEqual(preview.items.map(item=>item.id),[draft.id,published.id]);assert.equal(preview.items[0].content,'가상 내용');
    assert.throws(()=>work.preview(site.id,chosen([draft]),second),/확인/);assert.throws(()=>work.preview(site.id,chosen([outside]),first),/확인/);assert.throws(()=>work.preview(site.id,chosen([published,published]),first),/선택/);
    assert.throws(()=>work.preview(site.id,[],first),/선택/);assert.throws(()=>work.preview(site.id,Array.from({length:21},(_,i)=>({id:i+1,version:'가상'})),first),/선택/);assert.throws(()=>work.preview(site.id,[{id:'1',version:'가상'}],first),/선택/);
    work.addComment(site.id,published.id,{version:published.version,content:'새 의견'},()=>{},second);assert.throws(()=>work.preview(site.id,chosen([published]),first),error=>error.sessionStatus===409);
    const latest=work.get(site.id,published.id,first),result=work.preview(site.id,chosen([latest]),first);assert.equal(result.items[0].comments[0].content,'새 의견');
  }finally{store.close();}
});

test('선택 업무 미리보기는 가상 내용을 안전하게 표시하고 인쇄를 요청한다',()=>{
  const {doc,state}=fakeDocument(),item={id:1,title:'가상 <제목>',date:'2026-10-31',category:'공정회의',process:'가상 공정',author_id:null,author_name:null,status:'published',content:'<script>내용</script>',rich_content:null,files:[{name:'<파일>.txt'}],comments:[{author_id:null,author_name:null,created_at:'가상 시각',content:'<의견>',files:[]}]};
  let active=true;const dialog=showCommonWorkPreview(doc,{siteName:'가상 <현장>',items:[item]},{autoPrint:true,active:()=>active});assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/가상 &lt;현장&gt;/);assert.match(dialog.innerHTML,/&lt;script&gt;내용&lt;\/script&gt;/);assert.match(dialog.innerHTML,/&lt;파일&gt;\.txt/);assert.match(dialog.innerHTML,/&lt;의견&gt;/);assert.doesNotMatch(dialog.innerHTML,/<script>/);
  assert.throws(()=>showCommonWorkPreview(doc,{siteName:'현장',items:[]}),/먼저 닫아/);active=false;state.frames.shift()();assert.equal(state.prints,0);dialog.buttons['[data-preview-print]'].onclick();assert.equal(state.prints,1);dialog.buttons['[data-preview-close]'].onclick();assert.equal(dialog.removed,true);
});

test('선택 보기와 인쇄는 현재 목록의 버전을 보내고 늦은 선택 변경을 거절한다',async()=>{
  const {doc,state}=fakeDocument(),row={id:1,version:'가상버전',date:'2026-10-31',category:'공정회의',process:'가상 공정',title:'가상 업무',status:'published',author_id:null,author_name:null,content:'가상 내용',rich_content:null,files:[],comments:[]},result={siteName:'가상 현장',items:[row]};
  const select={checked:false,dataset:{workSelect:'1'}},card={querySelector:()=>null,querySelectorAll:()=>[]};let controls={},html='',posted,delay=false,release;
  const target={isConnected:true,ownerDocument:doc,set innerHTML(value){html=value;controls={'[data-work-form]':{elements:{status:{querySelector:()=>({})}}},'[data-work-status]':{},'[data-work-cancel]':{},'[data-rich-editor]':{ownerDocument:doc},'[data-rich-toolbar]':{},'[data-work-search]':{},'[data-work-from]':{value:''},'[data-work-to]':{value:''},'[data-work-category]':{value:''},'[data-work-process]':{value:''},'[data-work-author]':{value:''},'[data-work-query]':{value:''},'[data-work-select-all]':{},'[data-work-preview]':{},'[data-work-print]':{}};},querySelector(selector){return selector==='[data-work-id="1"]'?card:controls[selector];},querySelectorAll(selector){return selector==='[data-work-select]'?[select]:selector==='[data-work-select]:checked'&&select.checked?[select]:[];}};
  const api=async(path,options={})=>{const url=new URL(path,'http://example.test');if(url.pathname.endsWith('/authors'))return [];if(url.pathname.endsWith('/preview')){posted=JSON.parse(options.body);if(delay)return new Promise(resolve=>{release=resolve;});return result;}return [row];};
  await mountCommonWork({target,base:'/api/common-work',siteId:3,api});assert.match(html,/data-work-select="1"/);controls['[data-work-select-all]'].onclick();assert.equal(select.checked,true);
  await controls['[data-work-preview]'].onclick();assert.deepEqual(posted,{siteId:3,items:[{id:1,version:'가상버전'}]});assert.equal(state.last.open,true);assert.equal(state.prints,0);state.last.close();
  await controls['[data-work-print]'].onclick();assert.equal(state.last.open,true);state.frames.shift()();assert.equal(state.prints,1);state.last.close();
  delay=true;const pending=controls['[data-work-preview]'].onclick();select.checked=false;release(result);await pending;assert.match(controls['[data-work-status]'].textContent,/선택이 변경/);assert.equal(state.last.open,false);assert.equal(controls['[data-work-preview]'].disabled,false);
});
