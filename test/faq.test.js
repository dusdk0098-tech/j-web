import { faqPage,faqPager } from '../public/faq-pages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('FAQ 이관과 분류·검색·구형 수정·첨부·댓글·충돌 보존',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-faq-')),file=join(dir,'test.sqlite');let store=new Store(file);
  try{
    const legacy=store.saveBoardPost({kind:'notice',title:'가상 기존 공지',body:'기존 내용',secret:false});store.close();const old=new DatabaseSync(file);old.exec('ALTER TABLE board_posts DROP COLUMN category');old.close();store=new Store(file);
    assert.equal(store.boardPosts('notice')[0].id,legacy.id);assert.equal(store.boardPosts('notice')[0].shared,0);
    const site=store.createSite({name:'가상 현장'}),actor=store.createReviewer({siteId:site.id,loginId:'faq_actor',name:'가상 직원',password:'virtual-password-123'}),input={kind:'faq',title:'가상 검색 안내',body:'가상 내용',secret:false};
    const hidden=store.saveBoardPost({...input,category:'결제'}),visible=store.saveBoardPost({...input,category:'서비스이용',shared:true});
    assert.deepEqual(store.reviewerBoardPosts(actor,'faq','검색','결제'),[]);assert.deepEqual(store.reviewerBoardPosts(actor,'faq','검색','서비스이용').map(r=>r.id),[visible.id]);assert.deepEqual(store.boardPosts('faq','검색','결제').map(r=>r.id),[hidden.id]);assert.deepEqual(store.boardPosts('faq','없는말','결제'),[]);assert.equal(store.boardPosts('notice').length,1);
    const updated=store.saveBoardPost({...input,title:'가상 구형 수정',expectedVersion:hidden.version},hidden.id);assert.equal(updated.category,'결제');assert.equal(updated.shared,0);assert.throws(()=>store.saveBoardPost({...input,category:'서비스이용',expectedVersion:hidden.version},hidden.id),e=>e.sessionStatus===409);assert.equal(store.boardPosts('faq','','결제')[0].title,'가상 구형 수정');
    for(const category of ['전체','비밀분류',null,{},''])assert.throws(()=>store.saveBoardPost({...input,category}));assert.throws(()=>store.boardPosts('faq','','비밀분류'));assert.throws(()=>store.saveReviewerBoardPost(actor,input));assert.throws(()=>store.deleteReviewerBoardPost(actor,'faq',visible.id,visible.version));
    store.addBoardComment(visible.id,{body:'가상 댓글',postVersion:visible.version},actor);assert.equal(store.boardComments(visible.id,visible.version,actor).length,1);store.addBoardAttachment(visible.id,visible.version,'가상.txt',Buffer.from('virtual'));assert.equal(store.boardAttachments(visible.id,visible.version,actor).length,1);assert.throws(()=>store.boardAttachments(hidden.id,updated.version,actor));assert.throws(()=>store.boardComments(hidden.id,updated.version,actor));assert.throws(()=>store.addBoardAttachment(visible.id,visible.version,'가상.txt',Buffer.from('virtual'),actor));
    store.close();store=new Store(file);assert.equal(store.boardPosts('faq','','결제')[0].category,'결제');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('관리자 FAQ 작성 화면 대역: 선택 분류 표시·실패 후 재시도 보존',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('    const edit=row=>{let editor,creation,busy=false;'),end=source.indexOf("\n    $('#board-add')",start);
  const picker={isConnected:true},editable={contentEditable:'true'},control={disabled:false},root={querySelector:s=>s==='[data-board-image-picker]'?picker:editable,querySelectorAll:()=>[control]},state={page:'board',boardKind:'faq',boardCategory:'결제',siteId:1};let html,submit,request;
  const context={detailEpoch:0,state,dialog:{open:true},kind:'faq',$:s=>s==='#dialog-body'?root:{textContent:''},field:()=>'',richEditorMarkup:()=>'',boardCreateMarkup:'',boardCreation:()=>({value:async()=>({})}),showDialog:(_title,markup,callback)=>{html=markup;submit=callback;},mountRichEditor:()=>({set(){},value:()=>[]}),boardImageLimits:()=>({}),mountBoardImagePicker(){},api:async(_url,options)=>{request=JSON.parse(options.body);throw Error('가상 실패');},JSON};
  runInNewContext(source.slice(start,end)+';edit(null);',context);assert.match(html,/<option value="결제" selected>/);assert.match(html,/관리자만 작성/);
  for(let i=0;i<2;i++){await assert.rejects(submit({category:'결제',title:'가상 제목',shared:'on'}),/가상 실패/);assert.equal(request.category,'결제');assert.equal(request.shared,true);assert.equal(control.disabled,false);assert.equal(state.boardCategory,'결제');}
  context.row={id:1,category:'서비스이용',version:'a'};runInNewContext('edit(row);',context);assert.match(html,/<option value="서비스이용" selected>/);
});

