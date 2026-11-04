import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {freezeBatchImages} from '../public/batch-images.js';
import {prepareWorkerPdfs} from '../public/plan-pdf.js';
import {reloadDailyBatchRows,dailyBatchReport,hazardReportBody,joinedBatchPreview} from '../public/batch-print.js';
import {workerPreviewArticles} from '../public/worker-preview.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function showBatchPreview('),app.indexOf('async function renderDailyTrainingStatistics('));
function harness(){
  const nodes={},errors=[],reads=[],state={siteId:1,page:'documents',detail:null,admin:{id:1}};
  const values=new Map([['/api/documents/1',{id:1,site_id:1,edit_version:1}],['/api/documents/1/attachments',[{id:2,name:'가상 파일'}]],['/api/documents/1/tbm-signature',{hasSignature:true,createdAt:'가상 시각'}]]);
  let prints=0,session={authenticated:true,admin:{scope:'global'},context:'virtual-session'},gate=null;
  const api=async path=>{reads.push(path);if(gate)await gate;if(path==='/api/session')return session;if(!session.authenticated)throw Error('로그인 만료');if(!values.has(path))throw Error('미예상 조회');return structuredClone(values.get(path));};
  const context={detailEpoch:0,state,adminSession:Promise.resolve({context:'virtual-session'}),api,reloadDailyBatchRows,dailyBatchReport,hazardReportBody,joinedBatchPreview,prepareWorkerPdfs,esc:value=>String(value??''),
    freezeBatchImages:async()=>({dispose(){},check:async()=>{}}),
    content:{style:{},children:[],append(){},querySelectorAll:()=>[]},document:{body:{inert:false},createDocumentFragment:()=>({append(){},querySelectorAll:()=>[]}),createElement:()=>({append(){},querySelectorAll:()=>[]})},
    $:id=>nodes[id]??={},flash(){},showError:error=>errors.push(error.message),window:{print(){prints++;}},render:async()=>{},
    renderDetail:async capture=>{context.detailEpoch++;const doc=await capture('/api/documents/1');await capture('/api/documents/1/attachments');await capture('/api/documents/1/tbm-signature');return doc;}};
  runInNewContext(source,context);
  return {context,state,values,errors,reads,nodes,prints:()=>prints,session:value=>{session=value;},gate:value=>{gate=value;},prepare:()=>context.showBatchPreview([1]),print:()=>nodes['#batch-print'].onclick()};
}
test('일반 문서 미리보기는 문서·첨부·서명 응답 변경과 세션 철회 뒤 인쇄하지 않는다',async()=>{
  for(const change of [h=>h.values.get('/api/documents/1').edit_version++,h=>h.values.get('/api/documents/1/attachments').push({id:3}),h=>h.values.get('/api/documents/1/tbm-signature').hasSignature=false,h=>h.session({authenticated:false}),h=>h.session({authenticated:true,admin:{scope:'restricted'},context:'virtual-session'}),h=>h.session({authenticated:true,admin:{scope:'global'},context:'new-session'})]){
    const h=harness();await h.prepare();change(h);await h.print();assert.equal(h.prints(),0);assert.equal(h.errors.length,1);assert.match(h.errors[0],/변경|로그인/);assert.equal(h.nodes['#batch-print'].disabled,false);
  }
});
test('조회 실패 재시도·중복 클릭·A→B→A 화면 이동을 보호한다',async()=>{
  const h=harness();await h.prepare();h.gate(Promise.reject(Error('가상 조회 실패')));await h.print();assert.equal(h.prints(),0);assert.match(h.errors.at(-1),/가상 조회 실패/);h.gate(null);await h.print();assert.equal(h.prints(),1);
  let release;h.gate(new Promise(resolve=>{release=resolve;}));const first=h.print(),second=h.print();release();await Promise.all([first,second]);assert.equal(h.prints(),2);
  h.gate(new Promise(resolve=>{release=resolve;}));const stale=h.print();h.state.page='workers';h.context.detailEpoch++;h.state.page='documents';h.context.detailEpoch++;release();await stale;assert.equal(h.prints(),2);
});
test('준비 중 첫 문서가 바뀌면 미리보기를 게시하지 않는다',async()=>{
  const h=harness(),original=h.context.renderDetail;h.context.renderDetail=async read=>{const doc=await original(read);h.values.get('/api/documents/1').edit_version++;return doc;};await assert.rejects(h.prepare,/출력 자료가 변경/);assert.equal(h.nodes['#batch-print'],undefined);assert.equal(h.context.document.body.inert,false);
});
test('자동 인쇄도 직전 문서 변경을 확인한 뒤 인쇄한다',async()=>{
  const good=harness();await good.context.showBatchPreview([1],[],1,false,null,true);assert.equal(good.prints(),1);
  const stale=harness();stale.context.freezeBatchImages=async()=>({dispose(){},check:async()=>{stale.values.get('/api/documents/1').edit_version++;}});await stale.context.showBatchPreview([1],[],1,false,null,true);assert.equal(stale.prints(),0);assert.match(stale.errors.at(-1),/출력 자료가 변경/);
});
test('신고 단독과 문서·신고 자동 인쇄는 신고가 바뀌면 중단한다',async()=>{
  for(const ids of [[],[1]])for(const change of [false,true]){
    const h=harness(),reports=[{id:3,title:'가상 신고',body:'가상 내용',reporter:'가상 신고자',status:'received',replies:[]}];h.values.set('/api/sites/1/hazard-reports',reports);
    if(change)h.context.freezeBatchImages=async()=>({dispose(){},check:async()=>{reports[0].replies.push({id:4,body:'새 가상 답변'});}});
    await h.context.showBatchPreview(ids,structuredClone(reports),1,false,null,true);
    assert.equal(h.prints(),change?0:1);if(change)assert.match(h.errors.at(-1),/위험신고가 변경/);
  }
});
test('이미지는 조회 바이트로 고정하고 같은 초 교체도 차단하며 URL을 해제한다',async()=>{
  let bytes='first',active=true;const revoked=[],options=[],image={getAttribute:()=>'/api/documents/1/tbm-signature/image',decode:async()=>{}};
  const dependencies={fetchImage:async(path,init)=>{options.push(init);return new Response(new Blob([bytes],{type:'image/png'}));},urls:{createObjectURL:()=> 'blob:virtual',revokeObjectURL:url=>revoked.push(url)}};
  const snapshot=await freezeBatchImages([image],()=>active,dependencies);assert.equal(image.src,'blob:virtual');await snapshot.check();bytes='second';await assert.rejects(snapshot.check,/이미지가 변경/);snapshot.dispose();snapshot.dispose();assert.deepEqual(revoked,['blob:virtual']);assert.ok(options.every(option=>option.cache==='no-store'&&option.redirect==='error'));
  active=false;const stale=await freezeBatchImages([image],()=>active,dependencies);await stale.check();assert.deepEqual(revoked,['blob:virtual']);
});

