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
  assert.doesNotMatch(ui.markup(),/<img|<가상 토목>|<가상 설비>|가상 외부 업체/);assert.match(ui.markup(),/&lt;img src=x onerror=&quot;가상&quot;&gt;/);assert.match(ui.markup(),/&lt;가상 토목&gt; · #11/);assert.match(ui.markup(),/&lt;가상 설비&gt; · #12/);assert.deepEqual(ui.select().options.map(option=>option.value),['0','99','11','12']);ui.choose(12);await ui.save();assert.equal(ui.payload().details.companyId,12);assert.equal(ui.payload().details.company,attack);
});

test('빈 목록은 직접입력을 허용하고 목록 조회 실패는 편집창을 열지 않는다',async()=>{
  const ui=await screen({companies:[]});assert.match(ui.status(),/등록된 협력사가 없습니다/);ui.input().value='가상 직접업체';await ui.save();assert.equal(ui.payload().details.companyId,0);assert.equal(ui.payload().details.company,'가상 직접업체');
  const failed=await screen({failLoad:true});assert.equal(failed.select(),undefined);assert.equal(failed.error(),'가상 목록 실패');assert.equal(failed.writes().length,0);
});

test('저장 실패는 선택과 직접입력을 보존하며 현장 변경 후에는 전송하지 않는다',async()=>{
  const ui=await screen({details:{company:'가상 수동업체'},failSave:true});ui.choose(12);await ui.save();assert.equal(ui.select().value,'12');assert.equal(ui.input().value,'가상 수동업체');assert.equal(ui.closed(),0);assert.equal(ui.error(),'가상 저장 실패');ui.choose(0);assert.equal(ui.input().disabled,false);
  const moved=await screen();moved.choose(11);moved.state.siteId=8;await moved.save();assert.equal(moved.writes().length,0);assert.match(moved.error(),/현장이 변경/);
});
