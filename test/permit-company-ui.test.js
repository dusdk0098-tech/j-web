import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
const company=(id,name='가상 협력사',trade='가상 공종',site_id=7)=>({id,name,trade,site_id});

// shortcut: 선택·입력·폼 제출만 모의 DOM으로 실행하며 실제 배치와 키보드 접근성은 브라우저 검증이 허용될 때 확인한다.
async function screen({details={},companies=[company(11),company(12)],existing=false,failSave=false,failLoad=false}={}){
  const nodes=new Map(),controls=new Map(),calls=[];let closed=0;
  const parse=html=>{
    for(const match of html.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
      const [,tag,attrs,body='']=match,name=attrs.match(/\bname="([^"]+)"/)?.[1];if(!name)continue;
      const options=[...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,attrs,text])=>({value:decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]??text),selected:/\bselected\b/.test(attrs),label:decode(text)}));
      controls.set(name,{name,tag,options,disabled:/\bdisabled\b/.test(attrs),value:tag==='select'?(options.find(option=>option.selected)||options[0])?.value||'':tag==='textarea'?decode(body):decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]||'')});
    }
    for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))if(!nodes.has('#'+id))nodes.set('#'+id,node());
  };
  const node=()=>({disabled:false,textContent:'',html:'',set innerHTML(html){this.html=html;parse(html);},get innerHTML(){return this.html;},insertAdjacentHTML(position,html){this.html=position==='afterbegin'?html+this.html:this.html+html;parse(html);}});
  for(const key of ['#dialog-title','#dialog-body','#dialog-error','#dialog-form','#dialog-form button[type=submit]'])nodes.set(key,node());
  const find=selector=>{const name=selector.match(/\[name=["']?([^\]"']+)/)?.[1];return name?controls.get(name):nodes.get(selector);};
  const state={siteId:7,page:'documents',type:'permit',types:{permit:'가상 작업허가서'}};
  const context={state,$:find,document:{querySelector:find,querySelectorAll:()=>[]},dialog:{showModal(){},close(){closed++;}},FormData:class{*[Symbol.iterator](){for(const control of controls.values())if(!control.disabled)yield [control.name,control.value];}},api:async(path,options)=>{calls.push({path,options});if(options){if(failSave)throw Error('가상 저장 실패');return {id:5};}if(path.startsWith('/api/companies?')){if(failLoad)throw Error('가상 목록 실패');return companies;}return [];},today:()=> '2026-10-31',flash(){},render:async()=>{},showError:error=>{nodes.get('#dialog-error').textContent=error.message;}};
  const parts=[source.match(/^const esc = .*$/m)[0],source.slice(source.indexOf('function field('),source.indexOf('function signaturePad(')),source.slice(source.indexOf('function showDialog('),source.indexOf("$('#dialog-close')")),source.match(/^const permitKinds=.*$/m)[0],source.match(/^const permitFields=.*$/m)[0],source.slice(source.indexOf('async function editDocument('),source.indexOf('async function loadDocuments('))];
  runInNewContext(parts.join('\n')+'\nglobalThis.open=editDocument;',context);
  await context.open(existing?{id:5,site_id:7,type:'permit',title:'가상 기존 문서',date:'2026-10-31',details:JSON.stringify(details)}:null,details,'permit');
  return {calls,state,controls,nodes,closed:()=>closed,markup:()=>nodes.get('#daily-fields')?.innerHTML||'',select:()=>controls.get('permitCompany'),input:()=>controls.get('company'),status:()=>nodes.get('#permit-company-status')?.textContent,error:()=>nodes.get('#dialog-error').textContent,choose(id){const select=controls.get('permitCompany');assert.ok(select.options.some(option=>option.value===String(id)));select.value=String(id);select.onchange();},save:()=>nodes.get('#dialog-form').onsubmit({preventDefault(){},currentTarget:nodes.get('#dialog-form')}),writes:()=>calls.filter(call=>call.options),payload:()=>JSON.parse(calls.findLast(call=>call.options).options.body)};
}

test('현장의 등록 업체를 선택하고 실제 폼 제출 경로로 식별자와 업체명을 전송한다',async()=>{
  const ui=await screen();assert.equal(ui.calls.filter(call=>call.path==='/api/companies?siteId=7').length,1);assert.equal(ui.select().value,'0');ui.choose(12);assert.equal(ui.input().disabled,true);await ui.save();
  assert.equal(ui.writes()[0].path,'/api/documents');assert.equal(ui.writes()[0].options.method,'POST');assert.equal(ui.payload().details.companyId,12);assert.equal(ui.payload().details.company,'가상 협력사');assert.equal(ui.payload().siteId,7);assert.equal(ui.closed(),1);assert.equal(Object.hasOwn(ui.payload(),'permitCompany'),false);assert.match(ui.markup(),/업체 권한을 부여하지 않습니다/);
});

test('식별자 없는 과거 수동입력은 같은 이름의 등록 업체가 있어도 직접입력으로 보존한다',async()=>{
  const ui=await screen({existing:true,details:{company:'가상 협력사'}});assert.equal(ui.select().value,'0');assert.equal(ui.input().value,'가상 협력사');assert.equal(ui.input().disabled,false);await ui.save();assert.equal(ui.writes()[0].options.method,'PUT');assert.equal(ui.payload().details.companyId,0);assert.equal(ui.payload().details.company,'가상 협력사');
});

test('업체 선택을 반복해도 저장 전 직접입력 내용은 유지되고 선택 해제로 복원된다',async()=>{
  const ui=await screen({existing:true,details:{company:'가상 과거 수동업체'}});ui.input().value='가상 수정 중인 수동업체';ui.choose(11);ui.choose(12);assert.equal(ui.input().value,'가상 수정 중인 수동업체');ui.choose(0);assert.equal(ui.input().disabled,false);await ui.save();assert.equal(ui.payload().details.companyId,0);assert.equal(ui.payload().details.company,'가상 수정 중인 수동업체');
});

test('현재 등록 연결은 유지하며 직접입력으로 명시적으로 해제할 수 있다',async()=>{
  const ui=await screen({existing:true,details:{companyId:11,company:'가상 이전 업체명'},companies:[company(11,'가상 현재 업체명')]});assert.equal(ui.select().value,'11');await ui.save();assert.equal(ui.payload().details.companyId,11);assert.equal(ui.payload().details.company,'가상 현재 업체명');
  const clear=await screen({existing:true,details:{companyId:11,company:'가상 이전 업체명'}});clear.choose(0);await clear.save();assert.equal(clear.payload().details.companyId,0);assert.equal(clear.payload().details.company,'가상 이전 업체명');
});

test('이름이 변경된 기존 연결은 당시 이름 보존을 안내하고 다른 업체를 선택하면 현재 이름 저장을 안내한다',async()=>{
  const ui=await screen({existing:true,details:{companyId:11,company:'가상 과거 업체명'},companies:[company(11,'가상 변경된 업체명'),company(12,'가상 새 업체명')]});
  assert.equal(ui.select().value,'11');assert.match(ui.select().options.find(option=>option.value==='11').label,/가상 변경된 업체명/);assert.equal(ui.input().value,'가상 과거 업체명');assert.match(ui.status(),/문서에 기록된 당시 업체명을 보존/);assert.doesNotMatch(ui.status(),/현재 등록 이름으로 저장/);
  ui.choose(12);assert.match(ui.status(),/새로 선택한 업체의 현재 등록 이름으로 저장/);assert.doesNotMatch(ui.status(),/당시 업체명을 보존/);ui.choose(11);assert.match(ui.status(),/당시 업체명을 보존/);ui.choose(0);assert.equal(ui.input().value,'가상 과거 업체명');assert.match(ui.status(),/업체명을 직접 입력/);
  const fresh=await screen({details:{companyId:11,company:'가상 초기 업체명'}});assert.match(fresh.status(),/현재 등록 이름으로 저장/);assert.doesNotMatch(fresh.status(),/당시 업체명을 보존/);
});

test('목록에서 사라진 기존 식별자는 재선택 전 저장하지 않고 과거 업체명을 보존한다',async()=>{
  const ui=await screen({existing:true,details:{companyId:99,company:'가상 이전 업체'}});assert.equal(ui.select().value,'99');assert.match(ui.markup(),/재선택 필요/);assert.match(ui.status(),/현재 목록에 없습니다/);await ui.save();assert.equal(ui.writes().length,0);assert.equal(ui.closed(),0);assert.match(ui.error(),/다시 선택/);assert.equal(ui.input().value,'가상 이전 업체');ui.choose(12);await ui.save();assert.equal(ui.payload().details.companyId,12);
  const clear=await screen({existing:true,details:{companyId:99,company:'가상 이전 업체'},companies:[]});await clear.save();assert.equal(clear.writes().length,0);clear.choose(0);await clear.save();assert.equal(clear.payload().details.company,'가상 이전 업체');assert.equal(clear.payload().details.companyId,0);
});

test('동일 업체명은 공종과 식별자로 구분하고 업체명·공종·과거 표시값은 이스케이프한다',async()=>{
  const attack='<img src=x onerror="가상">',ui=await screen({details:{companyId:99,company:attack},companies:[company(11,attack,'<가상 토목>'),company(12,attack,'<가상 설비>'),company(13,'가상 외부 업체','외부',8)]});
  assert.doesNotMatch(ui.markup(),/<img|<가상 토목>|<가상 설비>|가상 외부 업체/);assert.match(ui.markup(),/&lt;img src=x onerror=&quot;가상&quot;&gt;/);assert.match(ui.markup(),/&lt;가상 토목&gt; · #11/);assert.match(ui.markup(),/&lt;가상 설비&gt; · #12/);assert.deepEqual(ui.select().options.map(option=>option.value),['0','-1','99','11','12']);ui.choose(12);await ui.save();assert.equal(ui.payload().details.companyId,12);assert.equal(ui.payload().details.company,attack);
});

test('빈 목록은 직접입력을 허용하고 목록 조회 실패는 편집창을 열지 않는다',async()=>{
  const ui=await screen({companies:[]});assert.match(ui.status(),/등록된 협력사가 없습니다/);ui.input().value='가상 직접업체';await ui.save();assert.equal(ui.payload().details.companyId,0);assert.equal(ui.payload().details.company,'가상 직접업체');
  const failed=await screen({failLoad:true});assert.equal(failed.select(),undefined);assert.equal(failed.error(),'가상 목록 실패');assert.equal(failed.writes().length,0);
});

test('저장 실패는 선택과 직접입력을 보존하며 현장 변경 후에는 전송하지 않는다',async()=>{
  const ui=await screen({details:{company:'가상 수동업체'},failSave:true});ui.choose(12);await ui.save();assert.equal(ui.select().value,'12');assert.equal(ui.input().value,'가상 수동업체');assert.equal(ui.closed(),0);assert.equal(ui.error(),'가상 저장 실패');ui.choose(0);assert.equal(ui.input().disabled,false);
  const moved=await screen();moved.choose(11);moved.state.siteId=8;await moved.save();assert.equal(moved.writes().length,0);assert.match(moved.error(),/현장이 변경/);
});

test('신규 직영 작업은 업체명 없이 저장하고 기존 직영 문서에서도 선택이 재표시된다',async()=>{
  const ui=await screen();ui.choose(-1);assert.equal(ui.input().disabled,true);assert.match(ui.status(),/협력사 현장소장은 필수가 아닙니다/);await ui.save();
  const details=ui.payload().details;assert.equal(details.directWork,true);assert.equal(details.companyId,0);assert.equal(details.company,'');assert.equal(Object.hasOwn(ui.payload(),'company'),false);
  const reopened=await screen({existing:true,details});assert.equal(reopened.select().value,'-1');assert.equal(reopened.input().disabled,true);await reopened.save();assert.deepEqual(reopened.payload().details,details);
});

test('직접입력과 등록업체 사이에서 직영 작업을 거쳐도 저장 전 입력과 업체 선택이 유지된다',async()=>{
  const ui=await screen({existing:true,details:{company:'가상 원래 업체'}});ui.input().value='가상 편집 중 업체';ui.choose(12);ui.choose(-1);assert.equal(ui.input().value,'가상 편집 중 업체');ui.choose(12);await ui.save();assert.equal(ui.payload().details.companyId,12);assert.equal(ui.payload().details.directWork,false);ui.choose(-1);ui.choose(0);assert.equal(ui.input().disabled,false);assert.equal(ui.input().value,'가상 편집 중 업체');await ui.save();assert.equal(ui.payload().details.company,'가상 편집 중 업체');assert.equal(ui.payload().details.directWork,false);
  const direct=await screen({existing:true,details:{directWork:true,companyId:0,company:''}});direct.choose(11);assert.match(direct.status(),/먼저 문서 상세의 역할 설정에서 협력사 현장소장을 지정/);await direct.save();assert.equal(direct.payload().details.directWork,false);assert.equal(direct.payload().details.companyId,11);direct.choose(0);assert.doesNotMatch(direct.status(),/협력사 현장소장을 지정/);direct.choose(-1);assert.doesNotMatch(direct.status(),/먼저 문서 상세/);
});

test('기존 직영의 업체 전환 안내는 업체 선택 또는 공백이 아닌 직접입력에만 표시되고 입력·지우기에 갱신된다',async()=>{
  const ui=await screen({existing:true,details:{directWork:true,companyId:0,company:''}}),warning=/먼저 문서 상세의 역할 설정에서 협력사 현장소장을 지정/;
  ui.choose(0);assert.doesNotMatch(ui.status(),warning);ui.input().value='가상 새 작업업체';ui.input().oninput();assert.match(ui.status(),warning);ui.input().value='';ui.input().oninput();assert.doesNotMatch(ui.status(),warning);ui.input().value='   ';ui.input().oninput();assert.doesNotMatch(ui.status(),warning);
  ui.choose(11);assert.match(ui.status(),warning);ui.choose(0);assert.doesNotMatch(ui.status(),warning);ui.input().value='가상 복원 업체';ui.input().oninput();ui.choose(-1);assert.doesNotMatch(ui.status(),warning);ui.choose(0);assert.match(ui.status(),warning);assert.equal(ui.input().value,'가상 복원 업체');ui.input().value='';ui.input().oninput();await ui.save();assert.equal(ui.payload().details.directWork,false);assert.equal(ui.payload().details.companyId,0);assert.equal(ui.payload().details.company,'');
});

test('직영 표시는 기존 이름이나 빈 업체명의 추정이 아니며 기존 문자열을 바꾸지 않는다',async()=>{
  for(const company of ['','직영 작업','가상 수동 업체']){const ui=await screen({existing:true,details:{company}});assert.equal(ui.select().value,'0');await ui.save();assert.equal(ui.payload().details.directWork,false);assert.equal(ui.payload().details.company,company);}
  const ui=await screen({details:{company:'가상 수동 업체'},failSave:true});ui.choose(-1);await ui.save();assert.equal(ui.select().value,'-1');ui.choose(0);assert.equal(ui.input().value,'가상 수동 업체');
});

test('관리자 결재 당시 사본과 결재자 상세는 내부 키 없이 직영 작업을 표시한다',async()=>{
  const context={dailyFields:{},riskFields:{},planFields:{},permitFields:{company:'작업업체'}};
  runInNewContext(source.match(/^const esc = .*$/m)[0]+'\n'+source.slice(source.indexOf('function capturedFields('),source.indexOf('function capturedFiles('))+'\nglobalThis.capture=capturedFields;',context);
  const details={companyId:0,company:'',directWork:true},snapshot=context.capture({details});assert.match(snapshot,/직영 작업/);assert.doesNotMatch(snapshot,/directWork|추가 항목/);assert.equal(details.company,'');
  const review=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),detail={dataset:{},querySelector:()=>null},decision={};
  const reviewer={detail,$:()=>decision,pad:()=>()=>'',planLinks:()=>'',api:async()=>({document:{type:'permit',title:'가상 직영 문서',date:'2026-10-31',details:JSON.stringify(details)},attachments:[],priorReviews:[],frozen:true})};
  runInNewContext(review.match(/^const esc=.*$/m)[0]+'\n'+review.slice(review.indexOf('const labels='),review.indexOf('function pad('))+'\n'+review.slice(review.indexOf('async function openReference('),review.indexOf('login.onsubmit='))+'\nglobalThis.open=openDocument;globalThis.fields=displayFields;',reviewer);
  await reviewer.open(5);assert.match(detail.innerHTML,/직영 작업/);assert.doesNotMatch(detail.innerHTML,/directWork|추가 항목/);
  for(const render of [context.capture,reviewer.fields]){const normal=render({company:'가상 업체',directWork:false});assert.match(normal,/가상 업체/);assert.doesNotMatch(normal,/직영 작업|directWork|추가 항목/);assert.match(render({company:'가상 이전 업체'}),/가상 이전 업체/);}
});