test('보호구 요약·상세·출역과 신고 답변은 동일 현장 자료 변경 뒤 인쇄하지 않는다',async()=>{
  for(const kind of ['ppe-summary','ppe-detail','attendance','hazard']){
    const h=harness(),site={id:1,name:'가상 현장'},date='2026-11-01',ppe=[{date,item:'안전모',quantity:1,worker:{name:'가상 근로자'}}],attendance=[{id:1,name:'가상 근로자',present:true}],hazards=[{id:1,title:'가상 의견',body:'본문',replies:[]}];
    h.values.set('/api/ppe-issues?siteId=1&month=2026-11',{rows:ppe});h.values.set('/api/attendance?siteId=1&date='+date,attendance);h.values.set('/api/sites/1/hazard-reports',hazards);
    const report={kind,site,date,rows:kind==='ppe-summary'?[{item:'안전모',quantity:1}]:structuredClone(kind==='attendance'?attendance:ppe)};
    await h.context.showBatchPreview([],kind==='hazard'?structuredClone(hazards):[],1,false,null,false,kind==='hazard'?[]:[report]);await h.print();assert.equal(h.prints(),1);
    if(kind==='hazard')hazards[0].replies.push({id:1,body:'새 답변'});else if(kind==='attendance')attendance[0].present=false;else ppe[0].quantity=2;
    await h.print();assert.equal(h.prints(),1);assert.match(h.errors.at(-1),/보고서가 변경|위험신고가 변경/);
  }
});