test('FAQ HTTP는 관리자 공개·직원 조회와 쓰기 거부를 보장한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-board-reviewer-api-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json(),otherSite=await (await send('/api/sites','POST',{name:'다른 가상 현장'},admin)).json(),make=async(siteId,id)=>await (await send('/api/reviewers','POST',{siteId,loginId:id,name:id,password:'virtual-password-123'},admin)).json(),author=await make(site.id,'board_api_author'),other=await make(otherSite.id,'board_api_other'),login=async id=>(await send('/api/reviewer/login','POST',{loginId:id,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],one=await login(author.login_id),two=await login(other.login_id),path='/api/reviewer/board-posts',secret={kind:'question',title:'가상 비밀',body:'<script>가상 내용</script>',secret:true};
    assert.equal((await send(`${path}?kind=question`)).status,401);assert.equal((await send('/board-view.js')).status,200);assert.equal((await send(path,'POST',{...secret,kind:'notice',secret:false},one)).status,403);const created=await send(path,'POST',secret,one);assert.equal(created.status,201);const row=await created.json();assert.equal((await (await send(`${path}?kind=question`,'GET',undefined,one)).json())[0].body,secret.body);assert.deepEqual(await (await send(`${path}?kind=question&q=${encodeURIComponent('가상')}`,'GET',undefined,two)).json(),[]);assert.equal((await send(`${path}/${row.id}`,'PUT',{...secret,version:row.version},two)).status,400);assert.equal((await send(`${path}/${row.id}`,'DELETE',{kind:'question',version:row.version},two)).status,400);
    const adminRows=await (await send('/api/board-posts?kind=question','GET',undefined,admin)).json();assert.equal(adminRows[0].body,secret.body);assert.equal((await send(`/api/board-posts/${row.id}`,'PUT',{...secret,title:'관리자 수정'},admin)).status,200);assert.equal((await send(`${path}/${row.id}`,'PUT',{...secret,version:row.version},one)).status,409);const current=(await (await send(`${path}?kind=question`,'GET',undefined,one)).json())[0];assert.equal(current.title,'관리자 수정');assert.equal((await send(`${path}/${row.id}`,'DELETE',{kind:'question',version:current.version},one)).status,200);
    const systemInput={kind:'faq',category:'결제',title:'가상 시스템 공지',body:'가상 시스템 내용',secret:false,shared:false};
    const draftResponse=await send('/api/board-posts','POST',systemInput,admin);assert.equal(draftResponse.status,201);const systemDraft=await draftResponse.json();
    assert.deepEqual(await (await send(`${path}?kind=faq`,'GET',undefined,two)).json(),[]);
    assert.equal((await send(path,'POST',{...systemInput,shared:true},one)).status,400);
    assert.equal((await send(`${path}/${systemDraft.id}`,'PUT',{...systemInput,version:systemDraft.version},one)).status,400);
    assert.equal((await send(`${path}/${systemDraft.id}`,'DELETE',{kind:'faq',version:systemDraft.version},one)).status,400);
    const publish=await send(`/api/board-posts/${systemDraft.id}`,'PUT',{...systemInput,shared:true,expectedVersion:systemDraft.version},admin);assert.equal(publish.status,200);const published=await publish.json();
    assert.equal((await (await send(`${path}?kind=faq&q=${encodeURIComponent('시스템')}`,'GET',undefined,two)).json())[0].id,published.id);
    assert.deepEqual(await (await send(path+'?'+new URLSearchParams({kind:'faq',q:'시스템',category:'서비스이용'}),'GET',undefined,two)).json(),[]);
    assert.equal((await (await send(path+'?'+new URLSearchParams({kind:'faq',q:'시스템',category:'결제'}),'GET',undefined,two)).json())[0].id,published.id);
    assert.equal((await send(path+'?'+new URLSearchParams({kind:'faq',category:'비밀분류'}),'GET',undefined,two)).status,400);
    assert.deepEqual(await (await send(`${path}?kind=notice`,'GET',undefined,two)).json(),[]);
    assert.equal((await send(`${path}/${published.id}`,'PUT',{...secret,version:published.version},one)).status,400);
    assert.equal((await send(`/api/board-posts/${published.id}`,'DELETE',{kind:'faq',expectedVersion:published.version},admin)).status,200);
    assert.deepEqual(await (await send(`${path}?kind=faq`,'GET',undefined,two)).json(),[]);
    for(let i=1;i<=25;i++){const result=await send('/api/board-posts','POST',{kind:'faq',category:i<=12?'서비스이용':'결제',title:'페이지 가상 '+i,body:'페이지 검증',secret:false,shared:i<=23},admin);assert.equal(result.status,201);}
    const adminFaq=await (await send('/api/board-posts?kind=faq','GET',undefined,admin)).json(),staffFaq=await (await send(path+'?kind=faq','GET',undefined,one)).json();
    assert.equal(adminFaq.length,25);assert.equal(staffFaq.length,23);assert.equal(staffFaq.some(row=>['페이지 가상 24','페이지 가상 25'].includes(row.title)),false);const moduleResponse=await send('/faq-pages.js');assert.equal(moduleResponse.status,200);assert.match(moduleResponse.headers.get('content-type'),/javascript/);assert.match(await moduleResponse.text(),/export function faqPage/);
    for(const rows of [adminFaq,staffFaq]){assert.deepEqual([1,2,3].flatMap(page=>faqPage(rows,page).rows.map(row=>row.id)),rows.map(row=>row.id));assert.equal(faqPage(rows,3).rows.length,rows.length-20);}
    const filtered=await (await send(path+'?'+new URLSearchParams({kind:'faq',category:'서비스이용',q:'페이지'}),'GET',undefined,one)).json();assert.equal(filtered.length,12);assert.equal(faqPage(filtered,2).rows.length,2);assert.equal(filtered.every(row=>row.category==='서비스이용'),true);
    const searched=await (await send(path+'?'+new URLSearchParams({kind:'faq',category:'결제',q:'페이지 가상 23'}),'GET',undefined,one)).json();assert.equal(searched.length,1);assert.equal(faqPage(searched,3).page,1);
    const publicRow=await (await send('/api/board-posts','POST',{kind:'notice',title:'가상 공개 공지',body:'공지',secret:false,shared:true},admin)).json();assert.equal((await (await send(`${path}?kind=notice`,'GET',undefined,two)).json())[0].id,publicRow.id);assert.equal((await send(`/api/reviewers/${other.id}`,'PUT',{siteId:otherSite.id,active:false},admin)).status,200);assert.equal((await send(`${path}?kind=notice`,'GET',undefined,two)).status,401);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});


test('직원 FAQ 화면 대역: 작성 숨김·분류와 검색 독립·늦은 응답 무시',async()=>{
 const source=readFileSync(new URL('../public/board-view.js',import.meta.url),'utf8'),sync=source.slice(source.indexOf('sync=()=>{'),source.indexOf('\n  const load=')),start=source.indexOf('  const load='),end=source.indexOf('\n  category.onchange',start),kind={value:'faq'},category={value:'결제'},query={value:'가상 검색'},form={hidden:false,elements:{secret:{checked:false}}},list={innerHTML:'',textContent:'',querySelectorAll:()=>[],querySelector:()=>({}),insertAdjacentHTML(){}},requests=[];
 const context={faqPage,faqPager,kind,category,query,form,list,categoryLabel:{hidden:true},secretLabel:{},live:()=>true,URLSearchParams,Promise,api:async url=>{requests.push(url);return [];}};
 await runInNewContext('let sequence=0,faqPageNumber=1,canWriteNotice=false;const '+sync+'\n'+source.slice(start,end)+'\nload();',context);
 assert.equal(form.hidden,true);assert.equal(context.categoryLabel.hidden,false);assert.equal(new URL(requests.at(-1),'http://local').searchParams.get('category'),'결제');assert.equal(new URL(requests.at(-1),'http://local').searchParams.get('q'),'가상 검색');
 category.value='서비스이용';await runInNewContext('load();',context);assert.equal(query.value,'가상 검색');assert.equal(new URL(requests.at(-1),'http://local').searchParams.get('category'),'서비스이용');
 query.value='다른 검색';await runInNewContext('load();',context);assert.equal(category.value,'서비스이용');assert.equal(new URL(requests.at(-1),'http://local').searchParams.get('q'),'다른 검색');
 let resolve;context.api=()=>new Promise(done=>{resolve=done;});const pending=runInNewContext('load();',context);category.value='결제';list.innerHTML='새 분류 화면';resolve([]);await pending;assert.equal(list.innerHTML,'새 분류 화면');
});

test('관리자 FAQ 목록 화면 대역: 검색과 분류를 독립 적용',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(state.page==='board'){"),end=source.indexOf("  if(state.page==='schedules'){",start),state={page:'board',boardKind:'faq',boardCategory:'결제',query:'가상 검색'},nodes={},content={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>({})},requests=[];
 const context={faqPage,faqPager,detailEpoch:0,renderEpoch:0,state,content,URLSearchParams,api:async url=>{requests.push(url);return [];},esc:String,$:selector=>nodes[selector]??=( {} ),render:async()=>{},showError:()=>{}};
 await runInNewContext('(async()=>{'+source.slice(start,end)+'})();',context);assert.match(content.innerHTML,/value="결제" selected/);assert.equal(new URL(requests[0],'http://local').searchParams.get('q'),'가상 검색');assert.equal(new URL(requests[0],'http://local').searchParams.get('category'),'결제');
 nodes['#board-category'].onchange({target:{value:'서비스이용'}});assert.equal(state.query,'가상 검색');assert.equal(state.boardCategory,'서비스이용');context.$('#board-query').value='다른 검색';nodes['#board-search'].onclick();assert.equal(state.query,'다른 검색');assert.equal(state.boardCategory,'서비스이용');
});