test('가입 서류 helper의 data PNG 서명은 외부 조회 없이 고정하고 잘못된 data 주소는 거절한다',async()=>{
  const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  const worker={id:1,site_id:1,name:'가상 가입자',category:'직영',company:'가상 회사',occupation:'가상 직종',signature,join:{equipment:[],created_at:'2026-11-01 00:00:00'},ppe:[],files:[]},markup=workerPreviewArticles([worker]);
  assert.ok(markup.includes(signature));const image={getAttribute:()=>signature,decode:async()=>{}},revoked=[];
  const frozen=await freezeBatchImages([image],()=>true,{fetchImage:()=>{throw Error('data 서명은 네트워크 요청하지 않음');},urls:{createObjectURL:()=> 'blob:joined',revokeObjectURL:url=>revoked.push(url)}});assert.equal(image.src,'blob:joined');await frozen.check();frozen.dispose();assert.deepEqual(revoked,['blob:joined']);
  for(const source of ['data:text/html;base64,WA==','data:image/svg+xml;base64,WA==','data:image/png;base64,@@','https://external.invalid/image'])await assert.rejects(()=>freezeBatchImages([{getAttribute:()=>source}],()=>true),/이미지/);
  const h=harness(),groups=[],record={id:1,site_id:1,version:'virtual-version',joined_at:'2026-11-01 00:00:00'};
  h.context.document.createDocumentFragment=()=>({append:group=>groups.push(group),querySelectorAll:()=>groups.flatMap(group=>[...group.innerHTML.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match=>({getAttribute:()=>match[1],decode:async()=>{}})))});
  h.context.freezeBatchImages=(images,active)=>freezeBatchImages(images,active,{fetchImage:()=>{throw Error('data 서명 외부 요청');},urls:{createObjectURL:()=> 'blob:joined-ui',revokeObjectURL(){}}});
  h.values.set('/api/workers/joined-on?siteId=1&date=2026-11-01',[record]);h.values.set('/api/workers/preview',{workers:[worker]});
  await h.context.showBatchPreview([],[],1,false,null,false,[{kind:'joined-worker',site:{id:1,name:'가상 현장'},date:'2026-11-01',worker:record}]);await h.print();assert.equal(h.prints(),1);
  worker.signature=signature.replace('iVBOR','aVBOR');await h.print();assert.equal(h.prints(),1);assert.match(h.errors.at(-1),/가입 서류가 변경/);
});
test('실패한 이미지·권한 실패·이동 중 준비는 URL을 남기지 않는다',async()=>{
  for(const mode of ['decode','permission','moved']){
    let active=true;const revoked=[],image={getAttribute:()=>'/api/documents/1/tbm-signature/image',decode:async()=>{if(mode==='decode')throw Error('가상 해독 실패');if(mode==='moved')active=false;}};
    const pending=freezeBatchImages([image],()=>active,{fetchImage:async()=>new Response(new Blob(['image'],{type:'image/png'}),{status:mode==='permission'?401:200}),urls:{createObjectURL:()=> 'blob:virtual',revokeObjectURL:url=>revoked.push(url)}});
    if(mode==='moved')await pending;else await assert.rejects(pending);assert.deepEqual(revoked,mode==='permission'?[]:['blob:virtual']);
  }
});

test('임시 DB와 HTTP에서 문서 수정·로그아웃은 인쇄를 막고 이미지 모듈과 정책을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-batch-snapshot-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
    const base=`http://127.0.0.1:${port}`;let cookie='';
    const request=async(path,method='GET',body)=>fetch(base+path,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=await request('/api/login','POST',{password:'virtual-admin-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    const api=async path=>{const response=await request(path),value=await response.json();if(!response.ok)throw Error(value.error||'HTTP 조회 실패');return value;};
    const asset=await request('/batch-images.js');assert.equal(asset.status,200);assert.match(await asset.text(),/export async function freezeBatchImages/);assert.match(asset.headers.get('content-type'),/javascript/);
    const page=await request('/');assert.match(page.headers.get('content-security-policy'),/img-src 'self' data: blob:/);
    const site=await (await request('/api/sites','POST',{name:'가상 현장'})).json();
    const input={siteId:site.id,type:'tbm',title:'가상 문서',date:'2026-11-01',details:{weather:'맑음'}};
    const doc=await (await request('/api/documents','POST',input)).json();assert.equal(doc.id,1);
    const h=harness();h.context.api=api;h.context.adminSession=Promise.resolve(await api('/api/session'));h.state.siteId=site.id;
    await h.prepare();await h.print();assert.equal(h.prints(),1);
    const current=await api('/api/documents/1');const changed=await request('/api/documents/1','PUT',{...input,title:'수정된 가상 문서',expectedEditVersion:current.edit_version});assert.equal(changed.status,200);
    await h.print();assert.equal(h.prints(),1);assert.match(h.errors.at(-1),/출력 자료가 변경/);
    await h.prepare();const logout=await request('/api/logout','POST',{});assert.equal(logout.status,200);await h.print();assert.equal(h.prints(),1);assert.match(h.errors.at(-1),/로그인|권한/);
  }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
});
